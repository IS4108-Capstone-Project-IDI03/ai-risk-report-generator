"""Transcribe each test page and score it against what its writer says it reads (CP-19 AC16).

A case is a pair in eval/cases/handwriting/: a photo of one handwritten page (<id>.jpg, .jpeg or
.png) and the text its writer typed from it (<id>.txt). The photo goes through the same code as
/transcribe-handwriting (HANDWRITING_PROVIDER, HANDWRITING_MODEL and the prompt as configured).

Scoring, word by word (case, punctuation at a word's edges and line breaks are ignored;
abbreviations must match as written):
- each written word is read correctly, misread or missed; a word the model adds is "added";
- word accuracy is correct words over written words;
- flag recall is how many of the wrong words (misread or added) were marked uncertain, and flag
  precision how many of the marked words were wrong;
- `[?]` in the text is a word even its writer can't read: it matches anything and isn't scored;
- an empty .txt is a page with no handwriting, which passes when nothing comes back.

Run from microservices/speech-ocr-service. It reads the root .env for the provider settings and
GEMINI_API_KEY (paid tier). Set HANDWRITING_MODEL first to try another model:
    uv run --extra dev python -m eval.transcribe_handwriting [case-id ...]

Each run makes one model call per page. The scores go to eval/handwriting/<date>-<model>.md, to
commit, and each page's transcript to eval/results/<date>.jsonl, which is not committed.
"""

import json
import re
import string
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).parent
REPO = HERE.parents[2]
load_dotenv(REPO / ".env")

from app.processors.handwriting import (  # noqa: E402
    PROMPT_VERSION,
    HandwritingError,
    transcribe_image,
)

CASES = HERE / "cases" / "handwriting"
PHOTOS = (".jpg", ".jpeg", ".png")
UNREADABLE = "[?]"
EDGES = string.punctuation + "“”‘’–—…"

# AC16's targets, placeholders until the first run gives a baseline.
TARGET_ACCURACY = 0.90
TARGET_FLAG_RECALL = 0.80


def written_words(text: str) -> list[str]:
    """The words of a text as scored: lower case, punctuation off their edges."""
    words = []
    for token in text.split():
        if token == UNREADABLE:
            words.append(UNREADABLE)
        elif word := token.lower().strip(EDGES):
            words.append(word)
    return words


def read_words(transcript: str, uncertain: list[list[int]]) -> list[tuple[str, bool]]:
    """The transcript's words as scored, each with whether it was marked uncertain.

    `uncertain` counts UTF-16 units, as the browser does, so positions are converted back.
    """
    units = [0]
    for char in transcript:
        units.append(units[-1] + len(char.encode("utf-16-le")) // 2)
    words = []
    for match in re.finditer(r"\S+", transcript):
        start, end = units[match.start()], units[match.end()]
        flagged = any(s < end and start < e for s, e in uncertain)
        if word := match.group().lower().strip(EDGES):
            words.append((word, flagged))
    return words


@dataclass
class Score:
    words: int = 0
    correct: int = 0
    misread: int = 0
    missed: int = 0
    added: int = 0
    wrong_flagged: int = 0
    flagged: int = 0
    changes: list[str] = field(default_factory=list)

    @property
    def wrong(self) -> int:
        return self.misread + self.added

    def add(self, other: "Score") -> None:
        for name in ("words", "correct", "misread", "missed", "added", "wrong_flagged", "flagged"):
            setattr(self, name, getattr(self, name) + getattr(other, name))


def score(written: list[str], read: list[tuple[str, bool]]) -> Score:
    """Line the words up with the fewest changes (edit distance), then count each kind."""
    rows, cols = len(written), len(read)

    def same(i: int, j: int) -> bool:
        return written[i] == UNREADABLE or written[i] == read[j][0]

    cost = [[0] * (cols + 1) for _ in range(rows + 1)]
    for i in range(1, rows + 1):
        cost[i][0] = cost[i - 1][0] + (written[i - 1] != UNREADABLE)
    for j in range(1, cols + 1):
        cost[0][j] = j
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            cost[i][j] = min(
                cost[i - 1][j - 1] + (not same(i - 1, j - 1)),
                cost[i - 1][j] + (written[i - 1] != UNREADABLE),
                cost[i][j - 1] + 1,
            )

    result = Score(words=sum(w != UNREADABLE for w in written))
    result.flagged = sum(flagged for _, flagged in read)
    i, j = rows, cols
    while i or j:
        if i and j and cost[i][j] == cost[i - 1][j - 1] + (not same(i - 1, j - 1)):
            word, flagged = read[j - 1]
            if written[i - 1] == UNREADABLE:
                result.flagged -= flagged  # neither right nor wrong
            elif word == written[i - 1]:
                result.correct += 1
            else:
                result.misread += 1
                result.wrong_flagged += flagged
                result.changes.append(f"{written[i - 1]} → {word}{' (marked)' if flagged else ''}")
            i, j = i - 1, j - 1
        elif i and cost[i][j] == cost[i - 1][j] + (written[i - 1] != UNREADABLE):
            if written[i - 1] != UNREADABLE:
                result.missed += 1
                result.changes.append(f"missed {written[i - 1]}")
            i -= 1
        else:
            word, flagged = read[j - 1]
            result.added += 1
            result.wrong_flagged += flagged
            result.changes.append(f"added {word}{' (marked)' if flagged else ''}")
            j -= 1
    result.changes.reverse()
    return result


def share(part: int, whole: int) -> str:
    return f"{part / whole:.0%}" if whole else "–"


def cases(only: list[str]) -> list[tuple[str, Path, str]]:
    found = []
    for photo in sorted(CASES.iterdir()):
        text = photo.with_suffix(".txt")
        if photo.suffix.lower() in PHOTOS and text.exists() and (not only or photo.stem in only):
            found.append((photo.stem, photo, text.read_text(encoding="utf-8")))
    return found


def main(only: list[str]) -> None:
    pages = cases(only)
    if not pages:
        sys.exit(f"No pages in {CASES}: add <id>.jpg and <id>.txt pairs (see README.md there).")
    now = datetime.now(UTC)
    (HERE / "results").mkdir(exist_ok=True)
    raw = HERE / "results" / f"{now:%Y-%m-%d}.jsonl"

    total, model, rows, failed = Score(), None, [], []
    blank_pages = blank_passed = 0
    for case_id, photo, truth in pages:
        try:
            reading = transcribe_image(photo.read_bytes())
        except HandwritingError as error:
            failed.append(f"{case_id}: {error}")
            print(f"\n== {case_id}: failed: {error}")
            continue
        model = reading["model"]
        [usage] = reading["usage"]
        result = score(
            written_words(truth), read_words(reading["transcript"], reading["uncertain"])
        )
        with raw.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"case": case_id, "at": now.isoformat(), **reading}) + "\n")

        seconds = (usage["duration_ms"] or 0) / 1000
        tokens = f"{usage['input_tokens']} / {usage['output_tokens']}"
        print(f"\n== {case_id}  ({seconds:.1f} s, tokens in/out {tokens})")
        if not result.words:
            blank_pages += 1
            blank_passed += not reading["transcript"]
            print(
                "   No handwriting:",
                "nothing came back"
                if not reading["transcript"]
                else f"wrote {reading['transcript']!r}",
            )
            continue
        total.add(result)
        print(f"   {result.correct} of {result.words} words right; " + "; ".join(result.changes))
        rows.append(
            f"| {case_id} | {result.words} | {result.correct} | {result.misread} | "
            f"{result.missed} | {result.added} | {share(result.correct, result.words)} | "
            f"{result.wrong_flagged} of {result.wrong} | "
            f"{result.flagged - result.wrong_flagged} of {result.flagged} | {seconds:.1f} | "
            f"{tokens} |"
        )

    accuracy = share(total.correct, total.words)
    recall = share(total.wrong_flagged, total.wrong)
    precision = share(total.wrong_flagged, total.flagged)
    lines = [
        f"# Handwriting transcription, {now:%Y-%m-%d}",
        "",
        f"{model or 'No model answered'}, prompt {PROMPT_VERSION}, {len(pages)} pages.",
        "",
        "| page | words | right | misread | missed | added | accuracy | wrong words marked "
        "| marked words right | s | tokens in / out |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
        *rows,
        "",
        f"- Word accuracy: **{accuracy}** ({total.correct} of {total.words}); target "
        f"{TARGET_ACCURACY:.0%}.",
        f"- Flag recall: **{recall}** of wrong words marked uncertain ({total.wrong_flagged} of "
        f"{total.wrong}); target {TARGET_FLAG_RECALL:.0%}.",
        f"- Flag precision: {precision} of marked words were wrong ({total.wrong_flagged} of "
        f"{total.flagged}).",
    ]
    if blank_pages:
        lines.append(
            f"- Pages without handwriting: {blank_passed} of {blank_pages} came back empty."
        )
    if failed:
        lines += ["- Failed, not scored:", *(f"  - {f}" for f in failed)]
    summary = "\n".join(lines) + "\n"
    out = HERE / "handwriting" / f"{now:%Y-%m-%d}-{model or 'none'}.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(summary, encoding="utf-8")
    print("\n" + summary + f"\nSaved to {out}; transcripts in {raw}.")


if __name__ == "__main__":
    main(sys.argv[1:])

"""Transcribe spoken test clips and score them against their scripts (CP-22 voice-to-text eval).

A case is a pair in eval/cases/speech/: a recording (<id>.m4a) and the words spoken in it
(<id>.txt). terms.json lists, per clip, the names and terms that matter (places, equipment,
standards). Each clip goes through the same code as /transcribe (app.processors.stt.transcribe);
only the S3 read is swapped for the local file, so model, language and segments are the real ones.

Scoring (same rule on script and transcript, so spoken and written forms match):
- lower case; hyphens become spaces; punctuation dropped; "fm200" is read as "fm 200";
- number words zero..twenty become digits and "two point four" becomes 2.4;
- filler words (um, uh, er, erm, ah) are ignored;
- British spellings centre and metre(s) become center and meter(s), as Whisper writes American;
- WER (word error rate) = (substitutions + deletions + insertions) / script words, fewest edits;
- a key term is "exact" when its words appear next to each other, in order, in the transcript;
- segments pass when there is at least one, each starts before it ends, and starts never go back.

Run from microservices/speech-ocr-service. It reads the root .env (OPENAI_API_KEY, WHISPER_MODEL):
    uv run --extra dev python -m eval.transcribe_speech [case-id ...]
Each run makes one paid Whisper call per clip; cost is audio minutes x the price in
server/src/services/ai-pricing.service.ts. Transcripts go to eval/results/<date>-speech.jsonl
(not committed) and the scores to eval/speech/<date>-<model>.md.
"""

import io
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).parent
load_dotenv(HERE.parents[2] / ".env")

from app.processors import stt  # noqa: E402

CASES = HERE / "cases" / "speech"
FILLERS = {"um", "uh", "er", "erm", "ah"}
NUMBERS = {
    w: str(i)
    for i, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
        "fifteen sixteen seventeen eighteen nineteen twenty".split()
    )
}
SPELLING = {"centre": "center", "metre": "meter", "metres": "meters"}
USD_PER_MINUTE = (
    0.006  # must match WHISPER_USD_PER_MINUTE in server/src/services/ai-pricing.service.ts
)


def normalise(text: str) -> list[str]:
    """The words of a text as scored (rules in the file header)."""
    text = re.sub(r"(?<=\d),(?=\d)", "", text.lower().replace("-", " "))
    text = re.sub(r"(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])", " ", text)
    words = [
        NUMBERS.get(w, SPELLING.get(w, w))
        for w in re.sub(r"[^\w\s.]|(?<!\d)\.|\.(?!\d)", " ", text).split()
    ]
    out: list[str] = []
    i = 0
    while i < len(words):
        if (
            words[i] == "point"
            and out
            and i + 1 < len(words)
            and out[-1].isdigit()
            and words[i + 1].isdigit()
        ):
            out[-1] += "." + words[i + 1]
            i += 2
            continue
        out.append(words[i])
        i += 1
    return [w for w in out if w not in FILLERS]


def word_errors(script: list[str], heard: list[str]) -> int:
    """The fewest word changes (edit distance) that turn the script into what was heard."""
    row = list(range(len(heard) + 1))
    for i, s in enumerate(script, 1):
        prev, row[0] = row[0], i
        for j, h in enumerate(heard, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (s != h))
    return row[-1]


def term_found(term: str, heard: list[str]) -> bool:
    """Whether the term's words appear next to each other, in order, in the heard words."""
    words = normalise(term)
    return any(heard[i : i + len(words)] == words for i in range(len(heard) - len(words) + 1))


def segments_ok(segments: list[dict]) -> bool:
    """Whether there is at least one segment, each starts before it ends, starts never go back."""
    starts = [s["start"] for s in segments]
    return (
        bool(segments) and all(s["start"] < s["end"] for s in segments) and starts == sorted(starts)
    )


def transcribe_local(path: Path) -> dict:
    """Run the app's transcribe() on a local file by handing it the bytes in place of S3."""

    class _S3:
        def get_object(self, **_):
            return {"Body": io.BytesIO(path.read_bytes())}

    stt.boto3.client = lambda *_, **__: _S3()
    return stt.transcribe(path.name)


def main(only: list[str]) -> None:
    terms = json.loads((CASES / "terms.json").read_text())
    clips = [p for p in sorted(CASES.glob("*.m4a")) if not only or p.stem in only]
    if not clips:
        sys.exit(f"No clips in {CASES}.")
    now = datetime.now(UTC)
    (HERE / "results").mkdir(exist_ok=True)
    raw = HERE / "results" / f"{now:%Y-%m-%d}-speech.jsonl"

    rows, errors, words, found, total_terms, seconds, seg_bad, missed = [], 0, 0, 0, 0, 0.0, [], []
    for clip in clips:
        script = normalise(clip.with_suffix(".txt").read_text(encoding="utf-8"))
        result = transcribe_local(clip)
        heard = normalise(result["transcript"])
        with raw.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"case": clip.stem, "at": now.isoformat(), **result}) + "\n")
        wrong = word_errors(script, heard)
        hits = [t for t in terms.get(clip.stem, []) if term_found(t, heard)]
        misses = [t for t in terms.get(clip.stem, []) if t not in hits]
        ok = segments_ok(result["segments"])
        audio = result["usage"][0]["audio_seconds"] or 0
        errors, words = errors + wrong, words + len(script)
        found, total_terms = found + len(hits), total_terms + len(hits) + len(misses)
        seconds += audio
        seg_bad += [] if ok else [clip.stem]
        missed += [f"{clip.stem}: {t}" for t in misses]
        print(
            f"\n== {clip.stem}: WER {wrong / len(script):.1%}, "
            f"terms {len(hits)}/{len(hits) + len(misses)}"
        )
        print(f"   heard: {result['transcript']}")
        rows.append(
            f"| {clip.stem} | {audio:.1f} | {wrong / len(script):.1%} | {len(hits)} of "
            f"{len(hits) + len(misses)} | {', '.join(misses) or '–'} | {'yes' if ok else 'NO'} |"
        )

    model = stt.WHISPER_MODEL
    cost = seconds / 60 * USD_PER_MINUTE
    lines = [
        f"# Voice-to-text, {now:%Y-%m-%d}",
        "",
        f"{model}, {len(clips)} clips, {seconds:.0f} s of audio.",
        "",
        "| clip | s | WER | key terms exact | missed terms | segments ok |",
        "|---|---|---|---|---|---|",
        *rows,
        "",
        f"- Overall WER: **{errors / words:.1%}** ({errors} errors in {words} words).",
        f"- Key-term recall: **{found / total_terms:.0%}** ({found} of {total_terms}).",
        f"- Clips with bad segments: {', '.join(seg_bad) or 'none'}.",
        f"- Cost: ${cost:.4f} ({seconds / 60:.2f} min at ${USD_PER_MINUTE}/min).",
    ]
    summary = "\n".join(lines) + "\n"
    out = HERE / "speech" / f"{now:%Y-%m-%d}-{model}.md"
    out.parent.mkdir(exist_ok=True)
    out.write_text(summary, encoding="utf-8")
    print("\n" + summary + f"\nSaved to {out}; transcripts in {raw}.")


if __name__ == "__main__":
    main(sys.argv[1:])

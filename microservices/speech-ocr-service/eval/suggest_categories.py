"""Read each test observation and score the categories it proposes against known ones (CP-21 AC10).

Each case in eval/cases/categories.json is one observation: its texts (a typed note, recording
transcripts, handwritten-page transcripts), any photos, and the COPE categories it concerns
(`expected`), with any others a reasonable engineer could also file it under (`also_fine`). It
goes through the same reading as /interpret (VISION_PROVIDER, VISION_MODEL and the prompt as
configured).

Scoring:
- a case passes when every expected category is proposed and nothing outside expected and
  also_fine is;
- recall is expected categories proposed over expected categories, and precision is proposed
  categories that are expected or also fine over proposed categories;
- each quote must appear in the item it cites, compared as the gateway compares it (case,
  spacing and curly quotes ignored), and a cited item must be one the case has.

Run from microservices/speech-ocr-service. It reads the root .env for the provider settings and
GEMINI_API_KEY (paid tier). Set VISION_MODEL first to try another model:
    uv run --extra dev python -m eval.suggest_categories [case-id ...]

Each run makes one model call per case. The scores go to eval/categories/<date>-<model>.md, to
commit, and each proposal to eval/results/<date>.jsonl, which is not committed.
"""

import json
import re
import string
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).parent
REPO = HERE.parents[2]
load_dotenv(REPO / ".env")

from app.processors.vision import (  # noqa: E402
    PROMPT_VERSION,
    InterpretationError,
    interpret_images,
)

CASES = HERE / "cases" / "categories.json"

# AC10's targets, placeholders until the first run gives a baseline.
TARGET_PASS = 0.80
TARGET_QUOTES = 0.90

# Curly quotes and long dashes as typed on a phone, read as their plain forms.
PLAIN = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-"})
EDGES = string.punctuation + " "


def plain(text: str) -> str:
    """Text as quotes are compared: plain quotes and dashes, lower case, single spaces."""
    return re.sub(r"\s+", " ", text.translate(PLAIN).lower()).strip()


def quote_found(quote: str | None, text: str) -> bool:
    """Whether a quote appears in the text, as the gateway checks it (observation.service.ts)."""
    words = plain(quote or "").strip(EDGES)
    return bool(words) and words in plain(text)


@dataclass
class Score:
    passed: bool
    expected: int
    found: int
    proposed: int
    fitting: int
    quotes: int
    quotes_found: int


def score(case: dict, categories: list[dict]) -> Score:
    """One case's proposal against its known categories, and its quotes against its texts."""
    expected = set(case["expected"])
    fine = expected | set(case.get("also_fine", []))
    proposed = [c["category"] for c in categories]
    texts = {t["label"]: t["text"] for t in case["texts"]}
    photos = {p["label"] for p in case.get("photos", [])}
    quotes = quotes_found = 0
    for c in categories:
        for e in c["evidence"]:
            if e["item"] in photos and not e.get("quote"):
                continue
            quotes += 1
            quotes_found += e["item"] in texts and quote_found(e.get("quote"), texts[e["item"]])
    return Score(
        passed=expected <= set(proposed) and set(proposed) <= fine,
        expected=len(expected),
        found=len(expected & set(proposed)),
        proposed=len(proposed),
        fitting=sum(c in fine for c in proposed),
        quotes=quotes,
        quotes_found=quotes_found,
    )


def share(part: int, whole: int) -> str:
    return f"{part / whole:.0%} ({part}/{whole})" if whole else "n/a"


def photo_of(source: dict) -> bytes:
    """The case's photo: an image file, or the largest image on a report page."""
    if "file" in source:
        return (REPO / source["file"]).read_bytes()
    import pymupdf

    doc = pymupdf.open(REPO / source["pdf"])
    images = doc[source["page"] - 1].get_image_info(xrefs=True)
    largest = max(images, key=lambda image: image["width"] * image["height"])
    return doc.extract_image(largest["xref"])["image"]


def main(only: list[str]) -> None:
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    cases = [c for c in cases if not only or c["id"] in only]
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    jsonl = results / f"{datetime.now(UTC):%Y-%m-%d}.jsonl"
    rows, scores, model = [], [], None
    for case in cases:
        photos = [(p["label"], photo_of(p["source"])) for p in case.get("photos", [])]
        try:
            proposal = interpret_images(photos, case["texts"], case.get("location"))
        except InterpretationError as error:
            proposal = {"error": str(error), "categories": []}
        model = proposal.get("model", model)
        s = score(case, proposal["categories"])
        scores.append(s)
        record = {"case": case["id"], "at": datetime.now(UTC).isoformat(), **proposal}
        with jsonl.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        got = ", ".join(c["category"] for c in proposal["categories"]) or "none"
        verdict = "pass" if s.passed else "FAIL"
        rows.append(
            f"| {case['id']} | {', '.join(case['expected'])} | {got} | {verdict} "
            f"| {s.quotes_found}/{s.quotes} |"
        )
        print(f"{case['id']}: expected {', '.join(case['expected'])}, proposed {got} ({verdict})")
        if "error" in proposal:
            print(f"   {proposal['error']}")

    passed = sum(s.passed for s in scores)
    quotes = sum(s.quotes for s in scores)
    found = sum(s.quotes_found for s in scores)
    summary = [
        f"- Cases passed: {share(passed, len(scores))} (target {TARGET_PASS:.0%})",
        f"- Recall: {share(sum(s.found for s in scores), sum(s.expected for s in scores))}",
        f"- Precision: {share(sum(s.fitting for s in scores), sum(s.proposed for s in scores))}",
        f"- Quotes found in their item: {share(found, quotes)} (target {TARGET_QUOTES:.0%})",
    ]
    out_dir = HERE / "categories"
    out_dir.mkdir(exist_ok=True)
    name = re.sub(r"[^\w.-]", "-", model or "unknown")
    out = out_dir / f"{datetime.now(UTC):%Y-%m-%d}-{name}.md"
    out.write_text(
        "\n".join(
            [
                f"# Category suggestions, {datetime.now(UTC):%Y-%m-%d}",
                "",
                f"Model {model}, prompt {PROMPT_VERSION}, {len(scores)} cases.",
                "",
                *summary,
                "",
                "| Case | Expected | Proposed | Result | Quotes found |",
                "|---|---|---|---|---|",
                *rows,
                "",
            ]
        ),
        encoding="utf-8",
    )
    print("\n" + "\n".join(summary) + f"\nScores in {out}; proposals in {jsonl}.")


if __name__ == "__main__":
    main(sys.argv[1:])

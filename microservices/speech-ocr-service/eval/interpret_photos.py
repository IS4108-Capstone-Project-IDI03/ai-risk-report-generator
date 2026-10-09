"""Interpret each reference photo and set the proposal beside Marsh's own reading (CP-05).

Each case in eval/cases/photos.json is a photo Marsh has already written up: its
observation, caption and OFI type. The photo goes through the same interpretation
as /interpret (VISION_PROVIDER, VISION_MODEL and the prompt as configured), and
the proposal is printed beside Marsh's words. Whether a description names the
same hazard is judged by reading them; the hazard type is compared exactly.

Run from microservices/speech-ocr-service. It reads the root .env for the
provider settings and GEMINI_API_KEY (a paid-tier key: these are Marsh's photos):
    uv run --extra dev python -m eval.interpret_photos [case-id ...]

Each run makes one model call per case. Results are appended to
eval/results/<date>.jsonl with the provider, model and prompt version.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import pymupdf
from dotenv import load_dotenv

HERE = Path(__file__).parent
REPO = HERE.parents[2]
load_dotenv(REPO / ".env")

from app.processors.vision import InterpretationError, interpret_images  # noqa: E402


def photo_of(source: dict) -> bytes:
    """The case's photo: an image file, or the largest image on a report page."""
    if "file" in source:
        return (REPO / source["file"]).read_bytes()
    doc = pymupdf.open(REPO / source["pdf"])
    images = doc[source["page"] - 1].get_image_info(xrefs=True)
    largest = max(images, key=lambda image: image["width"] * image["height"])
    return doc.extract_image(largest["xref"])["image"]


def main(only: list[str]) -> None:
    cases = json.loads((HERE / "cases" / "photos.json").read_text(encoding="utf-8"))["cases"]
    cases = [c for c in cases if not only or c["id"] in only]
    results = HERE / "results"
    results.mkdir(exist_ok=True)
    out = results / f"{datetime.now(UTC):%Y-%m-%d}.jsonl"
    matched = 0
    for case in cases:
        try:
            proposal = interpret_images([photo_of(case["source"])], case["location"], case["note"])
        except InterpretationError as error:
            proposal = {"error": str(error)}
        same_type = proposal.get("hazard_type") == case["marsh"]["type"]
        matched += same_type
        record = {"case": case["id"], "at": datetime.now(UTC).isoformat(), **proposal}
        with out.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
        print(f"\n== {case['id']}")
        print(f"   Marsh:    {case['marsh']['observation']}")
        print(f"   Proposed: {proposal.get('description', proposal.get('error'))}")
        print(
            f"   Type:     Marsh {case['marsh']['type']!r}, proposed "
            f"{proposal.get('hazard_type')!r} ({'same' if same_type else 'different'})"
        )
        print(f"   Category: {proposal.get('cope_dimension')}")
    print(f"\nHazard type matches Marsh's in {matched} of {len(cases)}. Results in {out}.")


if __name__ == "__main__":
    main(sys.argv[1:])

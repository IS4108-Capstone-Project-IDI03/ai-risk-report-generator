"""IN-05 AC12: the section rule on real chunked reports, against hand-written section page ranges.

Runs the real parse + chunk (minutes per report). Opt in with `pytest -m slow`.
Skips when eval/labelling/golden.json or the golden PDFs are absent.
"""

import json
from pathlib import Path

import pytest

from app.pipeline.chunker import chunk
from app.pipeline.parser import parse
from app.pipeline.sections import report_sections, section_label

pytestmark = pytest.mark.slow

SERVICE = Path(__file__).resolve().parents[1]
GOLDEN = SERVICE / "eval/labelling/golden.json"
# The repo root holds .local-docs; in the container image (tests at /app/tests)
# there is no repo root, and the test skips for want of PDFs.
PDFS = (SERVICE.parents[1] if len(SERVICE.parents) > 1 else SERVICE) / ".local-docs/golden/pdfs"


def expected_label(sections: list[dict], page: int) -> str:
    """Return the hand-written section of the page range containing the page."""
    for section in sections:
        if section["start"] <= page <= section["end"]:
            return section["section"]
    return "Not applicable"


def test_section_label_matches_the_section_page_ranges_on_golden_reports():
    if not GOLDEN.exists():
        pytest.skip(f"golden set missing: {GOLDEN}")
    golden = json.loads(GOLDEN.read_text()).get("sections", {})
    reports = {name: s for name, s in golden.items() if (PDFS / name).exists()}
    if not reports:
        pytest.skip(f"no golden PDFs under {PDFS}")

    # An Undefined passage is left for a person to label, not mislabelled, so it
    # is counted apart: the share tells how long the review list would be.
    total = matched = undefined = 0
    for name, sections in reports.items():
        path = str(PDFS / name)
        passages = chunk(parse(path), doc_path=path, doc_id=name)
        found = report_sections(path)
        mismatches = []
        for passage in passages:
            meta = passage["metadata"]
            if meta.get("page_start") is None:
                continue
            got = section_label("marsh_report", meta["page_start"], meta.get("page_end"), found)
            if got == "Undefined":
                undefined += 1
                print(f"  p{meta['page_start']}-{meta.get('page_end')} -> Undefined (for review)")
                continue
            want = expected_label(sections, meta["page_start"])
            total += 1
            if got == want:
                matched += 1
            else:
                mismatches.append((meta["page_start"], meta.get("headings"), got, want))
        print(f"{name}: {len(mismatches)} mismatches of {len(passages)}")
        for page, headings, got, want in mismatches:
            print(f"  p{page} {headings} -> {got}, expected {want}")

    print(f"Undefined (for review): {undefined} of {total + undefined} passages")
    assert total, "no passages with a start page"
    assert matched / total >= 0.95, f"{matched}/{total} passages match"

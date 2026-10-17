"""CB-01 issues 01 and 02 on the real NFPA 13-2022 and FM 2.81 pages.

These run the real parse (and for tables the real OCR provider), so they are
opt-in and skip unless the licensed PDFs are under `.local-docs/golden/pdfs`
(gitignored, like the labelling golden set). The hermetic versions of the same
checks are in test_columns.py and test_table_records.py.

    uv run pytest -m "slow and model" tests/test_cb01_golden.py
    uv run pytest -m live --real-ocr tests/test_cb01_golden.py     # spends on OCR
"""

from pathlib import Path

import pytest

from app.pipeline.chunker import chunk
from app.pipeline.columns import clause_jumps
from app.pipeline.parser import parse

SERVICE = Path(__file__).resolve().parents[1]
PDFS = (SERVICE.parents[1] if len(SERVICE.parents) > 1 else SERVICE) / ".local-docs/golden/pdfs"
NFPA_13 = PDFS / "NFPA 13-2022.pdf"
FM_281 = PDFS / "FM_2.81_Apr_26.pdf"


def _passages(pdf: Path, first: int, last: int) -> list[dict]:
    if not pdf.exists():
        pytest.skip(f"golden PDF missing: {pdf}")
    return chunk(parse(str(pdf), page_range=(first, last)), doc_path=str(pdf), doc_id=pdf.stem)


@pytest.mark.slow
@pytest.mark.model
def test_the_nameplate_list_follows_clause_29_4_3_on_the_real_page():
    passages = _passages(NFPA_13, 393, 393)
    text = "\n".join(p["text"] for p in passages)

    intro = text.index("29.4.3")
    items = text.index("Location of the design area")
    assert intro < items
    # Nothing from the other column sits between the intro and its list.
    assert "29.2.5" not in text[intro:items]
    assert clause_jumps([(393, p["text"]) for p in passages]) == []


@pytest.mark.live
@pytest.mark.parametrize(
    ("pdf", "pages", "title", "answer"),
    [
        (NFPA_13, (180, 181), "Hose Stream Allowance", "Extra hazard"),
        (NFPA_13, (85, 86), "Light Hazard", "Noncombustible unobstructed"),
        (FM_281, (10, 10), "", "Partial-flow trip test"),
    ],
    ids=["hose-stream", "light-hazard-coverage", "dry-valve-trip-test"],
)
def test_a_real_table_passage_carries_its_title_and_no_header_row_as_data(
    request, pdf, pages, title, answer
):
    if not request.config.getoption("--real-ocr"):
        pytest.skip("needs --real-ocr: reads tables with the configured OCR provider")
    passages = [p for p in _passages(pdf, *pages) if p["metadata"].get("table_id")]

    holding = [p for p in passages if answer.lower() in p["text"].lower()]
    assert holding, f"no table passage holds {answer!r}"
    best = holding[0]
    assert title.lower() in best["text"].lower() or title == ""
    assert len(best["text"]) < 2000  # one table or row group, not several tables
    first_line = best["text"].splitlines()[0]
    assert not first_line.startswith("Occupancy: Occupancy")  # a header row is not data

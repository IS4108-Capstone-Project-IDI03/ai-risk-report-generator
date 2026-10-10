"""Live Gemini OCR smoke test: real crops from the FM-200 manual, real API call.

Opt in with ``uv run pytest -m live -s tests/test_ocr_live.py``. Needs
GEMINI_API_KEY (paid tier) in the repo's .env. Asserts only the shape of the
answer; the printed text is for a person to check against the PDF.
"""

import os
from pathlib import Path

import pymupdf
import pytest
from dotenv import load_dotenv

from app.pipeline.chunking_helper import ocr_model
from app.pipeline.chunking_helper.image_crop import crop_png

pytestmark = pytest.mark.live

load_dotenv(Path(__file__).resolve().parents[3] / ".env")

FM200 = Path(__file__).parent / "test_files" / "Tyco Hygood FM-200 Engineered Manual.pdf"
# Top-left-origin boxes found with PyMuPDF: the first table on page 48 and the
# agent-weight formula on page 49 (padded so the whole line is in the crop).
TABLE_PAGE, TABLE_BOX = 48, (71, 153, 524, 382)
FORMULA_PAGE, FORMULA_BOX = 49, (126, 174, 300, 198)


@pytest.fixture(autouse=True)
def gemini_provider(monkeypatch):
    if not os.getenv("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY is not set in .env")
    monkeypatch.setenv("OCR_PROVIDER", "gemini")


def _crop(page: int, box: tuple) -> bytes:
    with pymupdf.open(FM200) as document:
        return crop_png(document, box, page, coord_origin="TOPLEFT", dpi=200)


def test_live_table_crop_reads_as_records():
    text = ocr_model.recognise(_crop(TABLE_PAGE, TABLE_BOX), "table")

    print(f"\n--- page {TABLE_PAGE} table ---\n{text}")
    assert text and ":" in text


def test_live_formula_crop_reads_as_latex():
    text = ocr_model.recognise(_crop(FORMULA_PAGE, FORMULA_BOX), "formula")

    print(f"\n--- page {FORMULA_PAGE} formula ---\n{text}")
    assert text and "W" in text

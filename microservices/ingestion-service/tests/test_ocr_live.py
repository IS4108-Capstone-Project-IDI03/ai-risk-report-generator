"""Live OCR smoke test: real crops from the FM-200 manual, real API call.

Opt in with ``uv run pytest -m live -s tests/test_ocr_live.py``. Uses the
OCR_PROVIDER / OCR_MODEL in the environment or the repo's .env (anthropic or
gemini) and that provider's key. Asserts only the shape of the answer; the
printed text is for a person to check against the PDF.
"""

import os
from pathlib import Path

import pymupdf
import pytest
from dotenv import dotenv_values

from app.pipeline.chunking_helper import ocr_model
from app.pipeline.chunking_helper.image_crop import crop_png

pytestmark = pytest.mark.live

# Read in the fixture, never loaded into os.environ at import: collection imports
# this module even when it is deselected, and .env must not leak into other tests.
ENV_FILE = Path(__file__).resolve().parents[3] / ".env"
FM200 = Path(__file__).parent / "test_files" / "Tyco Hygood FM-200 Engineered Manual.pdf"
# Top-left-origin boxes found with PyMuPDF: the first table on page 48 and the
# agent-weight formula on page 49 (padded so the whole line is in the crop).
TABLE_PAGE, TABLE_BOX = 48, (71, 153, 524, 382)
FORMULA_PAGE, FORMULA_BOX = 49, (126, 174, 300, 198)


KEY_FOR = {"anthropic": "ANTHROPIC_API_KEY", "gemini": "GEMINI_API_KEY"}


def _setting(name: str) -> str | None:
    """The process environment wins over .env, as with load_dotenv."""
    return os.getenv(name) or dotenv_values(ENV_FILE).get(name)


@pytest.fixture(autouse=True)
def api_provider(monkeypatch):
    provider = _setting("OCR_PROVIDER")
    if provider not in KEY_FOR:
        pytest.skip(f"OCR_PROVIDER must be one of {sorted(KEY_FOR)} for the live test")
    key = _setting(KEY_FOR[provider])
    if not key:
        pytest.skip(f"{KEY_FOR[provider]} is not set")
    monkeypatch.setenv("OCR_PROVIDER", provider)
    monkeypatch.setenv(KEY_FOR[provider], key)
    model = _setting("OCR_MODEL")
    if model:
        monkeypatch.setenv("OCR_MODEL", model)


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

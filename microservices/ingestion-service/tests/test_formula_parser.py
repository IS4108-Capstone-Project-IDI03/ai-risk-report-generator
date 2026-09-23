"""Formula region decoding (IN-03, Phase 4).

`parse_formula_bbox` crops a formula region out of a PDF page and asks GLM-OCR to
re-read it. Formula enrichment is OFF in the parser, so this is where the formula
text actually comes from.

The OCR call is faked, so no model runs and no network is touched. A small
one-page PDF is generated per test rather than parsing the FM-200 fixture, which
keeps the suite fast.
"""

import pymupdf
import pytest

from app.pipeline.chunking_helper import formula_parser, page_cache

PAGE_WIDTH = 300
PAGE_HEIGHT = 400
LATEX = "E = mc^2"


@pytest.fixture(autouse=True)
def _reset_cache():
    """The PDF handle is shared module state; clear it around each test."""
    page_cache.close_document()
    yield
    page_cache.close_document()


@pytest.fixture
def pdf_path(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.insert_text((50, 200), "E = mc^2")
    out = tmp_path / "formula.pdf"
    doc.save(str(out))
    doc.close()
    return str(out)


@pytest.fixture
def fake_recognise(monkeypatch):
    """Record what the OCR layer was asked to read, and return canned LaTeX."""
    calls: list[dict] = []

    def _recognise(image_png, task):
        calls.append({"image": image_png, "task": task})
        return LATEX

    monkeypatch.setattr(formula_parser, "recognise", _recognise)
    return calls


def parse(pdf_path, bbox=(40, 180, 160, 220), page=1, **kwargs):
    return formula_parser.parse_formula_bbox(bbox=bbox, page=page, file_path=pdf_path, **kwargs)


# --- happy path ---------------------------------------------------------------


def test_returns_recognised_text(pdf_path, fake_recognise):
    assert parse(pdf_path, coord_origin="TOPLEFT") == LATEX


def test_uses_the_formula_task_prompt(pdf_path, fake_recognise):
    parse(pdf_path, coord_origin="TOPLEFT")
    # Must request formula recognition, not the table or generic text prompt.
    assert fake_recognise[0]["task"] == "formula"


def test_sends_png_bytes(pdf_path, fake_recognise):
    parse(pdf_path, coord_origin="TOPLEFT")
    assert fake_recognise[0]["image"].startswith(b"\x89PNG\r\n\x1a\n")


def test_reuses_the_shared_document_handle(pdf_path, fake_recognise):
    parse(pdf_path, coord_origin="TOPLEFT")
    parse(pdf_path, coord_origin="TOPLEFT")
    # Two formulas in one document must not reopen the file.
    assert page_cache.cached_path() == pdf_path
    assert len(fake_recognise) == 2


def test_table_and_formula_share_the_same_handle(pdf_path, fake_recognise, monkeypatch):
    """The regression: separate caches meant two open handles per document."""
    from app.pipeline.chunking_helper import table_parser

    monkeypatch.setattr(table_parser, "recognise", lambda image_png, task: "| a |")

    parse(pdf_path, coord_origin="TOPLEFT")
    first = page_cache.load_document(pdf_path)

    table_parser.parse_table(bbox=(40, 180, 160, 220), page=1, file_path=pdf_path)

    assert page_cache.load_document(pdf_path) is first


# --- coordinate origins -------------------------------------------------------


def test_bottom_left_origin_is_flipped(pdf_path, fake_recognise):
    """t=380,b=340 bottom-left is a valid region near the top of a 400pt page."""
    result = parse(pdf_path, bbox=(40, 380, 160, 340), coord_origin="BOTTOMLEFT")
    assert result == LATEX
    assert len(fake_recognise) == 1


def test_missing_coord_origin_defaults_to_bottom_left(pdf_path, fake_recognise):
    # Docling's default origin is bottom-left, so "" must flip too.
    assert parse(pdf_path, bbox=(40, 380, 160, 340)) == LATEX


def test_unordered_bbox_is_normalised(pdf_path, fake_recognise):
    assert parse(pdf_path, bbox=(160, 220, 40, 180), coord_origin="TOPLEFT") == LATEX


# --- guards -------------------------------------------------------------------


def test_page_out_of_range_returns_none_without_calling_ocr(pdf_path, fake_recognise):
    # The fixture has one page; page 2 is out of range.
    assert parse(pdf_path, page=2) is None
    assert fake_recognise == []


def test_page_zero_returns_none_without_calling_ocr(pdf_path, fake_recognise):
    # Docling pages are 1-based; page 0 must be rejected, not wrapped to -1.
    assert parse(pdf_path, page=0) is None
    assert fake_recognise == []


def test_degenerate_bbox_returns_none_without_calling_ocr(pdf_path, fake_recognise):
    # A zero-width box (e.g. a detected rule) yields no crop.
    assert parse(pdf_path, bbox=(50, 50, 50, 120), coord_origin="TOPLEFT") is None
    assert fake_recognise == []


def test_ocr_failure_returns_none(pdf_path, monkeypatch):
    monkeypatch.setattr(formula_parser, "recognise", lambda image_png, task: None)
    # Caller keeps Docling's original chunk text when the formula cannot be read.
    assert parse(pdf_path, coord_origin="TOPLEFT") is None

"""Table region decoding (IN-03, Phase 3).

`parse_table` crops a table bbox out of the PDF and asks GLM-OCR to re-read it as
Markdown. The OCR call is faked so the crop/guard/return contract is exercised
without a model or a network. A one-page PDF is generated per test.
"""

import pymupdf
import pytest

from app.pipeline.chunking_helper import page_cache, table_parser

PAGE_WIDTH = 300
PAGE_HEIGHT = 400
MARKDOWN = "| Agent | Qty |\n| --- | --- |\n| FM-200 | 2 |"


@pytest.fixture(autouse=True)
def _reset_cache():
    page_cache.close_document()
    yield
    page_cache.close_document()


@pytest.fixture
def pdf_path(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.insert_text((50, 200), "Agent Qty FM-200 2")
    out = tmp_path / "table.pdf"
    doc.save(str(out))
    doc.close()
    return str(out)


@pytest.fixture
def fake_recognise(monkeypatch):
    """Record what the OCR layer was asked to read, and return canned Markdown."""
    calls: list[dict] = []

    def _recognise(image_png, task):
        calls.append({"image": image_png, "task": task})
        return MARKDOWN

    monkeypatch.setattr(table_parser, "recognise", _recognise)
    return calls


# --- happy path ---------------------------------------------------------------


def test_returns_markdown_from_ocr(pdf_path, fake_recognise):
    assert parse(pdf_path) == MARKDOWN


def parse(pdf_path, bbox=(40, 180, 260, 240), page=1, **kwargs):
    return table_parser.parse_table(bbox=bbox, page=page, file_path=pdf_path, **kwargs)


def test_uses_the_table_task_prompt(pdf_path, fake_recognise):
    parse(pdf_path)
    # Must request table recognition, not generic text.
    assert fake_recognise[0]["task"] == "table"


def test_sends_png_bytes(pdf_path, fake_recognise):
    parse(pdf_path)
    assert fake_recognise[0]["image"].startswith(b"\x89PNG\r\n\x1a\n")


def test_reuses_the_shared_document_handle(pdf_path, fake_recognise):
    parse(pdf_path)
    parse(pdf_path)
    # Two tables in one document must not reopen the file.
    assert page_cache.cached_path() == pdf_path
    assert len(fake_recognise) == 2


def test_coord_origin_is_forwarded(pdf_path, fake_recognise):
    """A top-left bbox must not be flipped; both origins should still decode."""
    assert parse(pdf_path, coord_origin="TOPLEFT") == MARKDOWN
    assert len(fake_recognise) == 1


# --- guards -------------------------------------------------------------------


def test_page_out_of_range_returns_none_without_calling_ocr(pdf_path, fake_recognise):
    assert parse(pdf_path, page=2) is None
    assert fake_recognise == []


def test_degenerate_bbox_returns_none_without_calling_ocr(pdf_path, fake_recognise):
    assert parse(pdf_path, bbox=(50, 50, 50, 120), coord_origin="TOPLEFT") is None
    assert fake_recognise == []


def test_ocr_failure_returns_none(pdf_path, monkeypatch):
    monkeypatch.setattr(table_parser, "recognise", lambda image_png, task: None)
    # A table the model could not read is dropped, not indexed empty.
    assert parse(pdf_path) is None

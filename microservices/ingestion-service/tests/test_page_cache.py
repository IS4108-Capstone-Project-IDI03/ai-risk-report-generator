"""Shared PDF handle cache (IN-03, Phase 1).

`page_cache` keeps one open PyMuPDF document for the file currently being
chunked, so cropping N regions opens the file once rather than N times. These
tests pin the reuse / reopen / close behaviour, including the case that
previously leaked: switching documents must not leave the old handle open.
"""

import pymupdf
import pytest

from app.pipeline.chunking_helper import page_cache

PAGE_WIDTH = 300
PAGE_HEIGHT = 400


def _make_pdf(path, pages: int = 1) -> str:
    doc = pymupdf.open()
    for _ in range(pages):
        doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    doc.save(str(path))
    doc.close()
    return str(path)


@pytest.fixture(autouse=True)
def _reset_cache():
    """The cache is module state; clear it around every test."""
    page_cache.close_document()
    yield
    page_cache.close_document()


@pytest.fixture
def pdf_path(tmp_path):
    return _make_pdf(tmp_path / "doc.pdf")


def test_load_document_returns_open_handle(pdf_path):
    doc = page_cache.load_document(pdf_path)
    assert doc.page_count == 1
    assert page_cache.cached_path() == pdf_path


def test_same_path_reuses_the_same_handle(pdf_path):
    first = page_cache.load_document(pdf_path)
    second = page_cache.load_document(pdf_path)
    assert first is second


def test_different_path_reopens_and_closes_the_previous_handle(pdf_path, tmp_path):
    first = page_cache.load_document(pdf_path)
    other = _make_pdf(tmp_path / "other.pdf")

    second = page_cache.load_document(other)

    assert first is not second
    assert page_cache.cached_path() == other
    # The regression this guards: the previous handle must be released, not
    # merely forgotten, when the cache switches documents.
    assert first.is_closed


def test_close_document_clears_state(pdf_path):
    page_cache.load_document(pdf_path)
    page_cache.close_document()
    assert page_cache.cached_path() is None


def test_close_document_is_idempotent_when_nothing_is_open():
    # Must be a no-op rather than an AttributeError/NameError.
    page_cache.close_document()
    page_cache.close_document()
    assert page_cache.cached_path() is None


def test_load_after_close_reopens(pdf_path):
    page_cache.load_document(pdf_path)
    page_cache.close_document()
    reopened = page_cache.load_document(pdf_path)
    assert reopened.page_count == 1
    assert not reopened.is_closed

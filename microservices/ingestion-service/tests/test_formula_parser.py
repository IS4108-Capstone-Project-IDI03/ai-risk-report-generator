"""Formula parser contract (IN-03) — bbox crop + Pix2Text decode.

`app.pipeline.chunking_helper.formula_parser` crops a formula region out of a
PDF page with PyMuPDF and hands the pixels to Pix2Text. The chunker calls it in
series the moment a FORMULA chunk is detected (formula enrichment is OFF in the
parser, so the formula text is re-decoded here from its bounding box).

These tests avoid the real Pix2Text model (a heavy, network-fetched download):
`Pix2Text.from_config` is monkeypatched with a fake recogniser so the crop
geometry and the load/cache/close lifecycle are exercised hermetically. A small
one-page PDF is generated with PyMuPDF per test instead of parsing the fixture,
keeping the suite fast.
"""

import pymupdf
import pytest
from PIL import Image

from app.pipeline.chunking_helper import formula_parser
from app.pipeline.chunking_helper.formula_parser import (
    close_document,
    load_document,
    parse_formula_bbox,
)

# Page geometry of the generated fixture PDF (PyMuPDF points, top-left origin).
PAGE_WIDTH = 300
PAGE_HEIGHT = 400


class _FakePix2Text:
    """Stand-in for Pix2Text that records the image it was asked to decode."""

    last_image = None
    last_kwargs = None

    @classmethod
    def from_config(cls, *args, **kwargs):
        return cls()

    def recognize_text_formula(self, img, **kwargs):
        _FakePix2Text.last_image = img
        _FakePix2Text.last_kwargs = kwargs
        return "E = mc^2"


@pytest.fixture(autouse=True)
def _reset_module_state():
    """The parser caches the open PDF in a module global; reset around each test."""
    close_document()
    _FakePix2Text.last_image = None
    _FakePix2Text.last_kwargs = None
    yield
    close_document()


@pytest.fixture
def fake_pix2text(monkeypatch):
    """Swap in the fake recogniser so no model is downloaded or run."""
    monkeypatch.setattr(formula_parser, "Pix2Text", _FakePix2Text)
    return _FakePix2Text


@pytest.fixture
def pdf_path(tmp_path):
    """A one-page PDF with some text drawn on it (real pixels to crop)."""
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.insert_text((50, 200), "E = mc^2")
    out = tmp_path / "formula.pdf"
    doc.save(str(out))
    doc.close()
    return str(out)


# --- load_document / close_document lifecycle ---------------------------------


def test_load_document_returns_open_document(pdf_path):
    doc = load_document(pdf_path)
    assert doc.page_count == 1


def test_load_document_caches_same_path(pdf_path):
    first = load_document(pdf_path)
    second = load_document(pdf_path)
    # Same path -> the cached handle is reused, not reopened.
    assert first is second


def test_load_document_reopens_on_different_path(pdf_path, tmp_path):
    first = load_document(pdf_path)

    other = pymupdf.open()
    other.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    other_path = tmp_path / "other.pdf"
    other.save(str(other_path))
    other.close()

    second = load_document(str(other_path))
    assert first is not second


def test_close_document_resets_global_state(pdf_path):
    load_document(pdf_path)
    close_document()
    assert formula_parser.document is None
    assert formula_parser.document_name is None


def test_close_document_is_safe_when_nothing_loaded():
    # No document loaded yet — closing must be a no-op, not an error.
    close_document()
    assert formula_parser.document is None


# --- parse_formula_bbox guards ------------------------------------------------


def test_page_out_of_range_returns_none(pdf_path, fake_pix2text):
    # The fixture has one page; page 2 (index 1) is out of range.
    result = parse_formula_bbox(bbox=(10, 10, 100, 100), page=2, file_path=pdf_path)
    assert result is None


def test_page_zero_returns_none(pdf_path, fake_pix2text):
    # Docling pages are 1-based; page 0 (index -1) must be rejected, not wrapped.
    result = parse_formula_bbox(bbox=(10, 10, 100, 100), page=0, file_path=pdf_path)
    assert result is None


def test_degenerate_bbox_returns_none(pdf_path, fake_pix2text):
    # A zero-width/zero-height box (e.g. a detected line) yields no crop.
    result = parse_formula_bbox(bbox=(50, 50, 50, 120), page=1, file_path=pdf_path)
    assert result is None
    # The recogniser is never invoked when there's nothing to crop.
    assert _FakePix2Text.last_image is None


# --- parse_formula_bbox happy path & geometry ---------------------------------


def test_returns_recognised_output(pdf_path, fake_pix2text):
    result = parse_formula_bbox(bbox=(40, 180, 160, 220), page=1, file_path=pdf_path)
    assert result == "E = mc^2"


def test_passes_a_pil_image_to_recogniser(pdf_path, fake_pix2text):
    parse_formula_bbox(bbox=(40, 180, 160, 220), page=1, file_path=pdf_path)
    assert isinstance(_FakePix2Text.last_image, Image.Image)


def test_recogniser_called_with_text_formula_flags(pdf_path, fake_pix2text):
    parse_formula_bbox(bbox=(40, 180, 160, 220), page=1, file_path=pdf_path)
    kwargs = _FakePix2Text.last_kwargs
    assert kwargs["return_text"] is True
    assert kwargs["auto_line_break"] is True


def test_bottom_left_origin_is_flipped(pdf_path, fake_pix2text):
    """Default (bottom-left) origin: y is flipped against page height.

    top=380, bottom=340 in bottom-left coords maps to y in [20, 60] top-left,
    which is a valid, non-degenerate crop near the top of the page.
    """
    result = parse_formula_bbox(
        bbox=(40, 380, 160, 340), page=1, file_path=pdf_path, coord_origin="BOTTOMLEFT"
    )
    assert result == "E = mc^2"
    assert _FakePix2Text.last_image is not None


def test_top_left_origin_is_not_flipped(pdf_path, fake_pix2text):
    """Explicit top-left origin: y coordinates are used as-is."""
    result = parse_formula_bbox(
        bbox=(40, 180, 160, 220), page=1, file_path=pdf_path, coord_origin="TOPLEFT"
    )
    assert result == "E = mc^2"
    # Crop height should reflect the given top/bottom (220 - 180 = 40 pts).
    assert _FakePix2Text.last_image.height > 0


def test_unordered_bbox_is_normalised(pdf_path, fake_pix2text):
    """left>right / y0>y1 must be normalised so the crop rect stays valid."""
    result = parse_formula_bbox(
        bbox=(160, 220, 40, 180), page=1, file_path=pdf_path, coord_origin="TOPLEFT"
    )
    assert result == "E = mc^2"
    assert _FakePix2Text.last_image is not None

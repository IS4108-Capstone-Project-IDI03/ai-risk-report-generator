"""Region cropping geometry (IN-03, Phase 1).

`crop_section` turns a Docling bbox into rendered pixels. The tests cover the
two things that silently corrupt OCR input if wrong: the bottom-left -> top-left
y flip, and the render resolution. A one-page PDF is generated per test so no
fixture parse is needed.
"""

import pymupdf
import pytest

from app.pipeline.chunking_helper.image_crop import (
    RENDER_DPI,
    crop_png,
    crop_section,
)

PAGE_WIDTH = 300
PAGE_HEIGHT = 400


@pytest.fixture
def document(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.insert_text((50, 200), "E = mc^2")
    path = tmp_path / "crop.pdf"
    doc.save(str(path))
    doc.close()

    opened = pymupdf.open(str(path))
    yield opened
    opened.close()


# --- guards -------------------------------------------------------------------


def test_page_beyond_document_returns_none(document):
    assert crop_section(document, (10, 10, 100, 100), page=2) is None


def test_page_zero_returns_none(document):
    # Docling pages are 1-based; page 0 would index -1 and silently wrap.
    assert crop_section(document, (10, 10, 100, 100), page=0) is None


def test_zero_width_bbox_returns_none(document):
    assert crop_section(document, (50, 50, 50, 120), page=1, coord_origin="TOPLEFT") is None


def test_zero_height_bbox_returns_none(document):
    assert crop_section(document, (40, 80, 160, 80), page=1, coord_origin="TOPLEFT") is None


# --- geometry -----------------------------------------------------------------


def test_top_left_origin_is_used_as_is(document):
    pixmap = crop_section(document, (40, 180, 160, 220), page=1, coord_origin="TOPLEFT")
    assert pixmap is not None
    # 40pt wide x 40pt tall region, scaled by the render zoom.
    scale = RENDER_DPI / 72
    assert pixmap.width == pytest.approx(120 * scale, abs=2)
    assert pixmap.height == pytest.approx(40 * scale, abs=2)


def test_bottom_left_origin_is_flipped_against_page_height(document):
    """t=380,b=340 bottom-left maps to y 20..60 top-left on a 400pt page."""
    flipped = crop_section(document, (40, 380, 160, 340), page=1, coord_origin="BOTTOMLEFT")
    explicit = crop_section(document, (40, 20, 160, 60), page=1, coord_origin="TOPLEFT")

    assert flipped is not None and explicit is not None
    assert (flipped.width, flipped.height) == (explicit.width, explicit.height)


def test_missing_coord_origin_defaults_to_bottom_left(document):
    """Docling's default origin is bottom-left, so "" must flip too."""
    default = crop_section(document, (40, 380, 160, 340), page=1)
    bottom_left = crop_section(document, (40, 380, 160, 340), page=1, coord_origin="BOTTOMLEFT")

    assert default is not None and bottom_left is not None
    assert (default.width, default.height) == (bottom_left.width, bottom_left.height)


def test_unordered_bbox_is_normalised(document):
    """left>right / top<bottom must still produce a valid rect."""
    reversed_box = crop_section(document, (160, 220, 40, 180), page=1, coord_origin="TOPLEFT")
    ordered = crop_section(document, (40, 180, 160, 220), page=1, coord_origin="TOPLEFT")

    assert reversed_box is not None and ordered is not None
    assert (reversed_box.width, reversed_box.height) == (ordered.width, ordered.height)


# --- render resolution --------------------------------------------------------


def test_render_dpi_is_above_the_pymupdf_default(document):
    """Crops must be rendered above 72 DPI or OCR cannot read small glyphs."""
    assert RENDER_DPI > 72

    box = (40, 180, 160, 220)
    default_dpi = crop_section(document, box, page=1, coord_origin="TOPLEFT", dpi=72)
    high_dpi = crop_section(document, box, page=1, coord_origin="TOPLEFT")

    assert high_dpi.width > default_dpi.width
    assert high_dpi.height > default_dpi.height


def test_higher_dpi_yields_more_pixels(document):
    low = crop_section(document, (40, 180, 160, 220), page=1, coord_origin="TOPLEFT", dpi=100)
    high = crop_section(document, (40, 180, 160, 220), page=1, coord_origin="TOPLEFT", dpi=300)
    assert high.width > low.width


# --- crop_png -----------------------------------------------------------------


def test_crop_png_returns_png_bytes(document):
    data = crop_png(document, (40, 180, 160, 220), page=1, coord_origin="TOPLEFT")
    assert isinstance(data, bytes)
    # PNG magic number, so we know the OCR client is handed a real PNG.
    assert data.startswith(b"\x89PNG\r\n\x1a\n")


def test_crop_png_returns_none_for_degenerate_region(document):
    assert crop_png(document, (50, 50, 50, 120), page=1, coord_origin="TOPLEFT") is None

"""Picture region reading (IN-13).

`parse_picture` crops a picture bbox out of the PDF and asks the OCR layer to
describe it. The OCR call is faked so the crop/guard/return contract is exercised
without a model or a network. A one-page PDF is generated per test.
"""

import pymupdf
import pytest

from app.pipeline.chunking_helper import page_cache, picture_parser

PAGE_WIDTH = 300
PAGE_HEIGHT = 400
DESCRIPTION = "Image description (generated, photograph): A pump room."
# Bottom-left origin, as Docling reports it: a 200 x 150 pt picture.
PICTURE_BOX = (50, 350, 250, 200)


@pytest.fixture(autouse=True)
def _reset_cache():
    page_cache.close_document()
    yield
    page_cache.close_document()


@pytest.fixture
def pdf_path(tmp_path):
    doc = pymupdf.open()
    page = doc.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    page.draw_rect(pymupdf.Rect(50, 50, 250, 200), color=(0, 0, 0), fill=(0.5, 0.5, 0.5))
    out = tmp_path / "picture.pdf"
    doc.save(str(out))
    doc.close()
    return str(out)


@pytest.fixture
def fake_recognise(monkeypatch):
    """Record what the OCR layer was asked to read, and return a canned description."""
    calls: list[dict] = []

    def _recognise(image_png, task, context=""):
        calls.append({"image": image_png, "task": task, "context": context})
        return DESCRIPTION

    monkeypatch.setattr(picture_parser, "recognise", _recognise)
    return calls


def parse(pdf_path, bbox=PICTURE_BOX, page=1, **kwargs):
    return picture_parser.parse_picture(bbox=bbox, page=page, file_path=pdf_path, **kwargs)


def test_a_picture_is_cropped_and_described_with_its_context(pdf_path, fake_recognise):
    reading = parse(pdf_path, context="Caption: Figure 3 Pump room")

    assert reading == DESCRIPTION
    [call] = fake_recognise
    assert call["task"] == "picture"
    assert call["context"] == "Caption: Figure 3 Pump room"
    assert call["image"].startswith(b"\x89PNG\r\n\x1a\n")


def test_a_logo_sized_picture_is_skipped_without_a_call(pdf_path, fake_recognise):
    # 200 pt wide but only 40 pt tall: a logo or icon, not worth a paid reading.
    assert parse(pdf_path, bbox=(50, 350, 250, 310)) is None
    assert fake_recognise == []


def test_a_page_out_of_range_returns_none_without_a_call(pdf_path, fake_recognise):
    assert parse(pdf_path, page=2) is None
    assert fake_recognise == []


def test_a_picture_left_unread_returns_none(pdf_path, monkeypatch):
    # GLM, or a provider that gave up: the chunker keeps the caption and prose only.
    monkeypatch.setattr(picture_parser, "recognise", lambda image_png, task, context="": None)
    assert parse(pdf_path) is None

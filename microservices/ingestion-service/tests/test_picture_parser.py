"""Picture region reading (IN-13).

`parse_picture` crops a picture bbox out of the PDF and asks the OCR layer to
describe it. The OCR call is faked so the crop/guard/return contract is exercised
without a model or a network. A one-page PDF is generated per test. With protection on
(PV-06), faces are blurred first by privacy-service, faked as `fake_privacy`.
"""

import cv2
import httpx
import numpy as np
import pymupdf
import pytest

from app.pipeline.chunking_helper import page_cache, picture_parser
from app.privacy import PrivacyUnavailable, session

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


# PV-06: with protection on, faces are blurred before the OCR model sees the crop.
PRIVACY = {"enabled": True, "known_entities": []}


def _solid(colour: tuple[int, int, int], extension: str = ".jpg") -> bytes:
    """A small image of one colour (BGR), as privacy-service's blurred JPEG stands in for."""
    image = np.full((20, 20, 3), colour, np.uint8)
    return cv2.imencode(extension, image)[1].tobytes()


def _looks(image: bytes, colour: tuple[int, int, int]) -> bool:
    """Whether `image` is `colour` (BGR), give or take JPEG's rounding."""
    pixel = cv2.imdecode(np.frombuffer(image, np.uint8), cv2.IMREAD_COLOR)[10, 10]
    return all(abs(int(got) - want) <= 3 for got, want in zip(pixel, colour))


def test_with_protection_the_ocr_model_reads_the_crop_with_faces_blurred(
    pdf_path, fake_recognise, fake_privacy
):
    fake_privacy.blurred = _solid((0, 0, 255))

    parse(pdf_path, protection=session(PRIVACY))

    [request] = fake_privacy.requests
    assert len(request["images"]) == 1  # the crop went to /redact-image
    [call] = fake_recognise
    assert _looks(call["image"], (0, 0, 255))


def test_a_blurred_crop_reaches_the_ocr_model_as_a_png(pdf_path, fake_recognise, fake_privacy):
    # privacy-service answers a crop with a face as JPEG; the OCR providers send image/png.
    fake_privacy.blurred = _solid((0, 0, 255))

    parse(pdf_path, protection=session(PRIVACY))

    [call] = fake_recognise
    assert call["image"].startswith(b"\x89PNG\r\n\x1a\n")


@pytest.mark.parametrize("protection", [None, session({"enabled": False})])
def test_without_protection_the_crop_is_sent_as_cropped(
    pdf_path, fake_recognise, fake_privacy, protection
):
    # A guard, passing when first run: the blur only runs for a session that is on.
    fake_privacy.blurred = _solid((0, 0, 255))

    parse(pdf_path, protection=protection)

    assert fake_privacy.requests == []
    [call] = fake_recognise
    assert not _looks(call["image"], (0, 0, 255))  # the crop itself, not a blurred copy


@pytest.mark.parametrize("failure", [httpx.ConnectError("down"), 503])
def test_when_faces_cannot_be_blurred_the_crop_is_not_sent(
    pdf_path, fake_recognise, fake_privacy, failure
):
    # A guard, passing when first run: /redact-image fails closed as /mask does (Rule 3).
    fake_privacy.failure = failure

    with pytest.raises(PrivacyUnavailable):
        parse(pdf_path, protection=session(PRIVACY))

    assert fake_recognise == []

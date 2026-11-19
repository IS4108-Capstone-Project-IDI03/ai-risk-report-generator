"""IN-18: a manual clause's screenshot is read by OCR_PROVIDER before the admin checks it."""

import io
import time

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import usage
from app.main import app
from app.pipeline.chunking_helper import ocr_model

client = TestClient(app)
DOC_ID = "6abb28ae16068a0793e99999"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def screenshot(fmt: str) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", (40, 20), "white").save(out, format=fmt)
    return out.getvalue()


@pytest.fixture
def read(monkeypatch):
    """Stands in for the OCR provider: records each call and its usage, answers `answer`."""
    calls = []
    state = {"answer": "Pipe size: 25 mm; Max area: 12 m²", "calls": calls}

    def recognise(image_png, task, context=""):
        calls.append({"png": image_png, "task": task, "context": context})
        usage.record("ocr", "anthropic", "claude", time.perf_counter(), input_tokens=50)
        return state["answer"]

    monkeypatch.setattr(ocr_model, "recognise", recognise)
    return state


def post(image: bytes, kind="table", **form):
    files = {"file": ("shot", image, "application/octet-stream")}
    return client.post("/recognise", files=files, data={"kind": kind, "documentId": DOC_ID, **form})


@pytest.mark.parametrize("fmt", ["PNG", "JPEG"])
def test_a_screenshot_is_read_as_a_png_and_its_text_returned(read, fmt):
    response = post(screenshot(fmt))

    assert response.status_code == 200
    assert response.json()["text"] == "Pipe size: 25 mm; Max area: 12 m²"
    assert read["calls"][0]["task"] == "table"
    assert read["calls"][0]["png"].startswith(PNG_SIGNATURE)


def test_the_reading_is_returned_as_usage_for_the_document(read):
    used = post(screenshot("PNG")).json()["usage"]

    assert [(u["feature"], u["document_id"], u["input_tokens"]) for u in used] == [
        ("ocr", DOC_ID, 50)
    ]


def test_a_picture_is_read_with_its_heading_trail(read):
    post(screenshot("PNG"), kind="picture", context="Chapter 8 > 8.6 Hangers")

    assert read["calls"][0] == {
        "png": read["calls"][0]["png"],
        "task": "picture",
        "context": "Chapter 8 > 8.6 Hangers",
    }


def test_a_file_that_is_not_an_image_is_refused(read):
    response = post(b"%PDF-1.7 not an image")

    assert response.status_code == 422
    assert "image" in response.json()["detail"].lower()
    assert read["calls"] == []


def test_an_unknown_kind_is_refused(read):
    assert post(screenshot("PNG"), kind="chart").status_code == 422


def test_a_screenshot_the_provider_could_not_read_answers_502(read):
    read["answer"] = None

    response = post(screenshot("PNG"))

    assert response.status_code == 502
    assert "type the text" in response.json()["detail"]

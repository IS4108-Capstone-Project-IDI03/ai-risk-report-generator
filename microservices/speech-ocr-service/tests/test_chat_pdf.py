"""Tests for POST /chat-pdf/extract (CB-09): which PDFs are read and which are refused."""

import base64

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def pdf_bytes(
    pages=1, text="Sprinkler heads are spaced at 4.2 m.", picture_only=False, password=None
):
    doc = pymupdf.open()
    for n in range(pages):
        page = doc.new_page()
        if picture_only:
            pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), False)
            pix.set_rect(pix.irect, (200, 200, 200))
            page.insert_image(pymupdf.Rect(72, 72, 200, 150), pixmap=pix)
        elif text:
            page.insert_text((72, 100), f"Page {n + 1}. {text}")
    if password:
        return doc.tobytes(
            encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password, owner_pw=password
        )
    return doc.tobytes()


def extract(data: bytes):
    return client.post("/chat-pdf/extract", json={"pdf_base64": base64.b64encode(data).decode()})


def test_reads_the_text_of_each_page():
    body = extract(pdf_bytes(pages=2)).json()
    assert [p["page"] for p in body["pages"]] == [1, 2]
    assert "Sprinkler heads are spaced at 4.2 m." in body["pages"][1]["text"]
    assert body["skipped"] == []


def test_a_page_with_only_a_picture_is_skipped_and_named():
    doc = pymupdf.open()
    doc.new_page().insert_text((72, 100), "Words on page one.")
    pix = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 60, 40), False)
    pix.set_rect(pix.irect, (200, 200, 200))
    doc.new_page().insert_image(pymupdf.Rect(72, 72, 200, 150), pixmap=pix)
    body = extract(doc.tobytes()).json()
    assert [p["page"] for p in body["pages"]] == [1]
    assert body["skipped"] == [2]


@pytest.mark.parametrize(
    ("data", "reason"),
    [
        (b"", "empty"),
        (b"This is plain text renamed to .pdf\n", "not a PDF"),
        (pdf_bytes(pages=21), "over 20 pages"),
        (pdf_bytes(picture_only=True), "no readable text"),
        (pdf_bytes(text=""), "no readable text"),
        (pdf_bytes(password="secret"), "password-protected"),
        (pdf_bytes()[:200], "could not be"),
    ],
    # Short ids: pytest puts each id in an env var, which Windows caps at 32,767 chars.
    ids=["empty", "not-pdf", "too-many-pages", "picture-only", "no-text", "password", "truncated"],
)
def test_refuses_what_it_cannot_read_and_says_why(data, reason):
    response = extract(data)
    assert response.status_code == 422
    assert reason in response.json()["detail"]


def test_rejects_bad_base64():
    assert client.post("/chat-pdf/extract", json={"pdf_base64": "!!"}).status_code == 422

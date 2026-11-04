"""Tests for POST /extract-text (CP-23): reads PDF, .docx, .eml and .msg into plain text.

OCR is always mocked here; the real OCR model is never loaded.
"""

import io
from email.message import EmailMessage
from types import SimpleNamespace

import docx
import pymupdf
from starlette.testclient import TestClient as TestClient

from app import extract_text
from app.labelling import config
from app.main import app

client = TestClient(app)


def post(filename: str, data: bytes):
    return client.post("/extract-text", params={"filename": filename}, content=data)


def make_pdf(*page_texts: str) -> bytes:
    # A typed page needs 20+ letters (MIN_TEXT_CHARS), or it is read as a scan and real OCR runs.
    doc = pymupdf.open()
    for text in page_texts:
        page = doc.new_page()
        if text:
            page.insert_text((72, 72), text)
    return doc.tobytes()


def make_docx() -> bytes:
    document = docx.Document()
    document.add_paragraph("Warehouse at 5 Tuas Road")
    table = document.add_table(rows=1, cols=2)
    table.rows[0].cells[0].text = "Sum insured"
    table.rows[0].cells[1].text = "SGD 2,000,000"
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def make_eml(*attachments: tuple[str, bytes, str, str]) -> bytes:
    msg = EmailMessage()
    msg["From"] = "Alice <alice@example.com>"
    msg["To"] = "bob@example.com"
    msg["Subject"] = "New client"
    msg["Date"] = "Mon, 03 Nov 2026 09:00:00 +0800"
    msg.set_content("Please arrange cover for Acme Pte Ltd.")
    for name, data, maintype, subtype in attachments:
        msg.add_attachment(data, maintype=maintype, subtype=subtype, filename=name)
    return msg.as_bytes()


def test_text_pdf():
    response = post("policy.pdf", make_pdf("Hello fire risk survey for the warehouse"))
    assert response.status_code == 200
    [doc] = response.json()["documents"]
    assert doc["name"] == "policy.pdf"
    assert "Hello fire risk survey for the warehouse" in doc["text"]


def test_scanned_page_goes_through_ocr(monkeypatch):
    calls = []
    monkeypatch.setattr(extract_text, "ocr_page", lambda pdf, n: calls.append(n) or "Scanned words")
    response = post("scan.pdf", make_pdf("Typed page with a long enough text layer", ""))
    text = response.json()["documents"][0]["text"]
    assert calls == [2]
    assert "Typed page" in text and "Scanned words" in text


def test_ocr_stops_at_the_page_cap_and_says_so(monkeypatch):
    calls = []
    monkeypatch.setattr(config, "OCR_MAX_PAGES", 2)
    monkeypatch.setattr(extract_text, "ocr_page", lambda pdf, n: calls.append(n) or f"Scan {n}")
    pdf = make_pdf("Typed page with a long enough text layer", "", "", "")
    text = post("scan.pdf", pdf).json()["documents"][0]["text"]
    assert calls == [2, 3]
    assert "Scan 3" in text and "Scan 4" not in text
    assert text.endswith("[Pages after 3 were not read: scanned]")


def test_a_page_whose_ocr_fails_is_skipped_and_the_rest_read(monkeypatch):
    def ocr(pdf, number):
        if number == 2:
            raise RuntimeError("OCR model crashed")
        return f"Scan {number}"

    monkeypatch.setattr(extract_text, "ocr_page", ocr)
    pdf = make_pdf("Typed page with a long enough text layer", "", "")
    response = post("scan.pdf", pdf)
    assert response.status_code == 200
    text = response.json()["documents"][0]["text"]
    assert "Typed page" in text and "Scan 3" in text


def test_docx_paragraphs_and_tables():
    response = post("brief.docx", make_docx())
    text = response.json()["documents"][0]["text"]
    assert "Warehouse at 5 Tuas Road" in text
    assert "Sum insured" in text and "SGD 2,000,000" in text


def test_eml_headers_and_body():
    response = post("note.eml", make_eml())
    [doc] = response.json()["documents"]
    assert doc["name"] == "note.eml"
    for expected in ("alice@example.com", "bob@example.com", "New client", "Acme Pte Ltd"):
        assert expected in doc["text"]


def test_eml_html_only_body_is_stripped():
    msg = EmailMessage()
    msg["From"] = "a@example.com"
    msg["Subject"] = "Html"
    msg.set_content("<html><body><p>Hello <b>world</b></p></body></html>", subtype="html")
    text = post("h.eml", msg.as_bytes()).json()["documents"][0]["text"]
    assert "Hello world" in text and "<b>" not in text


def test_eml_attachments_become_their_own_documents():
    attachment = ("quote.pdf", make_pdf("Quote body for the new policy"), "application", "pdf")
    response = post("note.eml", make_eml(attachment))
    names = [d["name"] for d in response.json()["documents"]]
    assert names == ["note.eml", "Attachment: quote.pdf (from note.eml)"]
    assert "Quote body" in response.json()["documents"][1]["text"]


def test_unreadable_attachment_is_listed_as_failed_and_the_rest_kept():
    good = ("quote.pdf", make_pdf("Quote body for the new policy"), "application", "pdf")
    broken = ("broken.pdf", b"not a pdf", "application", "pdf")
    empty = ("blank.docx", b"", "application", "octet-stream")
    response = post("note.eml", make_eml(broken, good, empty))
    assert response.status_code == 200
    names = [d["name"] for d in response.json()["documents"]]
    assert names == ["note.eml", "Attachment: quote.pdf (from note.eml)"]
    # With the same words as a top-level file's refusal, so the screen explains it.
    assert response.json()["failed"] == [
        {
            "name": "Attachment: broken.pdf (from note.eml)",
            "size": 9,
            "reason": "broken.pdf could not be opened. It may be damaged or not a real .pdf file.",
        },
        {
            "name": "Attachment: blank.docx (from note.eml)",
            "size": 0,
            "reason": "blank.docx is empty.",
        },
    ]


def test_doc_attachment_is_listed_with_how_to_fix_it():
    legacy = ("old form.doc", b"\xd0\xcf\x11\xe0 word 97", "application", "msword")
    response = post("note.eml", make_eml(legacy))
    assert len(response.json()["documents"]) == 1
    assert response.json()["failed"] == [
        {
            "name": "Attachment: old form.doc (from note.eml)",
            "size": len(legacy[1]),
            "reason": "Can't read .doc attachments. Save it as .docx or PDF and add it.",
        }
    ]


def test_eml_skips_image_attachments():
    # Logos and signatures aren't documents, so they aren't listed as failed either.
    response = post("note.eml", make_eml(("logo.png", b"\x89PNG....", "image", "png")))
    assert len(response.json()["documents"]) == 1
    assert response.json()["failed"] == []


def test_msg_body_and_attachment(monkeypatch):
    # No .msg writer exists, so the reader library is faked. See report: real .msg untested.
    attachment = SimpleNamespace(file_name="brief.docx", file_bytes=make_docx())
    fake = SimpleNamespace(
        sender="Alice <alice@example.com>",
        recipients=[SimpleNamespace(email_address="bob@example.com")],
        sent_date=None,
        subject="Via Outlook",
        body="Outlook body text",
        html_body=None,
        attachments=[attachment],
    )
    monkeypatch.setattr(extract_text.oxmsg.Message, "load", staticmethod(lambda data: fake))
    response = post("mail.msg", b"ignored")
    [first, second] = response.json()["documents"]
    assert "Via Outlook" in first["text"] and "Outlook body text" in first["text"]
    assert second["name"] == "Attachment: brief.docx (from mail.msg)"
    assert "Warehouse" in second["text"]


def test_corrupt_msg_is_422():
    response = post("mail.msg", b"not an outlook file")
    assert response.status_code == 422


def test_corrupt_pdf_is_422():
    response = post("bad.pdf", b"not a pdf")
    assert response.status_code == 422
    assert "bad.pdf" in response.json()["detail"]


def test_corrupt_docx_is_422():
    assert post("bad.docx", b"not a docx").status_code == 422


def test_not_really_an_email_is_422():
    assert post("bad.eml", b"\x00\x01\x02 no headers here").status_code == 422


def test_unknown_extension_is_415():
    assert post("data.xlsx", b"whatever").status_code == 415

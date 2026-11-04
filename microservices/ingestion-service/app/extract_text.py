"""Reads an uploaded PDF, .docx, .eml or .msg into plain-text documents (CP-23).

Called by POST /extract-text in app/api/routes.py. Calls pymupdf, python-docx, the stdlib
`email` package and python-oxmsg (MIT). Writes nothing anywhere.
"""

import io
import logging
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser

import docx
import oxmsg
import pymupdf

from app.labelling import config
from app.labelling.pages import MIN_TEXT_CHARS, ocr_page

SUPPORTED = (".pdf", ".docx", ".eml", ".msg")
# The gateway converts a top-level .doc to PDF first; an attached one can't be
# converted here, so it is listed as failed. Other types (images, signatures)
# aren't documents and are skipped.
ATTACHED_DOC = ".doc"
DOC_REASON = "Can't read .doc attachments. Save it as .docx or PDF and add it."

logger = logging.getLogger(__name__)


class UnsupportedType(Exception):
    """The file extension is not one we read."""


class Unreadable(Exception):
    """The file could not be opened; the message is plain English for the user."""


def extract_documents(filename: str, data: bytes) -> tuple[list[dict], list[dict]]:
    """Return ([{"name", "text"}], [{"name", "size", "reason"}]): the documents read (the
    file first, then its email attachments) and the attachments that couldn't be read."""
    ext = _ext(filename)
    if ext not in SUPPORTED:
        raise UnsupportedType(filename)
    text, attachments = _read(ext, filename, data)
    documents = [{"name": filename, "text": text}]
    failed = []
    for name, payload in attachments:
        attached = _ext(name)
        if attached not in SUPPORTED + (ATTACHED_DOC,):
            continue
        label = f"Attachment: {name} (from {filename})"
        # The same words as a top-level file's refusal, so the screen can explain it.
        if attached == ATTACHED_DOC:
            reason = DOC_REASON
        elif not payload:
            reason = f"{name} is empty."
        else:
            # One level only: an attached email's own attachments are not opened.
            try:
                attached_text, _ = _read(attached, name, payload)
                documents.append({"name": label, "text": attached_text})
                continue
            except Unreadable as err:
                # Without this, one damaged attachment would fail the whole email.
                reason = str(err)
        failed.append({"name": label, "size": len(payload), "reason": reason})
    return documents, failed


def _ext(name: str) -> str:
    return name[name.rfind(".") :].lower() if "." in name else ""


def _read(ext: str, name: str, data: bytes) -> tuple[str, list[tuple[str, bytes]]]:
    """Return (text, attachments) for one file."""
    readers = {".pdf": _pdf, ".docx": _docx, ".eml": _eml, ".msg": _msg}
    try:
        result = readers[ext](data)
    except Unreadable:
        raise
    except Exception as err:
        # Without this, a corrupt upload would surface as a 500 instead of a readable message.
        raise Unreadable(
            f"{name} could not be opened. It may be damaged or not a real {ext} file."
        ) from err
    return result if isinstance(result, tuple) else (result, [])


def _pdf(data: bytes) -> str:
    pages = []
    scanned = []  # page numbers read by OCR
    skipped = False
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass:
            raise Unreadable(
                "This PDF is password-protected. Remove the password and upload it again."
            )
        for number, page in enumerate(doc, start=1):
            text = page.get_text()
            if len("".join(text.split())) < MIN_TEXT_CHARS:  # no text layer: it is a scan
                # OCR takes ~5 s a page; without the cap a long scan would hold the request.
                if len(scanned) < config.OCR_MAX_PAGES:
                    scanned.append(number)
                    try:
                        text = ocr_page(data, number)
                    except Exception:
                        # Without this, one OCR failure would fail the whole PDF as damaged.
                        logger.exception("OCR failed on page %d", number)
                else:
                    skipped = True
            pages.append(text.strip())
    if skipped:  # so the AI knows the document goes on beyond what it was given
        pages.append(f"[Pages after {scanned[-1]} were not read: scanned]")
    return "\n\n".join(pages)


def _docx(data: bytes) -> str:
    document = docx.Document(io.BytesIO(data))
    lines = [p.text for p in document.paragraphs]
    for table in document.tables:
        lines += [" | ".join(cell.text for cell in row.cells) for row in table.rows]
    return "\n".join(lines)


def _eml(data: bytes) -> tuple[str, list[tuple[str, bytes]]]:
    msg = BytesParser(policy=policy.default).parsebytes(data)
    if not (msg["From"] or msg["Subject"] or msg["Date"]):
        raise Unreadable("This does not look like an email file (no From, Subject or Date).")
    body = msg.get_body(preferencelist=("plain", "html"))
    body_text = body.get_content() if body else ""
    if body and body.get_content_type() == "text/html":
        body_text = _strip_html(body_text)
    attachments = []
    for part in msg.iter_attachments():
        name = part.get_filename() or ""
        if part.get_content_type() == "message/rfc822":
            attachments.append((name or "message.eml", part.get_content().as_bytes()))
        elif name:
            attachments.append((name, part.get_payload(decode=True) or b""))
    header = _header(msg["From"], msg["To"], msg["Cc"], msg["Date"], msg["Subject"])
    return f"{header}\n\n{body_text}".strip(), attachments


def _msg(data: bytes) -> tuple[str, list[tuple[str, bytes]]]:
    message = oxmsg.Message.load(data)
    to = ", ".join(r.email_address or "" for r in message.recipients)
    body = message.body or _strip_html(message.html_body or "")
    header = _header(message.sender, to, None, message.sent_date, message.subject)
    attachments = [(a.file_name, a.file_bytes or b"") for a in message.attachments if a.file_name]
    return f"{header}\n\n{body}".strip(), attachments


def _header(sender, to, cc, date, subject) -> str:
    pairs = [("From", sender), ("To", to), ("Cc", cc), ("Date", date), ("Subject", subject)]
    return "\n".join(f"{label}: {value}" for label, value in pairs if value)


class _TextOnly(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data):
        self.parts.append(data)


def _strip_html(html: str) -> str:
    parser = _TextOnly()
    parser.feed(html)
    return " ".join("".join(parser.parts).split())

"""Reads the text of a PDF attached to a chat question (CB-09). Stateless: bytes in, pages out.

Called by app/api/routes.py (/chat-pdf/extract). Text layer only: scanned pages are not read.
"""

import pymupdf

MAX_PAGES = 20
# A page longer than this is cut, so one dense page cannot swamp the answer model's input.
MAX_PAGE_CHARS = 8000


class PdfRefused(Exception):
    """Why a PDF cannot be used, in words shown to the engineer."""


def extract_pages(data: bytes) -> dict:
    """{pages: [{page, text}], skipped: [page numbers with no text]}, or raise PdfRefused."""
    if not data:
        raise PdfRefused("That PDF is empty.")
    if not data.startswith(b"%PDF-"):
        raise PdfRefused("That file is not a PDF.")
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as error:
        raise PdfRefused("That PDF could not be opened.") from error
    if doc.needs_pass:
        raise PdfRefused("That PDF is password-protected.")
    if doc.page_count > MAX_PAGES:
        raise PdfRefused(f"That PDF is over {MAX_PAGES} pages ({doc.page_count}).")
    pages, skipped = [], []
    for number, page in enumerate(doc, 1):
        text = page.get_text().strip()
        if text:
            pages.append({"page": number, "text": text[:MAX_PAGE_CHARS]})
        else:
            skipped.append(number)
    if not pages:
        raise PdfRefused("That PDF has no readable text. Scanned pages are not supported.")
    return {"pages": pages, "skipped": skipped}

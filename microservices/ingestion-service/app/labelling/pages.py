"""Reads the first pages of a PDF as text, OCR-ing pages with no text layer (IN-05).

Called by app/labelling/__init__.py. Calls pymupdf, and Docling for scanned pages.
"""

import logging
from functools import cache
from threading import Lock
from io import BytesIO

import pymupdf

from app.labelling import config

logger = logging.getLogger(__name__)
MIN_TEXT_CHARS = 20  # fewer non-space characters than this = no text layer
# /label runs in FastAPI's threadpool, and one Docling converter is not documented as
# thread-safe: without this, several scanned uploads at once could fail OCR silently.
# ponytail: one global lock, so OCR of concurrent uploads queues; fine for an admin upload.
_ocr_lock = Lock()


@cache
def _converter():
    # Lazy import: Docling is heavy, and most documents never need OCR.
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    from app.pipeline.ocr_config import get_ocr_options

    options = PdfPipelineOptions(
        do_ocr=True, ocr_options=get_ocr_options()[0], do_table_structure=False
    )
    return DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )


def ocr_page(pdf: bytes, number: int) -> str:
    """Return the OCR text of one page (1-based) using the IN-06 engine selection."""
    from docling.datamodel.base_models import DocumentStream

    source = DocumentStream(name="label.pdf", stream=BytesIO(pdf))
    with _ocr_lock:
        result = _converter().convert(source, page_range=(number, number))
    return result.document.export_to_markdown()


def read_pages(pdf: bytes) -> list[tuple[int, str]]:
    """Return (page number, text) for the first LABEL_PAGES pages."""
    out = []
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        for index in range(min(config.pages(), doc.page_count)):
            number = index + 1
            text = doc[index].get_text()
            if len("".join(text.split())) < MIN_TEXT_CHARS and number <= config.OCR_MAX_PAGES:
                try:
                    text = ocr_page(pdf, number)
                except Exception:
                    # Without this, one OCR failure would stop labelling the whole document.
                    logger.exception("OCR failed on page %d", number)
            out.append((number, text))
    return out


def wrap(pages: list[tuple[int, str]]) -> str:
    """Return the pages as one <document> string, each inside a <page n="..."> tag."""
    body = "\n".join(f'<page n="{n}">{text}</page>' for n, text in pages)
    return f"<document>\n{body}\n</document>"

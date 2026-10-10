"""Parse table region.

Docling table parsing has poor accuracy, especially for nested tables and tables
with merged cells.

The PDF handle (`page_cache`) and the OCR client (`ocr_model`) are both shared
process-wide, so decoding N tables opens the file once and reuses one HTTP
connection pool.

Numeric guard (log-only): when the page has a text layer, every number the OCR
provider returns should appear in the text inside the same box. Numbers that do
not are logged with the page, so misread tables can be found; the reading itself
is kept unchanged.
"""

import logging
import re

import pymupdf

from app.pipeline.chunking_helper.image_crop import convert_bbox, crop_png
from app.pipeline.chunking_helper.ocr_model import recognise
from app.pipeline.chunking_helper.page_cache import PDF_LOCK, load_document

log = logging.getLogger(__name__)

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def numbers_not_in_text_layer(reading: str, text_layer: str) -> list[str]:
    """Numbers in `reading` that `text_layer` lacks; [] when there is no text layer (a scan)."""
    printed = set(_NUMBER.findall(text_layer))
    if not printed:
        return []
    return sorted({n for n in _NUMBER.findall(reading) if n not in printed}, key=float)


def parse_table(bbox, page: int, file_path: str, coord_origin: str = "") -> str | None:
    """Crop one table region and return its record text, or None.
    Returns None when the region cannot be cropped (page out of range,
    degenerate rect) or when OCR returned nothing. The caller drops the table
    rather than indexing an empty chunk.
    """
    with PDF_LOCK:
        document = load_document(file_path)
        image_png = crop_png(document, bbox, page, coord_origin=coord_origin)
        if image_png is None:
            return None
        page_obj = document[page - 1]
        text_layer = page_obj.get_text(
            clip=pymupdf.Rect(*convert_bbox(bbox, page_obj, coord_origin))
        )

    reading = recognise(image_png, task="table")
    missing = numbers_not_in_text_layer(reading, text_layer) if reading else []
    if missing:
        log.warning(
            "Table on page %s: OCR returned numbers not in the PDF text: %s",
            page,
            ", ".join(missing),
        )
    return reading

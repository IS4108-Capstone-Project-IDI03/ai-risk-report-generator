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

Text-layer fallback: when every OCR answer was refused, cut off or invalid
(OcrAnswerUnusable), the table's rows are read from the PDF text instead, one
record per row without headings. A region with no text layer, or with fewer than
`MIN_FALLBACK_ROWS` rows, stays unread.
"""

import logging
import re

import pymupdf

from app.pipeline.chunking_helper.image_crop import convert_bbox, crop_png
from app.pipeline.chunking_helper.ocr_model import recognise
from app.pipeline.chunking_helper.page_cache import PDF_LOCK, load_document
from app.pipeline.chunking_helper.table_text import TableText, render_tables
from app.pipeline.errors import OcrAnswerUnusable

log = logging.getLogger(__name__)

_NUMBER = re.compile(r"\d+(?:\.\d+)?")
MIN_FALLBACK_ROWS = 2


def numbers_not_in_text_layer(reading: str, text_layer: str) -> list[str]:
    """Numbers in `reading` that `text_layer` lacks; [] when there is no text layer (a scan)."""
    printed = set(_NUMBER.findall(text_layer))
    if not printed:
        return []
    return sorted({n for n in _NUMBER.findall(reading) if n not in printed}, key=float)


def text_layer_rows(page_obj: pymupdf.Page, clip: pymupdf.Rect) -> list[str]:
    """The table's rows in `clip`, each as its words in reading order; [] if none found.

    `find_tables` finds the rows (strategy "text": many tables have no ruling
    lines). Its column edges can cut words in two, so each row's words are taken
    whole from the text layer instead of from its cells.
    """
    words = page_obj.get_text("words", clip=clip)
    rows = []
    found = page_obj.find_tables(clip=clip, strategy="text", min_words_vertical=4)
    for table in found.tables:
        for row in table.rows:
            box = pymupdf.Rect(row.bbox)
            inside = sorted(
                (
                    w
                    for w in words
                    if box.contains(pymupdf.Point((w[0] + w[2]) / 2, (w[1] + w[3]) / 2))
                ),
                key=lambda w: (round(w[3]), w[0]),
            )
            text = " ".join(w[4] for w in inside)
            if text:
                rows.append(text)
    return rows


def _read_text_layer(bbox, page: int, file_path: str, coord_origin: str) -> str | None:
    with PDF_LOCK:
        page_obj = load_document(file_path)[page - 1]
        clip = pymupdf.Rect(*convert_bbox(bbox, page_obj, coord_origin))
        rows = text_layer_rows(page_obj, clip)
    if len(rows) < MIN_FALLBACK_ROWS:
        log.warning(
            "Table on page %s: OCR gave no usable reading and the PDF text has no table "
            "there; the table is left unread.",
            page,
        )
        return None
    log.warning(
        "Table on page %s: OCR gave no usable reading; read %s rows from the PDF text "
        "instead, without headings.",
        page,
        len(rows),
    )
    return render_tables([TableText(records=rows)])


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

    try:
        reading = recognise(image_png, task="table", raise_if_unusable=True)
    except OcrAnswerUnusable:
        return _read_text_layer(bbox, page, file_path, coord_origin)
    if reading is None:
        log.warning("Table on page %s: OCR gave no reading; the table is left unread.", page)
    missing = numbers_not_in_text_layer(reading, text_layer) if reading else []
    if missing:
        log.warning(
            "Table on page %s: OCR returned numbers not in the PDF text: %s",
            page,
            ", ".join(missing),
        )
    return reading

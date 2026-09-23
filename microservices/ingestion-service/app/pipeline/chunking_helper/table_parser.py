"""Decode a table region into Markdown via GLM-OCR (IN-03).

Docling's HybridChunker linearises a table into prose and may split a large one
mid-row, which destroys the row/column/header associations that make a table
worth retrieving at all. So the chunker skips Docling's text for table chunks and
sends the table's bounding box here instead: crop the region out of the page and
ask GLM-OCR to re-read it as a Markdown table.

The PDF handle (`page_cache`) and the OCR client (`ocr_model`) are both shared
process-wide, so decoding N tables opens the file once and reuses one HTTP
connection pool.
"""

from app.pipeline.chunking_helper.image_crop import crop_png
from app.pipeline.chunking_helper.ocr_model import recognise
from app.pipeline.chunking_helper.page_cache import load_document


def parse_table(bbox, page: int, file_path: str, coord_origin: str = "") -> str | None:
    """Crop one table region and return its Markdown, or None.

    Args:
        bbox: Docling's ``(l, t, r, b)`` for the table.
        page: Docling's 1-based page number.
        file_path: path to the source PDF (NOT the doc_id).
        coord_origin: Docling's coord_origin for the bbox.

    Returns None when the region cannot be cropped (page out of range,
    degenerate rect) or when OCR returned nothing. The caller drops the table
    rather than indexing an empty chunk.
    """
    document = load_document(file_path)

    image_png = crop_png(document, bbox, page, coord_origin=coord_origin)
    if image_png is None:
        return None

    return recognise(image_png, task="table")

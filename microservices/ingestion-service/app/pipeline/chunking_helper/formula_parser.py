"""Decode a formula region into LaTeX/Markdown via GLM-OCR (IN-03).

Formula enrichment is OFF in the parser (it multiplied parse time even on pages
with no formulas), so Docling replaces formula text with
``<!-- formula-not-decoded -->``. The chunker therefore re-reads the region here
from its bounding box.

Unlike a table, a formula is not a separate Docling item we can isolate: it sits
inside ordinary text items, so the chunker passes the union bbox of the whole
chunk (see `chunker._chunk_bbox`). The recognised text consequently replaces the
chunk's text rather than becoming a chunk of its own.

Shares the process-wide PDF handle (`page_cache`) and OCR client (`ocr_model`)
with the table path — one model, two prompts.
"""

from app.pipeline.chunking_helper.image_crop import crop_png
from app.pipeline.chunking_helper.ocr_model import recognise
from app.pipeline.chunking_helper.page_cache import load_document


def parse_formula_bbox(bbox, page: int, file_path: str, coord_origin: str = "") -> str | None:
    """Crop one formula region and return its recognised text, or None.

    Args:
        bbox: Docling's ``(l, t, r, b)`` — normally the union box of the chunk.
        page: Docling's 1-based page number.
        file_path: path to the source PDF.
        coord_origin: Docling's coord_origin for the bbox.

    Returns None when the region cannot be cropped (page out of range,
    degenerate rect) or when OCR returned nothing, in which case the caller
    keeps Docling's original chunk text.
    """
    document = load_document(file_path)

    image_png = crop_png(document, bbox, page, coord_origin=coord_origin)
    if image_png is None:
        return None

    return recognise(image_png, task="formula")

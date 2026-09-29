"""Parse table region.

Docling table parsing has poor accuracy, especially for nested tables and tables
with merged cells.

The PDF handle (`page_cache`) and the OCR client (`ocr_model`) are both shared
process-wide, so decoding N tables opens the file once and reuses one HTTP
connection pool.
"""

from app.pipeline.chunking_helper.image_crop import crop_png
from app.pipeline.chunking_helper.ocr_model import recognise
from app.pipeline.chunking_helper.page_cache import load_document


def parse_table(bbox, page: int, file_path: str, coord_origin: str = "") -> str | None:
    """Crop one table region and return its record text, or None.
    Returns None when the region cannot be cropped (page out of range,
    degenerate rect) or when OCR returned nothing. The caller drops the table
    rather than indexing an empty chunk.
    """
    document = load_document(file_path)

    image_png = crop_png(document, bbox, page, coord_origin=coord_origin)
    if image_png is None:
        return None

    return recognise(image_png, task="table")

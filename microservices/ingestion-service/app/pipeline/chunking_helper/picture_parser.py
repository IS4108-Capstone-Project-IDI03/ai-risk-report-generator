"""Describe a picture region (IN-13).

Docling's layout model labels photos, diagrams and charts as pictures; the
chunker passes each one's own bbox here. The region is cropped like a table or
formula (shared `page_cache` handle, `PDF_LOCK`) and sent to the OCR layer's
"picture" task with its context (heading trail and caption), so the model knows
what it is looking at. The description that comes back is labelled as generated.
"""

from app.pipeline.chunking_helper.image_crop import crop_png
from app.pipeline.chunking_helper.ocr_model import recognise
from app.pipeline.chunking_helper.page_cache import PDF_LOCK, load_document

# A picture shorter than this on either side (PDF points; 72 = 1 inch) is a logo,
# icon or divider: skipped before any paid reading.
MIN_PICTURE_POINTS = 72


def parse_picture(
    bbox, page: int, file_path: str, coord_origin: str = "", context: str = ""
) -> str | None:
    """Crop one picture region and return its description, or None.

    Args:
        bbox: Docling's ``(l, t, r, b)`` for the picture.
        page: Docling's 1-based page number.
        file_path: path to the source PDF.
        coord_origin: Docling's coord_origin for the bbox.
        context: where the picture sits (heading trail, caption), sent to the model.

    Returns None when the region cannot be cropped or nothing was read (GLM, or
    the provider gave up), and for a picture under `MIN_PICTURE_POINTS` on a
    side; the caller then keeps the caption and prose only.
    """
    left, top, right, bottom = bbox
    if min(abs(right - left), abs(top - bottom)) < MIN_PICTURE_POINTS:
        return None

    with PDF_LOCK:
        document = load_document(file_path)
        image_png = crop_png(document, bbox, page, coord_origin=coord_origin)
    if image_png is None:
        return None

    return recognise(image_png, task="picture", context=context)

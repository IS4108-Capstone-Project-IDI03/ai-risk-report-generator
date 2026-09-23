import pymupdf

def crop_section(document: pymupdf.Document, bbox: tuple, page: int, coord_origin="") -> pymupdf.Pixmap:
    # Docling page_no is 1-based; pymupdf is 0-based
    if page - 1 < 0 or page - 1 >= document.page_count:
        print(
            f"Page {page} (index {page - 1}) out of range for "
            f"PDF with {document.page_count} page(s); skipping"
        )
        return None
    
    page_obj: pymupdf.Page = document[page - 1]
    height = page_obj.rect.height

    left, top, right, bottom = bbox
    if "TOP" in coord_origin.upper():
        y0, y1 = top, bottom  # already top-left
    else:
        y0, y1 = height - top, height - bottom  # bottom-left -> flip against page height
    # normalize so the rect is always valid (y0 < y1, x0 < x1) regardless of ordering
    x_lo, x_hi = min(left, right), max(left, right)
    y_lo, y_hi = min(y0, y1), max(y0, y1)
    crop_rect = pymupdf.Rect(x_lo, y_lo, x_hi, y_hi)

    # If detected bbox is a line
    if crop_rect.is_empty or crop_rect.width <= 0 or crop_rect.height <= 0:
        print(
            f"Degenerated crop rect {crop_rect} for bbox {bbox} "
            f"on page {page}; skipping"
        )
        return None

    cropped_section = page_obj.get_pixmap(clip=crop_rect)
    
    return cropped_section
"""Crop a Docling-located region out of a PDF page and render it to pixels.

Coordinate reconciliation is the whole job here. Docling reports a bbox as
``(l, t, r, b)`` against a BOTTOM-LEFT origin, while PyMuPDF's
``get_pixmap(clip=...)`` wants a TOP-LEFT origin (y grows downward, ``y0 < y1``).
The y axis is therefore flipped against the page height unless the provenance
explicitly says the origin is already top-left.

Render scale matters for OCR quality: a PDF point is 1/72 inch, so rendering at
the default scale hands the OCR model a ~72 DPI image. Small table rules and
formula subscripts are unreadable at that size, so crops are rendered through a
zoom matrix (`RENDER_DPI`) instead.
"""

import os

import pymupdf

IMAGE_DEBUG = False  # set True to pop up a Tkinter window showing the crop before sending to OCR

# Render resolution for cropped regions, unless OCR_RENDER_DPI sets another.
# 200 keeps small table digits and formula subscripts legible to the OCR model.
RENDER_DPI = 200
_PDF_POINTS_PER_INCH = 72


def render_dpi() -> int:
    """Crop resolution: OCR_RENDER_DPI when set, else `RENDER_DPI`."""
    value = os.getenv("OCR_RENDER_DPI", "").strip()
    return int(value) if value else RENDER_DPI


def convert_bbox(bbox: tuple, page_obj: pymupdf.Page, coord_origin: str) -> tuple:
    """_summary_

    Args:
        bbox (tuple): docling's ``(l, t, r, b)`` for the region.
        page_obj (pymupdf.Page): the page object of the document.
        coord_origin (str): docling's coord_origin string.
        Anything containing "TOP" is treated as top-left;
        everything else is flipped as bottom-left.

    Returns:
        tuple: return bottom-left origin bbox in PyMuPDF's ``(x0, y0, x1, y1)`` format.
    """
    height = page_obj.rect.height

    left, top, right, bottom = bbox
    if "TOP" in coord_origin.upper():
        y0, y1 = top, bottom  # already top-left
    else:
        y0, y1 = height - top, height - bottom  # bottom-left -> flip on height

    # Normalise so the rect is valid regardless of the ordering we were handed.
    x_lo, x_hi = min(left, right), max(left, right)
    y_lo, y_hi = min(y0, y1), max(y0, y1)
    return (x_lo, y_lo, x_hi, y_hi)


def crop_section(
    document: pymupdf.Document,
    bbox: tuple,
    page: int,
    coord_origin: str = "",
    dpi: int | None = None,
) -> pymupdf.Pixmap | None:
    """Render the `bbox` region of `page` to a Pixmap, or None if uncroppable.

    Args:
        document: an open PyMuPDF document.
        bbox: Docling's ``(l, t, r, b)``.
        page: Docling's 1-based page number (PyMuPDF is 0-based).
        coord_origin: Docling's coord_origin string. Anything containing "TOP"
            is treated as top-left; everything else is flipped as bottom-left.
        dpi: render resolution; defaults to `render_dpi()`.

    Returns None (rather than raising) when the page is out of range or the
    region is degenerate — a detected rule or divider can have zero width or
    height, and that is not an error worth failing the whole document over.
    """
    # Docling page numbers are 1-based; PyMuPDF indexes from 0.
    index = page - 1
    if index < 0 or index >= document.page_count:
        return None

    page_obj = document[index]

    x_lo, y_lo, x_hi, y_hi = convert_bbox(bbox, page_obj, coord_origin)
    crop_rect = pymupdf.Rect(x_lo, y_lo, x_hi, y_hi)

    if crop_rect.is_empty or crop_rect.width <= 0 or crop_rect.height <= 0:
        return None

    zoom = (dpi or render_dpi()) / _PDF_POINTS_PER_INCH
    return page_obj.get_pixmap(clip=crop_rect, matrix=pymupdf.Matrix(zoom, zoom))


def crop_png(
    document: pymupdf.Document,
    bbox: tuple,
    page: int,
    coord_origin: str = "",
    dpi: int | None = None,
) -> bytes | None:
    """`crop_section` encoded as PNG bytes, ready to send to an OCR service.

    PNG rather than JPEG: these crops are line art and small glyphs, where JPEG
    ringing costs recognition accuracy for no useful size saving.
    """
    pixmap = crop_section(document, bbox, page, coord_origin=coord_origin, dpi=dpi)
    if pixmap is None:
        return None

    if IMAGE_DEBUG:
        import io
        import tkinter as tk

        from PIL import Image, ImageTk

        root = tk.Tk()
        root.title(f"Page {page} Crop Preview")
        image = Image.open(io.BytesIO(pixmap.tobytes(output="png")))
        photo = ImageTk.PhotoImage(image)

        label = tk.Label(root, image=photo)
        label.pack()
        root.mainloop()

    return pixmap.tobytes(output="png")

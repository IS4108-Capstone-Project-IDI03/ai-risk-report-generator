import pymupdf
from PIL import Image
from pix2text import Pix2Text
from image_crop import crop_section

document = None
document_name = None


def load_document(file_path):
    """
    Load a pdf if not already loaded, and return the pymupdf.Document object
    Else return the already loaded document.
    """
    global document, document_name
    if document is None or document_name != file_path:
        document_name = file_path
        document = pymupdf.open(file_path)
        return document
    else:
        return document


def close_document():
    """
    Close the loaded document if it exists.
    Run this at the end of
    """
    global document, document_name
    if document is not None:
        document.close()
        document = None
        document_name = None


def parse_formula_bbox(bbox, page, file_path, coord_origin=""):
    """Parse a formula (and text of the chunk if exist) using Pix2Text
    Load specific page with pymupdf and crop to the box
    Returns the parsed chunk. To be ran in series with other chunking processes

    Docling's 1-based; pymupdf is 0-based, so index with ``page - 1``.
    Docling's bbox ``(l, t, r, b)`` defaults to a BOTTOM-LEFT origin
    pymupdf.Rect get_pixmap(clip=...) expect a TOP-LEFT origin (y-down, ``y0 < y1``).
    We flip the y axis against the page height ``H`` only when the origin is NOT top-left
    """
    document = load_document(file_path)

    cropped_section = crop_section(document, bbox, page, coord_origin=coord_origin)
    if cropped_section is None:
        return None
    
    pix2text = Pix2Text.from_config()

    # Recog text/formula takes in str | Path | Image
    # Need to convert pixmap to Image
    image = Image.frombytes(
        "RGB", (cropped_section.width, cropped_section.height), cropped_section.samples
    )
    output = pix2text.recognize_text_formula(img=image, return_text=True, auto_line_break=True)
    return output

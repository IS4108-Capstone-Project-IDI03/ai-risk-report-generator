"""How S5 prepares a photo before a model sees it: site photos (CP-05) and note pages (CP-19)."""

import io

from PIL import Image, ImageOps

# A photo is shrunk to this long edge before it is sent. The original in S3 is never changed.
LONG_EDGE = 1600


def upright_jpeg(image: bytes) -> bytes:
    """The photo upright, at most LONG_EDGE pixels, as JPEG bytes.

    Phones store a portrait photo's turn in its EXIF data, which the model never reads, so it
    would otherwise see the photo on its side. Raises what Pillow raises for a file it cannot
    open; each caller words that for the engineer.
    """
    with Image.open(io.BytesIO(image)) as photo:
        upright = ImageOps.exif_transpose(photo)
        upright.thumbnail((LONG_EDGE, LONG_EDGE))
        out = io.BytesIO()
        upright.convert("RGB").save(out, "JPEG", quality=85)
    return out.getvalue()

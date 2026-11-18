"""How S5 prepares a photo before a model sees it: site photos (CP-05) and note pages (CP-19)."""

import io

from PIL import Image, ImageOps

# A photo is shrunk to this long edge before it is sent. The original in S3 is never changed.
LONG_EDGE = 1600


def upright_jpeg(image: bytes, region: dict | None = None) -> bytes:
    """The photo upright, at most LONG_EDGE pixels, as JPEG bytes.

    Phones store a portrait photo's turn in its EXIF data, which the model never reads, so it
    would otherwise see the photo on its side. With a `region` ({x, y, w, h}, fractions of the
    upright photo, CP-10), only that area, cut before shrinking so a small area keeps its detail.
    Raises what Pillow raises for a file it cannot open; each caller words that for the engineer.
    """
    with Image.open(io.BytesIO(image)) as photo:
        upright = ImageOps.exif_transpose(photo)
        if region:
            width, height = upright.size
            left, top = round(region["x"] * width), round(region["y"] * height)
            right = max(left + 1, round((region["x"] + region["w"]) * width))
            bottom = max(top + 1, round((region["y"] + region["h"]) * height))
            upright = upright.crop((left, top, right, bottom))
        upright.thumbnail((LONG_EDGE, LONG_EDGE))
        out = io.BytesIO()
        upright.convert("RGB").save(out, "JPEG", quality=85)
    return out.getvalue()

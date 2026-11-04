"""Faces blurred out of a photo before it goes to an external AI API (PV-04).

YuNet (OpenCV's `FaceDetectorYN`) finds the faces; each is pixelated and then blurred, so neither
a person nor a detector can recognise it. About 100 ms for a 1600 px photo, decoding included.
"""

from pathlib import Path

import cv2
import numpy as np

MODEL = Path(__file__).parent / "models" / "face_detection_yunet_2023mar.onnx"

# How sure YuNet must be. Lower blurs more that isn't a face; higher misses turned or small faces.
SCORE_THRESHOLD = 0.5
# Each face box grows by this share of its size on every side, to cover hair, ears and chin.
PADDING = 0.4
# A face is first shrunk to this many blocks across, then blurred. At 5 or more blocks YuNet
# still finds the face it blurred; 3 leaves nothing a person or a detector could recognise.
BLOCKS = 3
# Faces are looked for on a copy at most this long, then blurred at full size: 57 ms rather than
# 133 ms at 1600 px. A face it misses is under about 17 px in the photo, too small to recognise.
DETECT_EDGE = 960


class NotAnImage(ValueError):
    """The bytes could not be read as a picture."""


def blur_faces(jpeg: bytes) -> tuple[bytes, int]:
    """The photo with every face blurred, and how many there were.

    A photo without a face comes back unchanged, byte for byte.
    """
    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise NotAnImage
    height, width = image.shape[:2]
    scale = min(1.0, DETECT_EDGE / max(height, width))
    small = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    detector = cv2.FaceDetectorYN.create(
        str(MODEL), "", (small.shape[1], small.shape[0]), SCORE_THRESHOLD
    )
    _, found = detector.detect(small)
    if found is None:
        return jpeg, 0
    for x, y, w, h in found[:, :4] / scale:
        left = max(0, int(x - w * PADDING))
        top = max(0, int(y - h * PADDING))
        right = min(width, int(x + w * (1 + PADDING)))
        bottom = min(height, int(y + h * (1 + PADDING)))
        if right <= left or bottom <= top:
            continue
        face = image[top:bottom, left:right]
        blocks = cv2.resize(face, (BLOCKS, BLOCKS), interpolation=cv2.INTER_AREA)
        face = cv2.resize(blocks, (right - left, bottom - top), interpolation=cv2.INTER_NEAREST)
        kernel = max(3, (min(right - left, bottom - top) // 4) | 1)
        image[top:bottom, left:right] = cv2.GaussianBlur(face, (kernel, kernel), 0)
    _, out = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 85])
    return out.tobytes(), len(found)

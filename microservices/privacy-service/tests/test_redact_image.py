"""Contract tests for S6's /redact-image (PV-04): faces blurred before a photo leaves.

They run the real OpenCV face detector (YuNet) on a real portrait (tests/fixtures/README.md).
"""

import base64
from pathlib import Path

import cv2
import numpy as np
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

PORTRAIT = (Path(__file__).parent / "fixtures" / "portrait.jpg").read_bytes()
YUNET = Path(__file__).parents[1] / "app" / "models" / "face_detection_yunet_2023mar.onnx"


def faces_in(jpeg: bytes) -> int:
    """How many faces the detector finds, a little more readily than /redact-image does (0.5).

    Lower than 0.4 it also "finds" a face in the fixture's helmet."""
    image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(str(YUNET), "", (width, height), 0.4)
    _, found = detector.detect(image)
    return 0 if found is None else len(found)


def redact(*images: bytes) -> dict:
    body = {"images": [base64.b64encode(image).decode("ascii") for image in images]}
    response = client.post("/redact-image", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_fixture_shows_a_face():
    assert faces_in(PORTRAIT) == 1


def test_blurs_a_face_beyond_recognition():
    result = redact(PORTRAIT)

    assert result["faces"] == [1]
    blurred = base64.b64decode(result["images"][0])
    assert faces_in(blurred) == 0


def plain(colour=(120, 120, 120), size=(320, 240)) -> bytes:
    """A photo of nothing in particular: one colour, no face."""
    image = np.full((size[1], size[0], 3), colour, np.uint8)
    return cv2.imencode(".jpg", image)[1].tobytes()


def test_a_photo_without_a_face_comes_back_unchanged():
    photo = plain()

    result = redact(photo)

    assert result["faces"] == [0]
    assert base64.b64decode(result["images"][0]) == photo


def test_several_photos_keep_their_order_and_each_its_own_count():
    # Passed when first run: the batch contract that callers rely on (Rule 2).
    photo = plain()

    result = redact(photo, PORTRAIT, photo)

    assert result["faces"] == [0, 1, 0]
    assert [base64.b64decode(i) == photo for i in result["images"]] == [True, False, True]


def test_refuses_what_is_not_a_picture_without_echoing_it():
    secret = base64.b64encode(b"John Tan S1234567D").decode("ascii")
    for images in ([secret], [base64.b64encode(plain()).decode("ascii"), "not base64!"]):
        response = client.post("/redact-image", json={"images": images})

        assert response.status_code == 422
        assert "John Tan" not in response.text and secret not in response.text


def test_blurs_a_face_in_a_full_size_photo():
    # Guards detecting on a smaller copy: S5 sends photos up to 1600 px on the long edge.
    image = cv2.imdecode(np.frombuffer(PORTRAIT, np.uint8), cv2.IMREAD_COLOR)
    full = cv2.imencode(".jpg", cv2.resize(image, (1280, 1600)))[1].tobytes()

    result = redact(full)

    assert result["faces"] == [1]
    assert faces_in(base64.b64decode(result["images"][0])) == 0

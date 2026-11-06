"""Tests for the chat photo routes (CB-08): the face check and the description. No network."""

import base64
import json

from fastapi.testclient import TestClient

from app import privacy
from app.main import app
from app.processors import vision
from tests.test_describe_photo import FakeGemini, FakeS3, use_fakes

client = TestClient(app)
KEY = "chat-photos/u1/p.jpg"


def test_face_check_counts_faces_and_returns_the_blurred_photo(monkeypatch, fake_privacy):
    s3 = FakeS3()
    monkeypatch.setattr(vision.boto3, "client", lambda *args, **kwargs: s3)

    response = client.post("/chat-photo/faces", json={"s3_key": KEY})

    assert response.status_code == 200
    body = response.json()
    assert s3.requested == KEY
    assert body["faces"] == 1
    assert base64.b64decode(body["blurred_base64"])[:2] == b"\xff\xd8"  # a JPEG
    # Faces are always looked for here, whatever the client-details setting says.
    assert fake_privacy.paths() == ["/redact-image"]


def test_face_check_returns_no_copy_when_there_are_no_faces(monkeypatch):
    monkeypatch.setattr(vision.boto3, "client", lambda *args, **kwargs: FakeS3())
    monkeypatch.setattr(
        privacy, "_post", lambda path, body, *a, **k: {"images": body["images"], "faces": [0]}
    )

    body = client.post("/chat-photo/faces", json={"s3_key": KEY}).json()

    assert body == {"faces": 0, "blurred_base64": None}


def test_face_check_fails_closed_when_privacy_service_is_down(monkeypatch, fake_privacy):
    monkeypatch.setattr(vision.boto3, "client", lambda *args, **kwargs: FakeS3())
    fake_privacy.failure = 503

    response = client.post("/chat-photo/faces", json={"s3_key": KEY})

    assert response.status_code == 502
    assert "privacy service" in response.json()["detail"]


def test_describes_what_the_photo_shows_and_what_is_unclear(monkeypatch):
    use_fakes(
        monkeypatch,
        FakeS3(),
        output_text=json.dumps(
            {
                "description": "A wet-pipe sprinkler riser with a closed valve.",
                "unclear": "The gauge reading is blurred.",
            }
        ),
    )

    body = client.post("/chat-photo/describe", json={"s3_key": KEY}).json()

    assert body["description"] == "A wet-pipe sprinkler riser with a closed valve."
    assert body["unclear"] == "The gauge reading is blurred."
    # Only the photo is sent: no question, so no client words reach Gemini.
    texts = [p["text"] for p in FakeGemini.request["input"] if p["type"] == "text"]
    assert texts == ["Describe this photo."]
    assert "do not guess" in FakeGemini.request["system_instruction"].lower()
    assert body["usage"][0]["feature"] == "describe_photo"


def test_description_failure_says_why(monkeypatch):
    use_fakes(monkeypatch, FakeS3(fail=True))
    response = client.post("/chat-photo/describe", json={"s3_key": KEY})
    assert response.status_code == 502
    assert "could not be read" in response.json()["detail"]

"""Tests for POST /describe-photo (CP-22), against fake S3 and Gemini clients. No network."""

import io
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.processors import vision

client = TestClient(app)


class FakeS3:
    def __init__(self, fail=False):
        self.fail = fail
        self.requested = None

    def get_object(self, Bucket, Key):
        if self.fail:
            raise RuntimeError("NoSuchKey")
        self.requested = Key
        out = io.BytesIO()
        Image.new("RGB", (60, 40), "grey").save(out, "JPEG")
        return {"Body": io.BytesIO(out.getvalue())}


class FakeGemini:
    reply = {}
    request = None
    error = None

    class Client:
        def __init__(self, api_key=None, http_options=None):
            def create(**request):
                if FakeGemini.error:
                    raise FakeGemini.error
                FakeGemini.request = request
                return SimpleNamespace(model="gemini-3.8-flash", **FakeGemini.reply)

            self.interactions = SimpleNamespace(create=create)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            pass


USAGE = SimpleNamespace(total_input_tokens=800, total_output_tokens=30, total_thought_tokens=5)


def use_fakes(monkeypatch, s3, **reply):
    FakeGemini.error = None
    FakeGemini.request = None
    FakeGemini.reply = {
        "status": "completed",
        "output_text": json.dumps({"description": "A hose reel with its valve shut."}),
        "usage": USAGE,
        **reply,
    }
    monkeypatch.setattr(vision.boto3, "client", lambda *args, **kwargs: s3)
    monkeypatch.setattr(vision, "genai", FakeGemini)


def describe(key="photos/RPT-1/p.jpg"):
    return client.post("/describe-photo", json={"s3_key": key})


def test_describes_a_photo_and_records_usage(monkeypatch):
    s3 = FakeS3()
    use_fakes(monkeypatch, s3)

    response = describe()

    assert response.status_code == 200
    body = response.json()
    assert s3.requested == "photos/RPT-1/p.jpg"
    assert body["description"] == "A hose reel with its valve shut."
    [usage] = body["usage"]
    assert usage["feature"] == "describe_photo"
    assert usage["billed_service"] == "gemini-vision"
    assert usage["model"] == "gemini-3.8-flash"
    assert usage["input_tokens"] == 800
    assert usage["output_tokens"] == 35
    assert usage["usage_status"] == "recorded"


def test_sends_only_the_photo_and_keeps_nothing(monkeypatch):
    use_fakes(monkeypatch, FakeS3())

    describe()

    request = FakeGemini.request
    assert [part["type"] for part in request["input"]] == ["image", "text"]
    assert request["store"] is False


def test_reports_a_photo_that_cannot_be_read(monkeypatch):
    use_fakes(monkeypatch, FakeS3(fail=True))

    response = describe()

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The photo could not be read from storage")


def test_reports_why_gemini_failed(monkeypatch):
    use_fakes(monkeypatch, FakeS3())
    FakeGemini.error = RuntimeError("quota")

    response = describe()

    assert response.status_code == 502
    assert "could not be described" in response.json()["detail"]


def test_reports_a_blocked_answer(monkeypatch):
    use_fakes(monkeypatch, FakeS3(), status="failed", output_text=None)

    assert describe().status_code == 502


def test_an_unsupported_provider_is_not_hardcoded_away(monkeypatch):
    use_fakes(monkeypatch, FakeS3())
    monkeypatch.setattr(vision, "VISION_PROVIDER", "other")

    assert describe().status_code == 502


def test_requires_s3_key():
    assert client.post("/describe-photo", json={}).status_code == 422

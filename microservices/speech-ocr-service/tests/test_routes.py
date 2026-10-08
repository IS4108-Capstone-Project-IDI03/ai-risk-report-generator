"""Contract tests for S5's HTTP surface.

OCR is still a stub, so its test asserts the response *shape* the gateway
depends on. STT runs against fake S3 and OpenAI clients.
"""

import io

from fastapi.testclient import TestClient

from app.main import app
from app.processors import stt

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "speech-ocr"}


class FakeS3:
    def __init__(self, fail=False):
        self.fail = fail
        self.requested = None

    def get_object(self, Bucket, Key):
        if self.fail:
            raise RuntimeError("NoSuchKey")
        self.requested = Key
        return {"Body": io.BytesIO(b"fake audio")}


class FakeOpenAI:
    error = None
    file = None
    response_format = None
    duration = 4.2  # None means the mock returns no duration

    def __init__(self):
        self.audio = self
        self.transcriptions = self

    def create(self, model, file, response_format):
        if FakeOpenAI.error:
            raise FakeOpenAI.error
        FakeOpenAI.file = file
        FakeOpenAI.response_format = response_format
        attrs = {"text": "Sprinkler valve chained open."}
        if FakeOpenAI.duration is not None:
            attrs["duration"] = FakeOpenAI.duration
        return type("Result", (), attrs)()


def use_fakes(monkeypatch, s3, duration=4.2):
    FakeOpenAI.error = None
    FakeOpenAI.duration = duration
    monkeypatch.setattr(stt.boto3, "client", lambda *args, **kwargs: s3)
    monkeypatch.setattr(stt, "OpenAI", FakeOpenAI)


def test_transcribe_reads_s3_and_returns_whisper_text(monkeypatch):
    s3 = FakeS3()
    use_fakes(monkeypatch, s3)

    response = client.post("/transcribe", json={"s3_key": "audio/RPT-2026-0411/abc.webm"})

    assert response.status_code == 200
    body = response.json()
    assert body["transcript"] == "Sprinkler valve chained open."
    assert s3.requested == "audio/RPT-2026-0411/abc.webm"
    # The file name keeps its extension so Whisper can decode it.
    assert FakeOpenAI.file == ("abc.webm", b"fake audio")
    assert FakeOpenAI.response_format == "verbose_json"
    [usage] = body["usage"]
    assert usage["feature"] == "transcribe"
    assert usage["billed_service"] == "openai-whisper"
    assert usage["model"] == "whisper-1"
    assert usage["audio_seconds"] == 4.2
    assert usage["usage_status"] == "recorded"
    assert usage["input_tokens"] is None
    assert isinstance(usage["duration_ms"], int)


def test_transcribe_marks_usage_unavailable_without_duration(monkeypatch):
    use_fakes(monkeypatch, FakeS3(), duration=None)

    body = client.post("/transcribe", json={"s3_key": "audio/a.webm"}).json()

    [usage] = body["usage"]
    assert usage["audio_seconds"] is None
    assert usage["usage_status"] == "unavailable"


def test_transcribe_reports_why_whisper_failed(monkeypatch):
    use_fakes(monkeypatch, FakeS3())
    FakeOpenAI.error = RuntimeError("Incorrect API key provided")

    response = client.post("/transcribe", json={"s3_key": "audio/a.webm"})

    assert response.status_code == 502
    assert "Incorrect API key provided" in response.json()["detail"]


def test_transcribe_reports_a_missing_recording(monkeypatch):
    use_fakes(monkeypatch, FakeS3(fail=True))

    response = client.post("/transcribe", json={"s3_key": "audio/missing.webm"})

    assert response.status_code == 502
    assert "could not be read from storage" in response.json()["detail"]


def test_ocr_returns_text():
    response = client.post("/ocr", json={"s3_key": "scans/policy.png"})
    assert response.status_code == 200
    assert isinstance(response.json()["text"], str)


def test_transcribe_requires_s3_key():
    assert client.post("/transcribe", json={}).status_code == 422

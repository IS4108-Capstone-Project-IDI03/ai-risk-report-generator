"""Contract tests for S5's handwritten pages (CP-19), against fake S3 and Gemini clients."""

import base64
import io
import json
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.processors import handwriting

client = TestClient(app)


def page(size=(60, 40), orientation=None) -> bytes:
    image = Image.new("RGB", size, "white")
    out = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    image.save(out, "JPEG", exif=exif)
    return out.getvalue()


def answer(*lines) -> str:
    """Gemini's answer: each line a list of words, a word "?x" read uncertainly."""
    return json.dumps(
        {
            "lines": [
                {"words": [{"text": w.lstrip("?"), "uncertain": w.startswith("?")} for w in line]}
                for line in lines
            ]
        }
    )


USAGE = SimpleNamespace(total_input_tokens=1290, total_output_tokens=180, total_thought_tokens=95)


class FakeS3:
    def __init__(self, objects, fail=False):
        self.objects = objects
        self.fail = fail
        self.requested = None

    def get_object(self, Bucket, Key):
        if self.fail:
            raise RuntimeError("NoSuchKey")
        self.requested = Key
        return {"Body": io.BytesIO(self.objects[Key])}


class FakeGemini:
    """Stands in for the google.genai module: genai.Client(...).interactions.create(...)."""

    reply = {}
    request = None
    error = None
    closed = None
    http_options = None

    class Client:
        def __init__(self, api_key=None, http_options=None):
            FakeGemini.http_options = http_options

            def create(**request):
                if FakeGemini.error:
                    raise FakeGemini.error
                FakeGemini.request = request
                return SimpleNamespace(model="gemini-3.8-flash", **FakeGemini.reply)

            self.interactions = SimpleNamespace(create=create)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            FakeGemini.closed = True


def use_fakes(monkeypatch, s3, **reply):
    FakeGemini.error = None
    FakeGemini.request = None
    FakeGemini.closed = None
    FakeGemini.reply = {
        "status": "completed",
        "output_text": answer(["B1", "spk", "CV", "found", "shut,"], ["no", "tamper", "?sw"]),
        "usage": USAGE,
        **reply,
    }
    monkeypatch.setattr(handwriting.boto3, "client", lambda *args, **kwargs: s3)
    monkeypatch.setattr(handwriting, "genai", FakeGemini)


def transcribe(key="pages/RPT-1/o/p.jpg"):
    return client.post("/transcribe-handwriting", json={"s3_key": key})


def test_transcribes_a_page_line_by_line_with_its_uncertain_words(monkeypatch):
    s3 = FakeS3({"pages/RPT-1/o/p.jpg": page()})
    use_fakes(monkeypatch, s3)

    response = transcribe()

    assert response.status_code == 200
    body = response.json()
    assert s3.requested == "pages/RPT-1/o/p.jpg"
    assert body["transcript"] == "B1 spk CV found shut,\nno tamper sw"
    # "sw" was a guess: it sits at characters 32-34 of the transcript.
    assert body["uncertain"] == [[32, 34]]
    assert body["transcript"][32:34] == "sw"
    assert body["provider"] == "gemini"
    assert body["model"] == "gemini-3.8-flash"
    assert body["prompt_version"] == handwriting.PROMPT_VERSION
    [usage] = body["usage"]
    assert usage["feature"] == "transcribe-handwriting"
    assert usage["billed_service"] == "gemini-vision"
    assert usage["model"] == "gemini-3.8-flash"
    assert usage["input_tokens"] == 1290
    # Thinking is billed as output, so it is added in.
    assert usage["output_tokens"] == 275
    assert usage["usage_status"] == "recorded"
    assert isinstance(usage["duration_ms"], int)


def test_asks_for_a_verbatim_reading_and_keeps_nothing(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"pages/RPT-1/o/p.jpg": page()}))

    transcribe()

    request = FakeGemini.request
    assert "word for word" in request["system_instruction"]
    assert "Do not expand, correct, summarise" in request["system_instruction"]
    assert request["generation_config"] == {"temperature": 0}
    assert request["store"] is False
    assert request["response_format"]["schema"]["required"] == ["lines"]
    # The page comes first, then the text that asks about it.
    assert [part["type"] for part in request["input"]] == ["image", "text"]
    assert FakeGemini.closed is True
    # One retry at most, each attempt at most 90 s, so a busy or rate-limited key fails in
    # minutes at worst, inside the gateway's five-minute wait, not after it.
    assert FakeGemini.http_options.timeout == 90_000
    assert FakeGemini.http_options.retry_options.attempts == 1


def test_sends_the_page_upright_and_shrunk(monkeypatch):
    # A portrait phone photo: stored wide, with EXIF saying "turn 90°", and large.
    use_fakes(monkeypatch, FakeS3({"k": page((4000, 3000), orientation=6)}))

    transcribe("k")

    [image] = [p for p in FakeGemini.request["input"] if p["type"] == "image"]
    sent = Image.open(io.BytesIO(base64.b64decode(image["data"])))
    assert sent.size == (1200, 1600)
    assert sent.format == "JPEG"


def test_a_page_without_handwriting_has_an_empty_transcript(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": page()}), output_text=answer())

    body = transcribe("k").json()

    assert body["transcript"] == ""
    assert body["uncertain"] == []


def test_drops_empty_words_and_lines_and_tidies_spacing(monkeypatch):
    reply = answer(["  Pump ", "", "7  bar"], [], ["", " "], ["?ok"])
    use_fakes(monkeypatch, FakeS3({"k": page()}), output_text=reply)

    body = transcribe("k").json()

    assert body["transcript"] == "Pump 7 bar\nok"
    assert body["uncertain"] == [[11, 13]]


def test_counts_positions_as_the_browser_does(monkeypatch):
    # An emoji is two UTF-16 units in JavaScript, one character in Python.
    use_fakes(monkeypatch, FakeS3({"k": page()}), output_text=answer(["📷", "?done"]))

    body = transcribe("k").json()

    assert body["uncertain"] == [[3, 7]]


def test_reports_a_missing_page(monkeypatch):
    use_fakes(monkeypatch, FakeS3({}, fail=True))

    response = transcribe("pages/missing.jpg")

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The page could not be read from storage:")


def test_reports_a_page_that_cannot_be_opened(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": b"not an image"}))

    response = transcribe("k")

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The page could not be opened:")


def test_reports_why_the_model_failed(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": page()}))
    FakeGemini.error = RuntimeError("API key not valid")

    response = transcribe("k")

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail.startswith("The page could not be transcribed:")
    assert "API key not valid" in detail


def test_reports_a_blocked_or_unusable_answer(monkeypatch):
    for reply in (
        {"status": "failed", "output_text": None},
        {"output_text": '{"lines": "B1 spk CV"}'},
    ):
        use_fakes(monkeypatch, FakeS3({"k": page()}), **reply)

        response = transcribe("k")

        assert response.status_code == 502
        assert response.json()["detail"].startswith("The page could not be transcribed:")


def test_marks_usage_unavailable_when_none_is_reported(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": page()}), usage=None)

    [usage] = transcribe("k").json()["usage"]

    assert usage["input_tokens"] is None
    assert usage["output_tokens"] is None
    assert usage["usage_status"] == "unavailable"


def test_refuses_an_unknown_provider(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": page()}))
    monkeypatch.setattr(handwriting, "HANDWRITING_PROVIDER", "tesseract")

    response = transcribe("k")

    assert response.status_code == 502
    assert "HANDWRITING_PROVIDER 'tesseract' is not supported" in response.json()["detail"]


def test_transcribe_handwriting_needs_a_key():
    assert client.post("/transcribe-handwriting", json={}).status_code == 422

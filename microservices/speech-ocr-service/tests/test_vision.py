"""Contract tests for S5's photo interpretation (CP-05), against fake S3 and Gemini clients."""

import base64
import io
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image

from app.main import app
from app.processors import vision

client = TestClient(app)


def photo(size, fmt="JPEG", orientation=None) -> bytes:
    image = Image.new("RGBA" if fmt == "PNG" else "RGB", size, "grey")
    out = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    image.save(out, fmt, exif=exif)
    return out.getvalue()


class FakeS3:
    def __init__(self, objects, fail=False):
        self.objects = objects
        self.fail = fail

    def get_object(self, Bucket, Key):
        if self.fail:
            raise RuntimeError("NoSuchKey")
        return {"Body": io.BytesIO(self.objects[Key])}


ANSWER = (
    '{"description": "During the site visit to the L43 hosereel pump room, it was observed '
    'that the valves were not locked open.", "cope_dimension": "Protection", '
    '"hazard_type": "Fire Protection System Operation"}'
)
USAGE = SimpleNamespace(total_input_tokens=1040, total_output_tokens=62, total_thought_tokens=210)


class FakeGemini:
    """Stands in for the google.genai module: genai.Client(...).interactions.create(...)."""

    reply = {}
    request = None
    error = None
    closed = None

    class Client:
        # Like the real client, `interactions` shares the client's connection but
        # not the client itself, and the connection closes when the client is
        # discarded: `Client(...).interactions.create(...)` fails before sending.
        def __init__(self, api_key=None):
            connection = self.connection = SimpleNamespace(open=True)

            def create(**request):
                if not connection.open:
                    raise RuntimeError("Cannot send a request, as the client has been closed.")
                if FakeGemini.error:
                    raise FakeGemini.error
                FakeGemini.request = request
                return SimpleNamespace(model="gemini-3.8-flash", **FakeGemini.reply)

            self.interactions = SimpleNamespace(create=create)

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.connection.open = False
            FakeGemini.closed = True

        def __del__(self):
            self.connection.open = False


def use_fakes(monkeypatch, s3, **reply):
    FakeGemini.error = None
    FakeGemini.request = None
    FakeGemini.closed = None
    FakeGemini.reply = {"status": "completed", "output_text": ANSWER, "usage": USAGE, **reply}
    monkeypatch.setattr(vision.boto3, "client", lambda *args, **kwargs: s3)
    monkeypatch.setattr(vision, "genai", FakeGemini)


def sent_images():
    parts = [p for p in FakeGemini.request["input"] if p["type"] == "image"]
    return [Image.open(io.BytesIO(base64.b64decode(p["data"]))) for p in parts]


def test_interprets_every_photo_upright_and_shrunk(monkeypatch):
    s3 = FakeS3(
        {
            "photos/RPT-1/o/big.png": photo((4000, 3000), "PNG"),
            # A portrait phone photo: stored wide, with EXIF saying "turn 90°".
            "photos/RPT-1/o/turned.jpg": photo((400, 200), orientation=6),
        }
    )
    use_fakes(monkeypatch, s3)

    response = client.post(
        "/interpret",
        json={
            "s3_keys": ["photos/RPT-1/o/big.png", "photos/RPT-1/o/turned.jpg"],
            "location": "L43 Hosereel pump room · Level 43",
            "note": "Valves on the hosereel line",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "description": (
            "During the site visit to the L43 hosereel pump room, it was observed that the "
            "valves were not locked open."
        ),
        "cope_dimension": "Protection",
        "hazard_type": "Fire Protection System Operation",
        "provider": "gemini",
        "model": "gemini-3.8-flash",
        "prompt_version": vision.PROMPT_VERSION,
        "usage": {"input_tokens": 1040, "output_tokens": 62, "thought_tokens": 210},
    }
    big, turned = sent_images()
    assert big.size == (1600, 1200) and big.format == "JPEG"
    assert turned.size == (200, 400)
    # The photos come first, then what the engineer recorded.
    text = FakeGemini.request["input"][-1]["text"]
    assert "Location: L43 Hosereel pump room · Level 43" in text
    assert "Engineer's note: Valves on the hosereel line" in text
    assert FakeGemini.request["store"] is False
    # The client stayed open for the call and was closed after it.
    assert FakeGemini.closed is True


def test_asks_for_a_fixed_answer_that_allows_no_hazard(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))

    client.post("/interpret", json={"s3_keys": ["k"]})

    schema = FakeGemini.request["response_format"]["schema"]["properties"]
    assert schema["cope_dimension"]["enum"] == [
        "Construction",
        "Occupancy",
        "Protection",
        "Exposure",
    ]
    assert "No hazard visible" in schema["hazard_type"]["enum"]
    assert "Never invent a hazard" in FakeGemini.request["system_instruction"]
    # Without a location or note, the prompt carries neither.
    assert FakeGemini.request["input"][-1]["text"] == "1 photograph of one finding."


def test_reports_a_missing_photo(monkeypatch):
    use_fakes(monkeypatch, FakeS3({}, fail=True))

    response = client.post("/interpret", json={"s3_keys": ["photos/missing.jpg"]})

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The photo could not be read from storage:")


def test_reports_a_photo_that_cannot_be_opened(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": b"not an image"}))

    response = client.post("/interpret", json={"s3_keys": ["k"]})

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The photo could not be opened:")


def test_reports_why_the_model_failed(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))
    FakeGemini.error = RuntimeError("API key not valid")

    response = client.post("/interpret", json={"s3_keys": ["k"]})

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail.startswith("The photos could not be interpreted:")
    assert "API key not valid" in detail


def test_reports_a_blocked_or_unusable_answer(monkeypatch):
    # "Roofing" is not a COPE category, so the answer does not fit the schema.
    unfit = '{"description": "x", "cope_dimension": "Roofing", "hazard_type": "Other"}'
    for reply in ({"status": "failed", "output_text": None}, {"output_text": unfit}):
        use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), **reply)

        response = client.post("/interpret", json={"s3_keys": ["k"]})

        assert response.status_code == 502
        assert response.json()["detail"].startswith("The photos could not be interpreted:")


def test_marks_usage_unavailable_when_none_is_reported(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), usage=None)

    response = client.post("/interpret", json={"s3_keys": ["k"]})

    assert response.status_code == 200
    assert response.json()["usage"] is None


def test_interpret_needs_a_photo():
    assert client.post("/interpret", json={}).status_code == 422
    assert client.post("/interpret", json={"s3_keys": []}).status_code == 422

"""Contract tests for S5's observation reader (CP-05, CP-21), against fake S3 and Gemini clients."""

import base64
import io
import json
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


PROTECTION = {
    "category": "Protection",
    "reason": "Recording 1 says the valves were left shut; Photo 1 shows them.",
    "evidence": [
        {"item": "Recording 1", "quote": "valves were left shut"},
        {"item": "Photo 1", "quote": None},
    ],
}
CONSTRUCTION = {
    "category": "Construction",
    "reason": "The note says the wall penetration is unsealed.",
    "evidence": [{"item": "Note", "quote": "penetration unsealed"}],
}
DESCRIPTION = (
    "During the site visit to the L43 hosereel pump room, it was observed that the valves were "
    "not locked open."
)
ANSWER = json.dumps(
    {
        "categories": [PROTECTION, CONSTRUCTION],
        "description": DESCRIPTION,
        "hazard_type": "Fire Protection System Operation",
    }
)
NOTE = {"label": "Note", "kind": "note", "text": "Pump room, penetration unsealed"}
RECORDING = {"label": "Recording 1", "kind": "recording", "text": "The valves were left shut."}
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


def photos(*keys):
    return [{"label": f"Photo {i}", "s3_key": key} for i, key in enumerate(keys, 1)]


def test_reads_every_photo_upright_and_shrunk_with_the_texts(monkeypatch):
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
            "photos": photos("photos/RPT-1/o/big.png", "photos/RPT-1/o/turned.jpg"),
            "texts": [NOTE, RECORDING],
            "location": "L43 Hosereel pump room · Level 43",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "categories": [PROTECTION, CONSTRUCTION],
        "description": DESCRIPTION,
        "hazard_type": "Fire Protection System Operation",
        "provider": "gemini",
        "model": "gemini-3.8-flash",
        "prompt_version": vision.PROMPT_VERSION,
        "usage": {"input_tokens": 1040, "output_tokens": 62, "thought_tokens": 210},
    }
    big, turned = sent_images()
    assert big.size == (1600, 1200) and big.format == "JPEG"
    assert turned.size == (200, 400)
    # Each photo follows its name, so the answer can cite it.
    sent = FakeGemini.request["input"]
    assert [p.get("text") for p in sent[:4:2]] == ["Photo 1", "Photo 2"]
    # Then what the engineer recorded, each item named and given in full.
    text = sent[-1]["text"]
    assert "captured as: Photo 1, Photo 2, Note, Recording 1." in text
    assert "Location: L43 Hosereel pump room · Level 43" in text
    assert "Note (typed note):\nPump room, penetration unsealed" in text
    assert "Recording 1 (voice recording transcript):\nThe valves were left shut." in text
    assert FakeGemini.request["store"] is False
    # The client stayed open for the call and was closed after it.
    assert FakeGemini.closed is True


def test_with_photos_asks_for_categories_a_description_and_a_hazard(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))

    client.post("/interpret", json={"photos": photos("k")})

    schema = FakeGemini.request["response_format"]["schema"]
    category = schema["$defs"]["ProposedCategory"]["properties"]["category"]
    assert category["enum"] == ["Construction", "Occupancy", "Protection", "Exposure"]
    assert "No hazard visible" in schema["properties"]["hazard_type"]["enum"]
    instruction = FakeGemini.request["system_instruction"]
    assert "Never invent a hazard" in instruction
    # Each category cites every item behind it, so none is silently passed over.
    assert "every item that supports it" in instruction
    # Text guides where to look, but a description states only what the photos show.
    assert "describe what the photographs show, not what the text claims" in instruction
    # Without a location or text, the prompt names only the photo.
    assert FakeGemini.request["input"][-1]["text"] == "One finding, captured as: Photo 1."


def test_reads_text_alone_for_categories_only(monkeypatch):
    # No photos, so nothing is read from S3 and nothing is described.
    use_fakes(
        monkeypatch,
        FakeS3({}, fail=True),
        output_text=json.dumps({"categories": [CONSTRUCTION]}),
    )

    response = client.post(
        "/interpret",
        json={"texts": [NOTE, {"label": "Page 1", "kind": "page", "text": "Roof leaking"}]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["categories"] == [CONSTRUCTION]
    assert body["description"] is None and body["hazard_type"] is None
    sent = FakeGemini.request
    assert [p["type"] for p in sent["input"]] == ["text"]
    assert "Page 1 (handwritten page transcript):\nRoof leaking" in sent["input"][0]["text"]
    assert "description" not in sent["response_format"]["schema"]["properties"]
    assert "photographs" not in sent["system_instruction"]


def test_regenerates_the_categories_alone_from_every_item(monkeypatch):
    # Photos are still evidence for the categories, but nothing is described.
    use_fakes(
        monkeypatch,
        FakeS3({"k": photo((50, 50))}),
        output_text=json.dumps({"categories": [PROTECTION]}),
    )

    response = client.post(
        "/interpret", json={"photos": photos("k"), "texts": [NOTE], "parts": ["categories"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["categories"] == [PROTECTION]
    assert body["description"] is None and body["hazard_type"] is None
    sent = FakeGemini.request
    assert len(sent_images()) == 1
    assert set(sent["response_format"]["schema"]["properties"]) == {"categories"}
    assert "hazard_type" not in sent["system_instruction"]


def test_regenerates_the_description_alone_from_the_photos(monkeypatch):
    use_fakes(
        monkeypatch,
        FakeS3({"k": photo((50, 50))}),
        output_text=json.dumps({"description": DESCRIPTION, "hazard_type": "Other"}),
    )

    response = client.post(
        "/interpret", json={"photos": photos("k"), "texts": [NOTE], "parts": ["description"]}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["categories"] is None
    assert (body["description"], body["hazard_type"]) == (DESCRIPTION, "Other")
    sent = FakeGemini.request
    assert set(sent["response_format"]["schema"]["properties"]) == {"description", "hazard_type"}
    instruction = sent["system_instruction"]
    assert "COPE" not in instruction
    assert "describe what the photographs show, not what the text claims" in instruction


def test_keeps_each_category_once_and_at_most_four(monkeypatch):
    def proposed(category):
        return {**CONSTRUCTION, "category": category}

    answer = [
        proposed(c)
        for c in ("Exposure", "Exposure", "Construction", "Occupancy", "Protection", "Occupancy")
    ]
    use_fakes(monkeypatch, FakeS3({}), output_text=json.dumps({"categories": answer}))

    response = client.post("/interpret", json={"texts": [NOTE]})

    assert [c["category"] for c in response.json()["categories"]] == [
        "Exposure",
        "Construction",
        "Occupancy",
        "Protection",
    ]


def test_may_propose_no_category(monkeypatch):
    use_fakes(monkeypatch, FakeS3({}), output_text='{"categories": []}')

    response = client.post("/interpret", json={"texts": [NOTE]})

    assert response.status_code == 200
    assert response.json()["categories"] == []


def test_reports_a_missing_photo(monkeypatch):
    use_fakes(monkeypatch, FakeS3({}, fail=True))

    response = client.post("/interpret", json={"photos": photos("photos/missing.jpg")})

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The photo could not be read from storage:")


def test_reports_a_photo_that_cannot_be_opened(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": b"not an image"}))

    response = client.post("/interpret", json={"photos": photos("k")})

    assert response.status_code == 502
    assert response.json()["detail"].startswith("The photo could not be opened:")


def test_reports_why_the_model_failed(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))
    FakeGemini.error = RuntimeError("API key not valid")

    response = client.post("/interpret", json={"photos": photos("k")})

    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail.startswith("The observation could not be read:")
    assert "API key not valid" in detail


def test_reports_a_blocked_or_unusable_answer(monkeypatch):
    # "Roofing" is not a COPE category, so the answer does not fit the schema.
    unfit = json.dumps({"categories": [{**CONSTRUCTION, "category": "Roofing"}]})
    for reply in ({"status": "failed", "output_text": None}, {"output_text": unfit}):
        use_fakes(monkeypatch, FakeS3({}), **reply)

        response = client.post("/interpret", json={"texts": [NOTE]})

        assert response.status_code == 502
        assert response.json()["detail"].startswith("The observation could not be read:")


def test_a_photo_reading_needs_a_description(monkeypatch):
    use_fakes(
        monkeypatch,
        FakeS3({"k": photo((50, 50))}),
        output_text=json.dumps({"categories": [CONSTRUCTION]}),
    )

    response = client.post("/interpret", json={"photos": photos("k")})

    assert response.status_code == 502


def test_marks_usage_unavailable_when_none_is_reported(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), usage=None)

    response = client.post("/interpret", json={"photos": photos("k")})

    assert response.status_code == 200
    assert response.json()["usage"] is None


def test_interpret_needs_something_to_read():
    assert client.post("/interpret", json={}).status_code == 422
    assert client.post("/interpret", json={"photos": [], "texts": []}).status_code == 422
    # An empty text, an unknown kind or a repeated label is refused too.
    for texts in (
        [{**NOTE, "text": ""}],
        [{**NOTE, "kind": "email"}],
        [NOTE, {**RECORDING, "label": "Note"}],
    ):
        assert client.post("/interpret", json={"texts": texts}).status_code == 422
    # Nothing to describe without photos, and an unknown or empty list of parts.
    for parts in (["description"], ["summary"], []):
        assert client.post("/interpret", json={"texts": [NOTE], "parts": parts}).status_code == 422

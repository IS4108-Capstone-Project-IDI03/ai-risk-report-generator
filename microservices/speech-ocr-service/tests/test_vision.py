"""Contract tests for S5's photo reader (CP-05, CP-21, CP-24), against fake S3 and Gemini."""

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


DESCRIPTION = (
    "During the site visit to the L43 hosereel pump room, it was observed that the valves were "
    "not locked open."
)
ANSWER = json.dumps(
    {
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
        "description": DESCRIPTION,
        "hazard_type": "Fire Protection System Operation",
        "provider": "gemini",
        "model": "gemini-3.8-flash",
        "prompt_version": vision.PROMPT_VERSION,
        "usage": {"input_tokens": 1040, "output_tokens": 62, "thought_tokens": 210},
        # Sent without `privacy`, so nothing was masked or blurred (PV-04).
        "privacy": {
            "enabled": False,
            "masked_count": 0,
            "faces_blurred": 0,
            "removed_from_answer": 0,
        },
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


def test_asks_for_a_description_and_a_hazard_only(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))

    client.post("/interpret", json={"photos": photos("k")})

    schema = FakeGemini.request["response_format"]["schema"]
    assert set(schema["properties"]) == {"description", "hazard_type"}
    assert "No hazard visible" in schema["properties"]["hazard_type"]["enum"]
    instruction = FakeGemini.request["system_instruction"]
    assert "COPE" not in instruction and "categories" not in instruction
    assert "Never invent a hazard" in instruction
    # Text guides where to look, but a description states only what the photos show.
    assert "describe what the photographs show, not what the text claims" in instruction
    # Without a location or text, the prompt names only the photo.
    assert FakeGemini.request["input"][-1]["text"] == "One finding, captured as: Photo 1."


def test_ignores_parts_from_an_older_gateway(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))

    for parts in (["categories"], ["categories", "description"], ["summary"], []):
        response = client.post(
            "/interpret", json={"photos": photos("k"), "texts": [NOTE], "parts": parts}
        )

        assert response.status_code == 200, response.text
        assert "categories" not in response.json()
        schema = FakeGemini.request["response_format"]["schema"]
        assert set(schema["properties"]) == {"description", "hazard_type"}


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
    # "Roofing" is not a hazard type, so the answer does not fit the schema.
    unfit = json.dumps({"description": DESCRIPTION, "hazard_type": "Roofing"})
    for reply in ({"status": "failed", "output_text": None}, {"output_text": unfit}):
        use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), **reply)

        response = client.post("/interpret", json={"photos": photos("k")})

        assert response.status_code == 502
        assert response.json()["detail"].startswith("The observation could not be read:")


def test_an_answer_without_a_description_is_refused(monkeypatch):
    use_fakes(
        monkeypatch,
        FakeS3({"k": photo((50, 50))}),
        output_text=json.dumps({"hazard_type": "Other"}),
    )

    response = client.post("/interpret", json={"photos": photos("k")})

    assert response.status_code == 502


def test_marks_usage_unavailable_when_none_is_reported(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}), usage=None)

    response = client.post("/interpret", json={"photos": photos("k")})

    assert response.status_code == 200
    assert response.json()["usage"] is None


def test_interpret_needs_photos_to_describe(monkeypatch):
    use_fakes(monkeypatch, FakeS3({}, fail=True))
    # Without a photo there is nothing to describe, whatever text comes with it.
    assert client.post("/interpret", json={}).status_code == 422
    assert client.post("/interpret", json={"photos": [], "texts": []}).status_code == 422
    assert client.post("/interpret", json={"texts": [NOTE]}).status_code == 422
    assert FakeGemini.request is None
    # An empty text, an unknown kind or a repeated label is refused too.
    for texts in (
        [{**NOTE, "text": ""}],
        [{**NOTE, "kind": "email"}],
        [NOTE, {**RECORDING, "label": "Note"}],
    ):
        assert (
            client.post("/interpret", json={"photos": photos("k"), "texts": texts}).status_code
            == 422
        )


# CP-10: the engineer can mark the area of a photo that matters, as fractions of the upright photo.
def half_red(size) -> bytes:
    """A grey photo whose right half is red."""
    image = Image.new("RGB", size, "grey")
    image.paste("red", (size[0] // 2, 0, size[0], size[1]))
    out = io.BytesIO()
    image.save(out, "JPEG")
    return out.getvalue()


def test_sends_a_close_up_of_the_marked_area_after_its_photo(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"a": photo((400, 300)), "b": half_red((400, 200))}))
    marked = photos("a", "b")
    marked[1]["region"] = {"x": 0.5, "y": 0.25, "w": 0.5, "h": 0.5}

    response = client.post("/interpret", json={"photos": marked, "texts": [NOTE]})

    assert response.status_code == 200, response.text
    sent = FakeGemini.request["input"]
    labels = [p["text"] for p in sent[:-1] if p["type"] == "text"]
    assert labels == ["Photo 1", "Photo 2", "Photo 2, marked area"]
    first, second, close_up = sent_images()
    assert (first.size, second.size, close_up.size) == ((400, 300), (400, 200), (200, 100))
    # The close-up is the marked area: the red half.
    red, green, blue = close_up.convert("RGB").getpixel((100, 50))
    assert red > 200 and green < 60 and blue < 60
    # The close-up is part of Photo 2, not an item the answer can cite.
    assert "captured as: Photo 1, Photo 2, Note." in sent[-1]["text"]


def test_cuts_the_close_up_from_the_upright_photo_at_full_detail(monkeypatch):
    s3 = FakeS3(
        {
            # Stored wide with EXIF saying "turn 90°": upright it is 200 x 400.
            "turned": photo((400, 200), orientation=6),
            "big": photo((4000, 3000)),
        }
    )
    use_fakes(monkeypatch, s3)
    marked = photos("turned", "big")
    marked[0]["region"] = {"x": 0, "y": 0.5, "w": 1, "h": 0.5}
    # A quarter of the big photo: cut before shrinking, so 1000 x 750, not 400 x 300.
    marked[1]["region"] = {"x": 0.5, "y": 0.5, "w": 0.25, "h": 0.25}

    client.post("/interpret", json={"photos": marked})

    sizes = [image.size for image in sent_images()]
    assert sizes == [(200, 400), (200, 200), (1600, 1200), (1000, 750)]


def test_tells_the_model_about_a_marked_area_only_when_one_is_marked(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))
    client.post("/interpret", json={"photos": photos("k")})
    assert "marked area" not in FakeGemini.request["system_instruction"]

    marked = photos("k")
    marked[0]["region"] = {"x": 0, "y": 0, "w": 0.5, "h": 0.5}
    client.post("/interpret", json={"photos": marked})
    instruction = FakeGemini.request["system_instruction"]
    assert "'<photo name>, marked area' is a close-up" in instruction
    assert "Describe the condition in the marked area" in instruction
    assert "COPE" not in instruction
    assert vision.PROMPT_VERSION == "cp10-v1"


def test_refuses_a_mark_that_is_not_an_area_inside_the_photo(monkeypatch):
    use_fakes(monkeypatch, FakeS3({"k": photo((50, 50))}))
    for region in (
        {"x": -0.1, "y": 0, "w": 0.5, "h": 0.5},
        {"x": 0.6, "y": 0, "w": 0.5, "h": 0.5},
        {"x": 0, "y": 0, "w": 0, "h": 0.5},
        {"x": 0, "y": 0, "w": 0.5},
    ):
        marked = photos("k")
        marked[0]["region"] = region
        assert client.post("/interpret", json={"photos": marked}).status_code == 422, region
    assert FakeGemini.request is None

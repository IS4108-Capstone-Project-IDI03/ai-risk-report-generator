"""CP-27: the model's pass over a tidied transcript, through S5's transcription routes.

The model may only delete words (a self-correction's abandoned half, a leftover filler). Whisper
and the tidy model are faked at their boundaries; privacy-service is FakePrivacy (conftest.py).
"""

import base64

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.processors import tidy
from tests.test_routes import FakeOpenAI, FakeS3, use_fakes

client = TestClient(app)

PRIVACY_OFF = {"enabled": False}


class FakeModel:
    """The tidy provider: answers with `answer`, or raises `error`. `.sent` holds what it got."""

    def __init__(self, answer: str = "", error: Exception | None = None):
        self.answer = answer
        self.error = error
        self.sent: list[str] = []

    def __call__(self, text: str) -> tuple[str, dict]:
        self.sent.append(text)
        if self.error:
            raise self.error
        return self.answer, {"feature": "tidy-transcript", "input_tokens": 10}


@pytest.fixture
def model(monkeypatch):
    fake = FakeModel()
    monkeypatch.setitem(tidy._PROVIDERS, tidy.TIDY_PROVIDER, fake)
    return fake


def clip(spoken: str, monkeypatch, privacy: dict | None = PRIVACY_OFF) -> dict:
    use_fakes(monkeypatch, FakeS3())
    FakeOpenAI.text = spoken
    body = {"audio_base64": base64.b64encode(b"x").decode(), "filename": "q.webm"}
    if privacy is not None:
        body["privacy"] = privacy
    response = client.post("/transcribe-clip", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_the_model_takes_out_the_abandoned_half_of_a_self_correction(monkeypatch, model):
    model.answer = "the pump is on level 4"

    body = clip("the pump is on level 3, sorry, level 4", monkeypatch)

    assert body["transcript"] == "the pump is on level 4"
    assert body["spoken"] == "the pump is on level 3, sorry, level 4"


def test_without_privacy_from_the_gateway_the_model_is_never_called(monkeypatch, model):
    # A caller that does not say how to protect the text gets the rules' tidy text only.
    body = clip("um the pump is on level 3, sorry, level 4", monkeypatch, privacy=None)

    assert model.sent == []
    assert body["transcript"] == "the pump is on level 3, sorry, level 4"
    assert [u["feature"] for u in body["usage"]] == ["transcribe"]


PRIVACY_ON = {"enabled": True, "known_entities": [{"type": "SITE", "names": ["Jurong Plant"]}]}


def test_with_protection_on_the_model_sees_placeholders_and_the_answer_comes_back_real(
    monkeypatch, model, fake_privacy
):
    model.answer = "the pump at [SITE_1] is on level 4"

    body = clip("the pump at Jurong Plant is on level 3, sorry, level 4", monkeypatch, PRIVACY_ON)

    assert model.sent == ["the pump at [SITE_1] is on level 3, sorry, level 4"]
    assert body["transcript"] == "the pump at Jurong Plant is on level 4"
    assert fake_privacy.paths() == ["/mask"]


def test_when_masking_fails_nothing_is_sent_and_the_rules_tidy_text_stands(
    monkeypatch, model, fake_privacy
):
    # Fails closed: unprotected text never goes to the model, and the transcript is not lost.
    fake_privacy.failure = 503

    body = clip("um the pump is on level 3, sorry, level 4", monkeypatch, PRIVACY_ON)

    assert model.sent == []
    assert body["transcript"] == "the pump is on level 3, sorry, level 4"


def test_an_answer_with_a_word_the_speaker_never_said_is_not_used(monkeypatch, model):
    model.answer = "the pump is located on level 4"

    body = clip("the pump is on level 3, sorry, level 4", monkeypatch)

    assert body["transcript"] == "the pump is on level 3, sorry, level 4"


def test_an_answer_that_moves_words_is_not_used(monkeypatch, model):
    model.answer = "on level 4 the pump is"

    body = clip("the pump is on level 3, sorry, level 4", monkeypatch)

    assert body["transcript"] == "the pump is on level 3, sorry, level 4"


def test_an_answer_that_deletes_too_much_is_not_used(monkeypatch, model):
    # Deleting is allowed; deleting most of what was said is summarising.
    spoken = (
        "the diesel pump was serviced last month but the jockey pump keeps cycling every few "
        "minutes and the controller panel shows an alarm"
    )
    model.answer = "the jockey pump keeps cycling"

    body = clip(spoken, monkeypatch)

    assert body["transcript"] == spoken


def test_an_answer_that_drops_a_number_the_speaker_did_not_take_back_is_not_used(
    monkeypatch, model
):
    # A number is a fact; it may go only with a correction ("sorry", "I mean", "no"...).
    model.answer = "the pump is on level 4"

    body = clip("the pump is on level 3 or level 4", monkeypatch)

    assert body["transcript"] == "the pump is on level 3 or level 4"


def test_when_the_model_fails_the_rules_tidy_text_stands(monkeypatch, model):
    model.error = RuntimeError("quota exceeded")

    response_body = clip("um the pump is on level 3, sorry, level 4", monkeypatch)

    assert response_body["transcript"] == "the pump is on level 3, sorry, level 4"


def test_the_model_call_is_reported_for_costing(monkeypatch, model):
    model.answer = "the pump is on level 4"

    body = clip("the pump is on level 3, sorry, level 4", monkeypatch)

    assert [u["feature"] for u in body["usage"]] == ["transcribe", "tidy-transcript"]

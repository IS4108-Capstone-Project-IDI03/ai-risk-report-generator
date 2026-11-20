"""CP-24: POST /observations/rate. Jev's HTTP call is faked; privacy-service's /mask is
faked in-process (conftest `fake_privacy`). No network."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.site_walk import jev

client = TestClient(app)
PRIVACY = {"enabled": True, "known_entities": [{"type": "CLIENT", "names": ["Acme Holdings"]}]}


class FakeJev:
    """Stands in for Jev's /v1/systemone. `picks` maps a question-name prefix to
    (choice, probability); unset ones pick a fixed default at 0.9."""

    DEFAULTS = {"positive": "gap", "consequence": "major", "likelihood": "possible",
                "category": "protection"}  # fmt: skip

    def __init__(self):
        self.bodies: list[dict] = []
        self.picks: dict[str, tuple[str, float]] = {}

    def __call__(self, url, headers, body):
        self.bodies.append(body)
        answers = {}
        for name in body["questions"]:
            kind = name.split("_")[0]
            choice, p = self.picks.get(kind, (self.DEFAULTS[kind], 0.9))
            answers[name] = {"choice": choice, "confidence": p, "probabilities": {choice: p}}
        return {"answers": answers, "usage": {"input_tokens": 1000, "output_tokens": 0}}


@pytest.fixture
def fake_jev(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    fake = FakeJev()
    monkeypatch.setattr(jev, "_post", fake)
    return fake


def rate(**body):
    return client.post("/observations/rate", json={"text": "Fire pump on manual.", **body})


def test_one_observation_gets_one_category_one_severity_and_two_flags(fake_jev):
    response = rate()

    assert response.status_code == 200
    body = response.json()
    # Major x Possible is Priority 1: critical (Marsh's matrix, as in the site walk).
    assert body["category"] == "Protection"
    assert body["severity"] == "critical"
    assert body["check"] == {"category": False, "severity": False}
    # Only the observation's text goes to the classifier, in one call, no probabilities back.
    [call] = fake_jev.bodies
    assert "Fire pump on manual." in call["state"]
    assert set(body) == {"category", "severity", "check", "usage"}
    assert len(body["usage"]) == 1 and body["usage"][0]["billed_service"] == "typesafe-jev"


def test_a_value_under_the_cutoff_is_marked_not_sure_and_still_filled_in(fake_jev):
    fake_jev.picks["category"] = ("exposure", 0.69)
    fake_jev.picks["consequence"] = ("minor", 0.9)
    fake_jev.picks["likelihood"] = ("likely", 0.5)
    body = rate().json()

    assert body["category"] == "Exposure"
    assert body["severity"] == "high"  # Minor x Likely, still filled in
    assert body["check"] == {"category": True, "severity": True}


def test_a_value_at_the_cutoff_is_sure(fake_jev):
    fake_jev.picks["category"] = ("occupancy", 0.70)

    assert rate().json()["check"]["category"] is False


def test_a_positive_remark_is_low(fake_jev):
    fake_jev.picks["positive"] = ("positive", 0.95)
    body = rate(text="Valves all locked open, good.").json()

    assert body["severity"] == "low"


def test_client_text_reaches_jev_only_masked(fake_jev, fake_privacy):
    response = rate(text="Acme Holdings pump room door wedged.", privacy=PRIVACY)

    assert response.status_code == 200
    [call] = fake_jev.bodies
    assert "[CLIENT_1] pump room door wedged." in call["state"]
    assert "Acme Holdings" not in str(call)


def test_masking_fails_closed_and_nothing_is_sent(fake_jev, fake_privacy):
    fake_privacy.failure = 503
    response = rate(privacy=PRIVACY)

    assert response.status_code == 502
    assert "nothing was sent" in response.json()["detail"]
    assert fake_jev.bodies == []


def test_a_jev_failure_answers_502(monkeypatch, fake_jev):
    def down(url, headers, body):
        raise httpx.ConnectError("down")

    monkeypatch.setattr(jev, "_post", down)
    response = rate()

    assert response.status_code == 502
    assert "could not be reached" in response.json()["detail"]


def test_empty_text_is_refused(fake_jev):
    assert rate(text="").status_code == 422
    assert fake_jev.bodies == []

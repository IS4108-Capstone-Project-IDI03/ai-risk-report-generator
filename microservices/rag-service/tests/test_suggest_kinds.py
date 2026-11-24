"""CP-36: /suggest-kinds with the model mocked (privacy served by conftest's fake_privacy)."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.privacy import PrivacyUnavailable
from app.site_walk.kind_suggest import KindResult, suggest_kinds

client = TestClient(app)
PRIVACY = {"enabled": True, "known_entities": [{"type": "PERSON", "names": ["John Tan"]}]}


def mock(monkeypatch, kinds):
    prompts = []

    def complete(system, user, schema, effort, feature=None, model=None):
        prompts.append(user)
        return KindResult(kinds=kinds), "m"

    monkeypatch.setattr("app.site_walk.kind_suggest.complete", complete)
    return prompts


def post(text, privacy=None):
    return client.post("/suggest-kinds", json={"text": text, "privacy": privacy})


def test_fact_and_advice_come_back_in_fixed_order(monkeypatch):
    mock(monkeypatch, ["recommendation", "fact"])
    body = post("fire pump is 20 years old, replace it").json()
    assert body["kinds"] == ["fact", "recommendation"]
    assert body["provenance"]["prompt_version"] == "cp36-v1"
    assert "usage" in body


def test_empty_answer_is_fact(monkeypatch):
    mock(monkeypatch, [])
    assert suggest_kinds("pump room")["kinds"] == ["fact"]


def test_duplicates_removed(monkeypatch):
    mock(monkeypatch, ["info_request", "info_request", "fact"])
    assert suggest_kinds("x")["kinds"] == ["fact", "info_request"]


def test_text_is_masked_before_the_model(monkeypatch, fake_privacy):
    prompts = mock(monkeypatch, ["fact"])
    assert post("John Tan says ok", privacy=PRIVACY).status_code == 200
    assert fake_privacy.requests
    assert "John Tan" not in prompts[0]


def test_privacy_down_is_a_503_and_the_model_is_not_called(monkeypatch, fake_privacy):
    fake_privacy.failure = 503
    prompts = mock(monkeypatch, ["fact"])
    assert post("John Tan says ok", privacy=PRIVACY).status_code == 503
    assert prompts == []
    with pytest.raises(PrivacyUnavailable):
        suggest_kinds("John Tan says ok", PRIVACY)


def test_prefix_is_passed_through_unchanged(monkeypatch):
    prompts = mock(monkeypatch, ["info_request"])
    assert post("IR: hydrant test report").json()["kinds"] == ["info_request"]
    assert "IR: hydrant test report" in prompts[0]

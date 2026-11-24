"""F-12: GET /health/providers, the walkthrough quick check. Every provider is faked."""

from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config
from app.api import routes
from app.generation import llm
from app.main import app

client = TestClient(app)


def get(need: str, headers: dict | None = None) -> dict:
    response = client.get("/health/providers", params={"need": need}, headers=headers or {})
    assert response.status_code == 200
    return response.json()


def test_llm_makes_one_tiny_request_on_the_drafting_provider_and_the_admins_model(monkeypatch):
    seen = []

    def fake_provider(system, user, schema, effort, feature, model):
        seen.append((user, effort, feature, model))
        llm.usage_log.record(feature, "anthropic", model, 0.0, input_tokens=9, output_tokens=2)
        return schema(ok=True), model

    monkeypatch.setitem(llm._PROVIDERS, config.LLM_PROVIDER, fake_provider)
    body = get("llm", {"X-Model": "claude-sonnet-5-5"})
    assert body["ok"] is True
    assert seen == [("ok?", "low", "walkthrough", "claude-sonnet-5-5")]
    assert body["usage"][0]["feature"] == "walkthrough"
    assert body["usage"][0]["input_tokens"] == 9


def test_llm_failure_is_ok_false_and_keeps_the_billed_usage(monkeypatch):
    def refusing(system, user, schema, effort, feature, model):
        llm.usage_log.record(feature, "anthropic", model, 0.0, input_tokens=9, output_tokens=0)
        raise llm.GenerationFailed("The model declined to draft this section.")

    monkeypatch.setitem(llm._PROVIDERS, config.LLM_PROVIDER, refusing)
    body = get("llm")
    assert body["ok"] is False
    assert len(body["usage"]) == 1


def test_chat_uses_the_chat_provider_and_model(monkeypatch):
    seen = []

    def fake_json(system, user, schema, *, provider, model, effort, feature):
        seen.append((provider, model, effort, feature))
        return schema(ok=True)

    monkeypatch.setattr(llm, "complete_json", fake_json)
    assert get("chat")["ok"] is True
    assert seen == [(config.CHAT_PROVIDER, config.CHAT_MODEL, config.CHAT_EFFORT, "walkthrough")]


def test_search_embeds_one_fixed_word_and_never_reranks(monkeypatch):
    cohere = Mock()
    cohere.embed.return_value = SimpleNamespace(
        meta=SimpleNamespace(billed_units=SimpleNamespace(input_tokens=1))
    )
    chroma = Mock()
    monkeypatch.setattr(routes, "cohere_client", lambda: cohere)
    monkeypatch.setattr(routes, "chroma_client", lambda: chroma)
    body = get("search")
    assert body["ok"] is True
    assert cohere.embed.call_args.kwargs["texts"] == ["ping"]
    cohere.rerank.assert_not_called()
    chroma.heartbeat.assert_called_once()
    assert body["usage"][0]["billed_service"] == "cohere-embed"


def test_search_fails_when_chroma_is_down(monkeypatch):
    chroma = Mock()
    chroma.heartbeat.side_effect = ConnectionError("down")
    monkeypatch.setattr(routes, "chroma_client", lambda: chroma)
    assert get("search")["ok"] is False


@pytest.mark.parametrize("status,ok", [(200, True), (503, False)])
def test_privacy_asks_the_privacy_service_health(monkeypatch, status, ok):
    asked = []

    def fake_get(url, timeout):
        asked.append(url)
        return httpx.Response(status, request=httpx.Request("GET", url))

    monkeypatch.setattr(routes.httpx, "get", fake_get)
    assert get("privacy")["ok"] is ok
    assert asked == [f"{config.PRIVACY_SERVICE_URL}/health"]


def test_an_unknown_need_is_422():
    assert client.get("/health/providers", params={"need": "x"}).status_code == 422

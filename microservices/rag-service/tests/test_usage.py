"""AI-call usage on the draft response (EV-03). Anthropic and Cohere are mocked."""

from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient

from app import usage
from app.generation import llm
from app.generation.generator import SectionDraft
from app.main import app
from app.retrieval import retriever
from tests.test_sections import REQUEST, STANDARD

client = TestClient(app)


def anthropic_response(usage_obj):
    return SimpleNamespace(
        model="claude-test",
        usage=usage_obj,
        stop_reason="end_turn",
        parsed_output=SectionDraft(subsections=[], questions=[]),
    )


def cohere_with(billed):
    cohere = Mock()
    meta = SimpleNamespace(billed_units=billed) if billed is not None else None
    cohere.embed.return_value = SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * 5), meta=meta
    )
    cohere.rerank.return_value = SimpleNamespace(
        results=[SimpleNamespace(index=0, relevance_score=0.9)], meta=meta
    )
    return cohere


def mock_everything(monkeypatch, anthropic_usage, billed):
    chroma = Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 1
    collection.query.return_value = {
        "ids": [["fm:4"]],
        "documents": [[STANDARD["text"]]],
        "metadatas": [[STANDARD["metadata"]]],
        "distances": [[0.1]],
    }
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere_with(billed))
    client_mock = Mock()
    client_mock.beta.messages.parse.return_value = anthropic_response(anthropic_usage)
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client_mock)
    monkeypatch.setattr("app.config.LLM_PROVIDER", "anthropic")


def test_draft_returns_one_usage_item_per_paid_call(monkeypatch):
    mock_everything(
        monkeypatch,
        SimpleNamespace(input_tokens=100, output_tokens=50, cache_read_input_tokens=7),
        SimpleNamespace(input_tokens=12, search_units=1),
    )
    body = client.post("/sections/draft", json=REQUEST).json()

    by_service = {u["billed_service"]: u for u in body["usage"]}
    assert len(body["usage"]) == 3
    assert set(by_service) == {"anthropic", "cohere-embed", "cohere-rerank"}
    assert by_service["anthropic"] | {"duration_ms": 0} == {
        "feature": "draft-section",
        "billed_service": "anthropic",
        "model": "claude-test",
        "duration_ms": 0,
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_read_tokens": 7,
        "search_units": None,
        "audio_seconds": None,
        "usage_status": "recorded",
    }
    assert by_service["cohere-embed"]["input_tokens"] == 12
    assert by_service["cohere-rerank"]["search_units"] == 1
    assert {by_service[s]["feature"] for s in ("cohere-embed", "cohere-rerank")} == {"retrieval"}
    assert all(isinstance(u["duration_ms"], int) for u in body["usage"])


def test_missing_provider_usage_is_unavailable_not_zero(monkeypatch):
    mock_everything(monkeypatch, None, None)
    body = client.post("/sections/draft", json=REQUEST).json()

    assert len(body["usage"]) == 3
    for item in body["usage"]:
        assert item["usage_status"] == "unavailable"
        assert item["input_tokens"] is None
        assert item["search_units"] is None


def test_nothing_is_collected_outside_a_draft():
    # /retrieve and the eval harness never call usage.start(), so record() is a no-op.
    usage.record("retrieval", "cohere-embed", "m", 0.0, input_tokens=1)

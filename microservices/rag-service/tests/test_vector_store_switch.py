"""QD-01: VECTOR_STORE picks Chroma or Qdrant, and search on Qdrant never returns withdrawn text."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app import retrieval_config as config
from app.qdrant_collection import QdrantCollection
from app.retrieval import retriever


@pytest.fixture(autouse=True)
def fresh_client():
    config.qdrant_client.cache_clear()
    yield
    config.qdrant_client.cache_clear()


def test_chroma_is_the_default_store(monkeypatch):
    monkeypatch.delenv("VECTOR_STORE", raising=False)
    assert config.vector_store() == "chroma"


@pytest.mark.parametrize("name", ["qdrant", "QDRANT", " Qdrant "])
def test_qdrant_is_chosen_case_insensitively(monkeypatch, name):
    monkeypatch.setenv("VECTOR_STORE", name)
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    assert isinstance(config.vector_collection(), QdrantCollection)


def test_an_unknown_store_fails_closed(monkeypatch):
    monkeypatch.setenv("VECTOR_STORE", "pinecone")
    with pytest.raises(RuntimeError, match="VECTOR_STORE must be chroma or qdrant"):
        config.vector_collection()


def test_qdrant_needs_a_url(monkeypatch):
    monkeypatch.setenv("VECTOR_STORE", "qdrant")
    monkeypatch.delenv("QDRANT_URL", raising=False)
    with pytest.raises(RuntimeError, match="QDRANT_URL"):
        config.vector_collection()


def test_search_on_qdrant_returns_the_approved_passage_never_a_withdrawn_one(monkeypatch):
    monkeypatch.setenv("VECTOR_STORE", "qdrant")
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    near = [1.0] + [0.0] * 1023
    labels = {"source_type": "fm_standard", "jurisdiction": "SG", "facility_type": "warehouse"}
    config.vector_collection().upsert(
        ids=["ok:1", "old:1"],
        # The withdrawn passage is the closer match, so only the filter can hide it.
        embeddings=[[0.9, 0.1] + [0.0] * 1022, near],
        documents=["Sprinkler spacing", "Superseded sprinkler spacing"],
        metadatas=[
            {"doc_id": "ok", "status": "approved", "effective_date": "2024-01-01", **labels},
            {"doc_id": "old", "status": "withdrawn", "effective_date": "2010-01-01", **labels},
        ],
    )
    cohere = Mock()
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[near]))
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    [found] = retriever.search([("sprinkler spacing", {"source_type": "fm_standard"}, 5)])
    assert [p["id"] for p in found] == ["ok:1"]
    assert found[0]["metadata"]["status"] == "approved"

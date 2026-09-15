"""Indexing contract without external API calls."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.pipeline import embedder, indexer
from app.retrieval_config import cohere_client

client = TestClient(app)


@pytest.mark.parametrize("mode,index_type", [("local", "hnsw"), ("cloud", "spann")])
def test_index_preserves_ids_and_metadata_and_rejects_invalid_input(monkeypatch, mode, index_type):
    monkeypatch.setenv("CHROMA_MODE", mode)
    cohere, chroma = Mock(), Mock()
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.1]]))
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(indexer, "chroma_client", lambda: chroma)
    chunk = {
        "id": "synthetic:1",
        "text": "Flood barriers protect the warehouse.",
        "metadata": {
            "document_id": "synthetic",
            "source_type": "survey",
            "jurisdiction": "SG",
            "facility_type": "warehouse",
            "COPE_dimension": "Protection",
            "effective_date": "2026-09-13",
            "page": 1,
        },
    }
    for _ in range(2):
        response = client.post("/index", json={"chunks": [chunk]})
        assert response.status_code == 200
        assert response.json()["chunks_indexed"] == 1
    assert cohere.embed.call_args.kwargs["input_type"] == "search_document"
    assert cohere.embed.call_args.kwargs["truncate"] == "NONE"
    assert chroma.get_or_create_collection.call_args.kwargs["configuration"] == {
        index_type: {"space": "cosine"}
    }
    stored = chroma.get_or_create_collection.return_value.upsert
    assert stored.call_args.kwargs == {
        "ids": [chunk["id"]],
        "documents": [chunk["text"]],
        "embeddings": [[0.1]],
        "metadatas": [chunk["metadata"]],
    }
    assert client.post("/index", json={"chunks": [chunk, chunk]}).status_code == 422
    chunk["text"] = "   "
    assert client.post("/index", json={"chunks": [chunk]}).status_code == 422
    assert client.post("/index", json={"chunks": []}).status_code == 422
    cohere.embed.side_effect = RuntimeError("upstream failed")
    with pytest.raises(RuntimeError, match="upstream failed"):
        indexer.index_chunks([{"text": "new text"}])
    assert stored.call_count == 2  # Failed embedding never overwrites stored evidence.


def test_embed_single_call_and_skips_empty(monkeypatch):
    cohere = Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    assert embedder.embed([]) == []
    assert cohere.embed.call_count == 0
    chunks = ["chunk"] * 96
    assert embedder.embed(chunks) == [[0.1]] * 96
    assert cohere.embed.call_count == 1
    assert cohere.embed.call_args.kwargs["texts"] == chunks


def test_missing_key_has_actionable_error(monkeypatch):
    cohere_client.cache_clear()
    monkeypatch.delenv("COHERE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="Set COHERE_API_KEY"):
        cohere_client()

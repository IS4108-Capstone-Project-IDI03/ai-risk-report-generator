"""Keep source identity aligned when reranking changes search ordering."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from chromadb.errors import NotFoundError

from app.retrieval import retriever


def test_rerank_preserves_sources_and_skips_empty_database(monkeypatch):
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 2
    collection.query.return_value = {
        "ids": [["a", "b"]],
        "documents": [["fire", "flood"]],
        "metadatas": [[{"page": 1}, {"page": 2}]],
        "distances": [[0.1, 0.2]],
    }
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.3]]))
    cohere.rerank.return_value = SimpleNamespace(
        results=[SimpleNamespace(index=1, relevance_score=0.9)]
    )
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    assert retriever.retrieve("flood risk") == [
        {
            "id": "b",
            "text": "flood",
            "metadata": {"page": 2},
            "distance": 0.2,
            "relevance_score": 0.9,
        }
    ]
    assert cohere.embed.call_args.kwargs["input_type"] == "search_query"
    assert collection.query.call_args.kwargs["query_embeddings"] == [[0.3]]
    assert collection.query.call_args.kwargs["n_results"] == 2
    assert cohere.rerank.call_args.kwargs["documents"] == ["fire", "flood"]
    collection.count.return_value = 0
    assert retriever.retrieve("flood risk") == []
    chroma.get_collection.side_effect = NotFoundError("missing")
    assert retriever.retrieve("flood risk") == []
    assert cohere.embed.call_count == 1
    chroma.get_collection.side_effect = RuntimeError("database unavailable")
    with pytest.raises(RuntimeError, match="database unavailable"):
        retriever.retrieve("flood risk")


def test_a_wider_search_takes_more_candidates_and_keeps_every_reranked_one(monkeypatch):
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 100
    collection.query.return_value = {
        "ids": [["a", "b"]],
        "documents": [["fire", "flood"]],
        "metadatas": [[{}, {}]],
        "distances": [[0.1, 0.2]],
    }
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.3]]))
    cohere.rerank.return_value = SimpleNamespace(results=[])
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    retriever.retrieve("pump testing", candidates=40, top_n=None)
    assert collection.query.call_args.kwargs["n_results"] == 40
    assert cohere.rerank.call_args.kwargs["top_n"] == 2  # all candidates, not 5
    retriever.retrieve("pump testing")
    assert collection.query.call_args.kwargs["n_results"] == 20

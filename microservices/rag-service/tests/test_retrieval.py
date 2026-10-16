"""Keep source identity aligned when reranking changes search ordering."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from chromadb.errors import NotFoundError

from app.retrieval import retriever


@pytest.mark.parametrize("size", [20, 21, 45])
def test_search_batches_vectors_and_preserves_request_order(monkeypatch, size):
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 10
    vectors = [[float(i)] for i in range(size + 1)]
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=vectors))
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)

    def query(**kwargs):
        batch = kwargs["query_embeddings"]
        assert 0 < len(batch) <= 20
        return {
            "ids": [[str(v[0])] for v in batch],
            "documents": [[f"text {v[0]}"] for v in batch],
            "metadatas": [[{"page": v[0]}] for v in batch],
            "distances": [[v[0] / 100] for v in batch],
        }

    collection.query.side_effect = query
    requests = [(f"query {i}", {"source_type": "standard"}, 3) for i in range(size)]
    requests.insert(1, ("past report", {"source_type": "past_report"}, 2))
    results = retriever.search(requests)
    assert results == [
        [{"id": str(v[0]), "text": f"text {v[0]}", "metadata": {"page": v[0]},
          "distance": v[0] / 100}]
        for v in vectors
    ]
    assert collection.query.call_count == (size + 19) // 20 + 1
    cohere.embed.assert_called_once()
    calls = collection.query.call_args_list
    assert all(call.kwargs["n_results"] == 3 for call in calls[:-1])
    assert calls[-1].kwargs["n_results"] == 2
    assert calls[-1].kwargs["where"] == retriever.label_filter({"source_type": "past_report"})


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

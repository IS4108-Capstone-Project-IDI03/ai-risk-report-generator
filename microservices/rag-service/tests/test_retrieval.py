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


def test_a_rank_texts_hook_changes_only_what_the_reranker_reads(monkeypatch):
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 2
    collection.query.return_value = {
        "ids": [["a", "b"]],
        "documents": [["John Tan agreed", "flood"]],
        "metadatas": [[{"headings": ["Acme Holdings"]}, {}]],
        "distances": [[0.1, 0.2]],
    }
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.3]]))
    cohere.rerank.return_value = SimpleNamespace(
        results=[SimpleNamespace(index=0, relevance_score=0.9)]
    )
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    seen = []

    def masked(texts):
        seen.append(texts)
        return [
            t.replace("John Tan", "[PERSON_1]").replace("Acme Holdings", "[CLIENT_1]")
            for t in texts
        ]

    hits = retriever.retrieve("who agreed", rank_texts=masked)

    assert seen == [["Acme Holdings\nJohn Tan agreed", "flood"]]
    assert cohere.rerank.call_args.kwargs["documents"] == ["[CLIENT_1]\n[PERSON_1] agreed", "flood"]
    assert hits[0]["text"] == "John Tan agreed"  # the stored passage, for the model and the check


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


def test_a_search_of_many_queries_stays_within_chromas_per_query_limit(monkeypatch):
    # Chroma Cloud rejects a query with more than 20 query embeddings; a section with 25
    # observations searches 25 standards queries at once.
    class Collection:
        def __init__(self):
            self.sizes = []

        def count(self):
            return 10

        def query(self, query_embeddings, **_):
            if len(query_embeddings) > 20:
                raise RuntimeError("Quota exceeded: 'Number of query embeddings'")
            self.sizes.append(len(query_embeddings))
            # Each row's hit names the query it answers, from its embedding.
            return {
                "ids": [[f"hit-{int(v[0])}"] for v in query_embeddings],
                "documents": [["text"] for _ in query_embeddings],
                "metadatas": [[{}] for _ in query_embeddings],
                "distances": [[0.1] for _ in query_embeddings],
            }

    collection, cohere = Collection(), Mock()
    chroma = SimpleNamespace(get_collection=lambda **_: collection)
    cohere.embed.return_value = SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[float(i)] for i in range(25)])
    )
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)

    results = retriever.search([(f"q{i}", {"source_type": "fm_standard"}, 1) for i in range(25)])

    assert [r[0]["id"] for r in results] == [f"hit-{i}" for i in range(25)]
    assert collection.sizes == [20, 5]
    assert cohere.embed.call_count == 1


# ---- Cohere calls are retried on a timeout or rate limit, not failing a chat on one slow call ----


def test_a_cohere_timeout_is_retried_and_then_succeeds(monkeypatch):
    import httpx

    from app.retrieval import retriever

    sleeps = []
    monkeypatch.setattr(retriever.time, "sleep", sleeps.append)
    calls = []

    def call():
        calls.append(1)
        if len(calls) < 3:
            raise httpx.ReadTimeout("slow")
        return "ok"

    assert retriever._with_retries(call, "embed") == "ok"
    assert len(calls) == 3 and sleeps == list(retriever.RETRY_DELAYS)


def test_a_cohere_rate_limit_is_retried(monkeypatch):
    from cohere.errors import TooManyRequestsError

    from app.retrieval import retriever

    monkeypatch.setattr(retriever.time, "sleep", lambda s: None)
    calls = []

    def call():
        calls.append(1)
        if len(calls) == 1:
            raise TooManyRequestsError(body={})
        return "ok"

    assert retriever._with_retries(call, "rerank") == "ok"
    assert len(calls) == 2


def test_the_last_retry_gives_up_with_the_original_error(monkeypatch):
    import httpx

    from app.retrieval import retriever

    monkeypatch.setattr(retriever.time, "sleep", lambda s: None)
    calls = []

    def call():
        calls.append(1)
        raise httpx.ReadTimeout("still slow")

    with pytest.raises(httpx.ReadTimeout):
        retriever._with_retries(call, "embed")
    assert len(calls) == 1 + len(retriever.RETRY_DELAYS)


def test_other_errors_are_not_retried(monkeypatch):
    from app.retrieval import retriever

    monkeypatch.setattr(retriever.time, "sleep", lambda s: None)
    calls = []

    def call():
        calls.append(1)
        raise ValueError("a bad request")

    with pytest.raises(ValueError):
        retriever._with_retries(call, "embed")
    assert len(calls) == 1

"""POST /passages/meaning (IN-17): one knowledge document's passages ranked by meaning, for the
knowledge base's Passages view. Chroma and Cohere are faked and record what they are sent;
privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

from types import SimpleNamespace

import httpx
import pytest
from starlette.testclient import TestClient

from app.main import app
from app.retrieval import retriever

client = TestClient(app)

PRIVACY = {"enabled": True, "known_entities": [{"type": "CLIENT", "names": ["Acme Holdings"]}]}


class Cohere:
    """Records every text sent to Cohere; the reranker ranks the passages last first."""

    def __init__(self):
        self.sent: list[str] = []

    def embed(self, texts, **_):
        self.sent.extend(texts)
        return SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.1] for _ in texts]))

    def rerank(self, query, documents, top_n, **_):
        self.sent.extend([query, *documents])
        order = list(reversed(range(len(documents))))[:top_n]
        results = [
            SimpleNamespace(index=i, relevance_score=0.9 - n / 100) for n, i in enumerate(order)
        ]
        return SimpleNamespace(results=results)


class Collection:
    """Three passages of document "std"; records each query's filter and size."""

    def __init__(self):
        self.queries: list[dict] = []
        self.rows = [
            (f"std:{n}", f"Valves are inspected weekly at Acme Holdings ({n}).", {"doc_id": "std"})
            for n in range(3)
        ]

    def count(self):
        return len(self.rows)

    def query(self, query_embeddings, n_results, where, **_):
        self.queries.append({"where": where, "n_results": n_results})
        return {
            "ids": [[r[0] for r in self.rows]],
            "documents": [[r[1] for r in self.rows]],
            "metadatas": [[r[2] for r in self.rows]],
            "distances": [[0.3 for _ in self.rows]],
        }


@pytest.fixture
def search(monkeypatch):
    cohere, collection = Cohere(), Collection()
    chroma = SimpleNamespace(get_collection=lambda **_: collection)
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    return SimpleNamespace(cohere=cohere, collection=collection)


def meaning(query="how often are valves checked", **extra):
    return client.post("/passages/meaning", json={"query": query, "document_id": "std", **extra})


def test_it_ranks_one_documents_active_passages_by_meaning(search):
    response = meaning()

    assert response.status_code == 200
    assert [r["id"] for r in response.json()["results"]] == ["std:2", "std:1", "std:0"]
    (query,) = search.collection.queries
    assert query["where"] == {
        "$and": [
            {"doc_id": {"$in": ["std"]}},
            {"status": {"$nin": ["withdrawn", "needs_review"]}},
        ]
    }


def test_with_protection_on_no_client_detail_reaches_cohere(search, fake_privacy):
    response = meaning("valve checks at Acme Holdings", privacy=PRIVACY)

    assert response.status_code == 200
    assert search.cohere.sent, "Cohere was not called"
    assert not [t for t in search.cohere.sent if "Acme Holdings" in t], search.cohere.sent
    assert "valve checks at [CLIENT_1]" in search.cohere.sent


@pytest.mark.parametrize("failure", [503, httpx.ConnectError("down")])
def test_nothing_is_searched_when_the_query_cant_be_masked(search, fake_privacy, failure):
    fake_privacy.failure = failure

    response = meaning("valve checks at Acme Holdings", privacy=PRIVACY)

    assert response.status_code == 503
    assert "privacy service" in response.json()["detail"].lower()
    assert search.cohere.sent == []


def test_it_returns_the_paid_calls_it_made(search):
    response = meaning()

    usage = response.json()["usage"]
    assert [(u["feature"], u["billed_service"]) for u in usage] == [
        ("retrieval", "cohere-embed"),
        ("retrieval", "cohere-rerank"),
    ]

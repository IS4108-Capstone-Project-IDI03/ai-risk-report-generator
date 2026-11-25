"""QD-01: GET /index/status, and the ingestion write path end to end on in-memory Qdrant.

Doubles as the CRUD contract test for Qdrant: index, relabel, withdraw, delete.
"""

import pytest
from starlette.testclient import TestClient

from app import retrieval_config
from app.main import app
from app.pipeline import indexer

client = TestClient(app)
LABELS = {"source_type": "survey", "jurisdiction": "SG", "facility_type": "warehouse"}


def chunk(doc_id: str, n: int) -> dict:
    meta = {**LABELS, "doc_id": doc_id, "section": "Fire", "status": "active", "page_start": 1}
    return {"id": f"{doc_id}:{n}", "text": f"passage {n}", "metadata": meta}


@pytest.fixture
def store(monkeypatch):
    monkeypatch.setenv("VECTOR_STORE", "qdrant")
    monkeypatch.setenv("QDRANT_URL", ":memory:")
    retrieval_config.qdrant_client.cache_clear()
    monkeypatch.setattr(indexer, "embed", lambda texts, on_batch=None: [[1.0] * 1024] * len(texts))
    yield
    retrieval_config.qdrant_client.cache_clear()


def test_status_follows_index_relabel_withdraw_and_delete(store):
    indexer.index_chunks([chunk("a", 1), chunk("a", 2), chunk("b", 1)])

    body = client.get("/index/status").json()
    assert body["store"] == "qdrant"
    assert body["collection"] == retrieval_config.COLLECTION
    assert body["passages"] == 3
    assert body["documents"] == [
        {"doc_id": "a", "passages": 2, "statuses": {"active": 2}},
        {"doc_id": "b", "passages": 1, "statuses": {"active": 1}},
    ]

    indexer.relabel("a", {"jurisdiction": "MY", "status": "withdrawn"})
    only_a = client.get("/index/status", params={"doc_id": "a"}).json()
    assert only_a["passages"] == 2
    assert only_a["documents"] == [{"doc_id": "a", "passages": 2, "statuses": {"withdrawn": 2}}]

    assert indexer.delete_passages("a") == 2
    after = client.get("/index/status").json()
    assert after["passages"] == 1
    assert [d["doc_id"] for d in after["documents"]] == ["b"]


def test_empty_store_reports_zero(store):
    body = client.get("/index/status").json()
    assert body["passages"] == 0
    assert body["documents"] == []


def test_unreachable_store_answers_503_not_zero(monkeypatch):
    monkeypatch.setenv("VECTOR_STORE", "qdrant")
    monkeypatch.setenv("QDRANT_URL", "")
    retrieval_config.qdrant_client.cache_clear()

    response = client.get("/index/status")

    assert response.status_code == 503
    assert "could not be read" in response.json()["detail"]

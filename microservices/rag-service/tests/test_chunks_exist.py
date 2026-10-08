"""POST /chunks/exist (EV-01): which cited chunks are still in the index. Chroma is mocked."""

from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def fake_chroma(monkeypatch, found: dict):
    # `found` maps chunk id -> metadata; collection.get returns only the ids it holds.
    collection = Mock()
    collection.get.side_effect = lambda ids, include: {
        "ids": [i for i in ids if i in found],
        "metadatas": [found[i] for i in ids if i in found],
    }
    monkeypatch.setattr(
        "app.api.routes.chroma_client", lambda: Mock(get_collection=lambda **_: collection)
    )
    return collection


def test_reports_each_id_in_request_order(monkeypatch):
    collection = fake_chroma(
        monkeypatch,
        {
            "d1:3": {"doc_id": "d1", "status": "withdrawn", "page_start": 4},
            "d:2:0": {"doc_id": "d:2"},
        },
    )
    ids = ["C:d1:3", "P:d:2:0", "C:gone:1", "X:d1:3"]
    body = client.post("/chunks/exist", json={"ids": ids}).json()
    assert body["results"] == [
        {"id": "C:d1:3", "exists": True, "doc_id": "d1", "status": "withdrawn", "page_start": 4},
        {"id": "P:d:2:0", "exists": True, "doc_id": "d:2", "status": "active", "page_start": None},
        {"id": "C:gone:1", "exists": False, "doc_id": None, "status": None, "page_start": None},
        {"id": "X:d1:3", "exists": False, "doc_id": None, "status": None, "page_start": None},
    ]
    collection.get.assert_called_once_with(ids=["d1:3", "d:2:0", "gone:1"], include=["metadatas"])


def test_chroma_failure_is_503(monkeypatch):
    def boom():
        raise RuntimeError("chroma down")

    monkeypatch.setattr("app.api.routes.chroma_client", boom)
    assert client.post("/chunks/exist", json={"ids": ["C:d:1"]}).status_code == 503


def test_rejects_bad_requests():
    assert client.post("/chunks/exist", json={"ids": []}).status_code == 422
    assert client.post("/chunks/exist", json={"ids": ["C:d:1"] * 201}).status_code == 422
    assert client.post("/chunks/exist", json={"ids": ["C:d:1"], "x": 1}).status_code == 422


def test_a_chunk_without_metadata_still_exists(monkeypatch):
    fake_chroma(monkeypatch, {"d1:3": None})
    body = client.post("/chunks/exist", json={"ids": ["C:d1:3"]}).json()
    assert body["results"] == [
        {"id": "C:d1:3", "exists": True, "doc_id": "d1", "status": "active", "page_start": None}
    ]

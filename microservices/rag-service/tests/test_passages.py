"""GET /passages/{id} (CB-02): one passage's text and page boxes, for the citation panel.

Chroma is faked, so no database or paid call is involved.
"""

from unittest.mock import Mock

from chromadb.errors import NotFoundError
from fastapi.testclient import TestClient

from app.chat import passages
from app.main import app

client = TestClient(app)


def fake_chroma(monkeypatch, ids=None, documents=None, metadatas=None):
    """Points the lookup at a fake Chroma that holds at most one record."""
    chroma = Mock()
    chroma.get_collection.return_value.get.return_value = {
        "ids": ids or [],
        "documents": documents or [],
        "metadatas": metadatas or [],
    }
    monkeypatch.setattr(passages, "chroma_client", lambda: chroma)
    return chroma


def test_returns_text_headings_pages_and_boxes(monkeypatch):
    meta = {
        "doc_id": "d1",
        "headings": ["Chapter 8", "Sprinklers"],
        "page_start": 4,
        "page_end": 5,
        "bbox": [1.0, 700.0, 300.0, 650.0, 10.0, 90.0, 200.0, 40.0],
        "bbox_pages": [4, 5],
    }
    fake_chroma(monkeypatch, ["p1"], ["Sprinklers shall be fitted."], [meta])
    response = client.get("/passages/p1")
    assert response.status_code == 200
    assert response.json() == {
        "id": "p1",
        "documentId": "d1",
        "text": "Sprinklers shall be fitted.",
        "headings": ["Chapter 8", "Sprinklers"],
        "pageStart": 4,
        "pageEnd": 5,
        "boxes": [
            {"page": 4, "l": 1.0, "t": 700.0, "r": 300.0, "b": 650.0},
            {"page": 5, "l": 10.0, "t": 90.0, "r": 200.0, "b": 40.0},
        ],
    }


def test_missing_metadata_gives_empty_headings_boxes_and_null_pages(monkeypatch):
    fake_chroma(monkeypatch, ["p1"], ["text"], [{"doc_id": "d1"}])
    body = client.get("/passages/p1").json()
    assert (body["headings"], body["boxes"]) == ([], [])
    assert (body["pageStart"], body["pageEnd"]) == (None, None)


def test_boxes_without_bbox_pages_use_the_first_page(monkeypatch):
    meta = {"doc_id": "d1", "page_start": 7, "page_end": 7, "bbox": [1.0, 2.0, 3.0, 4.0]}
    fake_chroma(monkeypatch, ["p1"], ["text"], [meta])
    assert client.get("/passages/p1").json()["boxes"] == [
        {"page": 7, "l": 1.0, "t": 2.0, "r": 3.0, "b": 4.0}
    ]


def test_unknown_id_is_404(monkeypatch):
    fake_chroma(monkeypatch)
    assert client.get("/passages/nope").status_code == 404


def test_missing_collection_is_404(monkeypatch):
    chroma = fake_chroma(monkeypatch)
    chroma.get_collection.side_effect = NotFoundError("missing")
    assert client.get("/passages/p1").status_code == 404


def test_withdrawn_passage_still_opens(monkeypatch):
    chroma = fake_chroma(monkeypatch, ["p1"], ["old"], [{"doc_id": "d1", "status": "withdrawn"}])
    assert client.get("/passages/p1").status_code == 200
    # No status filter: a withdrawn edition's citation (CB-01 AC14) must still open.
    assert "where" not in chroma.get_collection.return_value.get.call_args.kwargs

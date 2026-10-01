"""Relabelling a document's passages after a correction (KB-01), with Chroma faked."""

from unittest.mock import Mock

from chromadb.errors import NotFoundError
from starlette.testclient import TestClient

from app.main import app
from app.pipeline import indexer

client = TestClient(app)

DOC_ID = "6abb28ae16068a0793e9962a"
OLD = {
    "source_type": "marsh_report",
    "jurisdiction": "MY",
    "facility_type": "Cold store",
    "COPE_dimension": "all",
    "effective_date": "2024-03-12",
}
NEW = {**OLD, "jurisdiction": "SG", "facility_type": "Data centre"}


class FakeCollection:
    """The two Chroma calls relabelling makes, over in-memory passages."""

    def __init__(self, records):
        self.records = records  # passage id -> metadata

    def get(self, where, include):
        assert include == ["metadatas"]
        ids = [i for i, m in self.records.items() if m["doc_id"] == where["doc_id"]]
        return {"ids": ids, "metadatas": [self.records[i] for i in ids]}

    def update(self, ids, metadatas):
        self.records.update(zip(ids, metadatas))


def install(monkeypatch, collection):
    chroma = Mock()
    chroma.get_collection.return_value = collection
    monkeypatch.setattr(indexer, "chroma_client", lambda: chroma)
    return chroma


def test_relabels_only_that_documents_passages_and_keeps_their_other_metadata(monkeypatch):
    other = {"doc_id": "someone-else", "page_start": 1, **OLD}
    collection = FakeCollection(
        {
            f"{DOC_ID}:0": {"doc_id": DOC_ID, "headings": ["Sprinklers"], "page_start": 2, **OLD},
            f"{DOC_ID}:1": {"doc_id": DOC_ID, "page_start": 3, **OLD},
            "someone-else:0": dict(other),
        }
    )
    install(monkeypatch, collection)

    response = client.put(f"/documents/{DOC_ID}/labels", json=NEW)

    assert response.status_code == 200
    assert response.json() == {"passagesUpdated": 2}
    assert collection.records == {
        f"{DOC_ID}:0": {"doc_id": DOC_ID, "headings": ["Sprinklers"], "page_start": 2, **NEW},
        f"{DOC_ID}:1": {"doc_id": DOC_ID, "page_start": 3, **NEW},
        "someone-else:0": other,
    }


def test_a_document_with_no_passages_updates_none(monkeypatch):
    install(monkeypatch, FakeCollection({}))

    response = client.put(f"/documents/{DOC_ID}/labels", json=NEW)

    assert response.json() == {"passagesUpdated": 0}


def test_no_collection_yet_updates_none(monkeypatch):
    chroma = install(monkeypatch, None)
    chroma.get_collection.side_effect = NotFoundError("Collection does not exist")

    response = client.put(f"/documents/{DOC_ID}/labels", json=NEW)

    assert response.json() == {"passagesUpdated": 0}


def test_a_blank_or_missing_label_is_refused(monkeypatch):
    collection = FakeCollection({f"{DOC_ID}:0": {"doc_id": DOC_ID, **OLD}})
    install(monkeypatch, collection)

    blank = {**NEW, "jurisdiction": " "}
    assert client.put(f"/documents/{DOC_ID}/labels", json=blank).status_code == 422
    no_date = {k: v for k, v in NEW.items() if k != "effective_date"}
    assert client.put(f"/documents/{DOC_ID}/labels", json=no_date).status_code == 422
    assert collection.records[f"{DOC_ID}:0"]["jurisdiction"] == "MY"

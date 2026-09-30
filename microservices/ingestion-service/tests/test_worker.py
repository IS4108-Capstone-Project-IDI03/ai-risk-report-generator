"""Ingestion worker (IN-01): one queued knowledge document through the pipeline.

MongoDB, S3 and the pipeline are faked, so no Redis, AWS or Docling is needed.
"""

from pathlib import Path

import pytest
from bson import ObjectId

from app import worker

DOC_ID = "6abb28ae16068a0793e9962a"
PDF = b"%PDF-1.7 original bytes"


class FakeDocuments:
    """The two pymongo calls the worker makes, over one in-memory document."""

    def __init__(self, status="queued"):
        self.doc = {
            "_id": ObjectId(DOC_ID),
            "fileName": "NFPA 13 - 2022.pdf",
            "file": {"key": f"knowledge/{DOC_ID}.pdf"},
            "status": status,
        }

    def find_one_and_update(self, query, update, **_):
        if query["_id"] != self.doc["_id"] or self.doc["status"] not in query["status"]["$in"]:
            return None
        self.doc.update(update["$set"])
        return dict(self.doc)

    def update_one(self, query, update):
        assert query == {"_id": self.doc["_id"]}
        self.doc.update(update["$set"])


@pytest.fixture
def documents(monkeypatch):
    fake = FakeDocuments()
    monkeypatch.setattr(worker, "documents", lambda: fake)
    monkeypatch.setattr(worker, "download", lambda key, dest: Path(dest).write_bytes(PDF))
    return fake


def test_a_processed_document_is_complete_with_its_counts(documents, monkeypatch):
    seen = {}

    def fake_run(file_path, doc_id=None):
        seen.update(bytes=Path(file_path).read_bytes(), doc_id=doc_id)
        return {"doc_name": "x", "chunks_indexed": 12, "tables_captured": 2, "images_captured": 1}

    monkeypatch.setattr(worker, "run", fake_run)

    worker.ingest_document(DOC_ID)

    assert seen == {"bytes": PDF, "doc_id": DOC_ID}
    assert documents.doc["status"] == "complete"
    assert documents.doc["result"] == {
        "chunksIndexed": 12,
        "tablesCaptured": 2,
        "imagesCaptured": 1,
    }
    assert documents.doc["startedAt"] <= documents.doc["finishedAt"]


def test_a_document_that_cannot_be_processed_is_failed_with_the_reason(documents, monkeypatch):
    def fake_run(file_path, doc_id=None):
        raise RuntimeError("Docling could not parse NFPA 13 - 2022.pdf")

    monkeypatch.setattr(worker, "run", fake_run)

    with pytest.raises(RuntimeError):
        worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "failed"
    assert documents.doc["error"] == "Docling could not parse NFPA 13 - 2022.pdf"
    assert "finishedAt" in documents.doc


def test_a_finished_document_is_left_alone(documents, monkeypatch):
    documents.doc["status"] = "complete"
    monkeypatch.setattr(worker, "run", lambda *a, **k: pytest.fail("run() must not be called"))

    worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "complete"


def test_a_document_interrupted_mid_processing_is_processed_again(documents, monkeypatch):
    # The worker died mid-run; BullMQ hands the stalled job out again.
    documents.doc["status"] = "processing"
    monkeypatch.setattr(
        worker,
        "run",
        lambda *a, **k: {"chunks_indexed": 1, "tables_captured": 0, "images_captured": 0},
    )

    worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "complete"


def test_jobs_share_one_database_client(monkeypatch):
    # MongoClient connects lazily, so no database is needed here.
    monkeypatch.setenv("MONGODB_URI", "mongodb://127.0.0.1:1/in01-test")
    worker.documents.cache_clear()

    assert worker.documents() is worker.documents()

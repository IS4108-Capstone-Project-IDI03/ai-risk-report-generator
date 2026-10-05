"""Ingestion worker (IN-01): one queued knowledge document through the pipeline.

MongoDB, S3 and the pipeline are faked, so no Redis, AWS or Docling is needed.
"""

from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId

from app import worker
from app.pipeline import UnparsableDocumentError
from app.pipeline.progress import ProgressReporter

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
            "metadata": {
                "source_type": "marsh_report",
                "jurisdiction": "MY",
                "facility_type": "Cold store",
                "COPE_dimension": "all",
                "effective_date": datetime(2024, 3, 12),
            },
        }

    def find_one_and_update(self, query, update, **_):
        if query["_id"] != self.doc["_id"] or self.doc["status"] not in query["status"]["$in"]:
            return None
        self.doc.update(update["$set"])
        return dict(self.doc)

    def update_one(self, query, update):
        assert query == {"_id": self.doc["_id"]}
        self.doc.update(update["$set"])


class FakeJobs:
    """The ingestion_jobs collection the ProgressReporter writes to.

    Mimics find_one_and_update with upsert over one in-memory job document,
    applying $set the same way MongoDB would.
    """

    def __init__(self):
        self.doc: dict | None = None

    def find_one_and_update(self, query, update, **_):
        if self.doc is None:
            self.doc = dict(query)
        self.doc.update(update.get("$set", {}))
        for field in update.get("$unset", {}):
            self.doc.pop(field, None)
        return dict(self.doc)


@pytest.fixture
def documents(monkeypatch):
    fake = FakeDocuments()
    jobs = FakeJobs()
    monkeypatch.setattr(worker, "documents", lambda: fake)
    monkeypatch.setattr(worker, "jobs", lambda: jobs)
    monkeypatch.setattr(worker, "download", lambda key, dest: Path(dest).write_bytes(PDF))
    # Expose the jobs collection on the fixture so tests can assert on it.
    fake.jobs = jobs
    return fake


def test_a_processed_document_is_complete_with_its_counts(documents, monkeypatch):
    seen = {}

    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        seen.update(bytes=Path(file_path).read_bytes(), doc_id=doc_id)
        reporter.start_stage("parsing")
        reporter.start_stage("chunking")
        reporter.start_stage("anonymising")
        reporter.start_stage("indexing")
        reporter.finish()
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


def test_the_documents_labels_go_to_every_passage(documents, monkeypatch):
    # KB-01: passages carry the record's labels, the date as YYYY-MM-DD.
    seen = {}

    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        seen["labels"] = labels
        return {"chunks_indexed": 1, "tables_captured": 0, "images_captured": 0}

    monkeypatch.setattr(worker, "run", fake_run)

    worker.ingest_document(DOC_ID)

    assert seen["labels"] == {
        "source_type": "marsh_report",
        "jurisdiction": "MY",
        "facility_type": "Cold store",
        "COPE_dimension": "all",
        "effective_date": "2024-03-12",
        "status": "active",  # KB-01: passages start active
    }


def test_a_pdf_whose_text_cannot_be_read_is_failed_with_a_plain_reason(documents, monkeypatch):
    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        raise UnparsableDocumentError(file_path, "Docling produced no extractable content")

    monkeypatch.setattr(worker, "run", fake_run)

    with pytest.raises(UnparsableDocumentError):
        worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "failed"
    assert (
        documents.doc["error"]
        == "No text could be read from this PDF. Upload a copy with selectable text."
    )
    assert "finishedAt" in documents.doc


def test_a_system_error_is_failed_with_a_plain_reason_not_the_technical_one(documents, monkeypatch):
    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        raise OSError(-2, "Name or service not known")

    monkeypatch.setattr(worker, "run", fake_run)

    with pytest.raises(OSError):
        worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "failed"
    assert (
        documents.doc["error"]
        == "Processing stopped on a system error, not a fault in the file. Upload it again."
    )


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


# --- Progress reporting (E2): the worker drives a ProgressReporter per job.


def _logged_stages(job_doc: dict) -> list[str]:
    return [entry["stage"] for entry in job_doc.get("stageLog", [])]


def test_a_successful_run_leaves_a_finished_job_with_every_stage_logged(documents, monkeypatch):
    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        reporter.start_stage("parsing")
        reporter.start_stage("chunking")
        reporter.start_stage("anonymising")
        reporter.start_stage("indexing")
        reporter.finish()
        return {"chunks_indexed": 3, "tables_captured": 0, "images_captured": 0}

    monkeypatch.setattr(worker, "run", fake_run)

    worker.ingest_document(DOC_ID)

    job = documents.jobs.doc
    assert job is not None
    # finish() clears the current stage once the run is done.
    assert "currentStage" not in job
    assert _logged_stages(job) == ["parsing", "chunking", "anonymising", "indexing"]


def test_a_failed_run_records_the_failed_stage_in_the_log(documents, monkeypatch):
    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        reporter.start_stage("parsing")
        raise UnparsableDocumentError(file_path, "Docling produced no extractable content")

    monkeypatch.setattr(worker, "run", fake_run)

    with pytest.raises(UnparsableDocumentError):
        worker.ingest_document(DOC_ID)

    assert "failed" in _logged_stages(documents.jobs.doc)


def test_jobs_share_one_database_client(monkeypatch):
    # MongoClient connects lazily, so no database is needed here.
    monkeypatch.setenv("MONGODB_URI", "mongodb://127.0.0.1:1/in01-test")
    worker.jobs.cache_clear()

    assert worker.jobs() is worker.jobs()

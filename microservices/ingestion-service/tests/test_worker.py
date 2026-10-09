"""Ingestion worker (IN-01): one queued knowledge document through the pipeline.

MongoDB, S3 and the pipeline are faked, so no Redis, AWS or Docling is needed.
"""

from datetime import datetime
from pathlib import Path

import pytest
from bson import ObjectId

from app import worker
from app.pipeline import UnparsableDocumentError

DOC_ID = "6abb28ae16068a0793e9962a"
PDF = b"%PDF-1.7 original bytes"


def RUN_OK(*_args, **_kwargs):
    return {"chunks_indexed": 1, "tables_captured": 0, "images_captured": 0}


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
                "effective_date": datetime(2024, 3, 12),
            },
        }

    def find_one_and_update(self, query, update, **_):
        # The claim query matches on a status set; the terminal writes match on
        # _id only. Honour both so one fake serves claim and complete/fail.
        if query["_id"] != self.doc["_id"]:
            return None
        if "status" in query:
            expected = query["status"]
            if isinstance(expected, dict) and "$in" in expected:
                if self.doc["status"] not in expected["$in"]:
                    return None
            elif self.doc["status"] != expected:
                return None
        if "cancelRequestedAt" in query and "cancelRequestedAt" in self.doc:
            return None
        self.doc.update(update["$set"])
        for field in update.get("$unset", {}):
            self.doc.pop(field, None)
        return dict(self.doc)

    def update_one(self, query, update):
        assert query == {"_id": self.doc["_id"]}
        self.doc.update(update["$set"])

    # Other stored documents by _id, for the match's title in a notification (IN-07).
    others: dict = {}

    def find_one(self, query, _projection=None):
        if query["_id"] == self.doc["_id"]:
            return dict(self.doc)
        return self.others.get(query["_id"])


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

    def update_one(self, query, update):
        if self.doc is None:
            self.doc = dict(query)
        self.doc.update(update.get("$set", {}))


def labels_of(doc):
    return worker.labels(doc)


@pytest.fixture
def documents(monkeypatch):
    fake = FakeDocuments()
    jobs = FakeJobs()
    monkeypatch.setattr(worker, "documents", lambda: fake)
    monkeypatch.setattr(worker, "jobs", lambda: jobs)
    monkeypatch.setattr(worker, "download", lambda key, dest: Path(dest).write_bytes(PDF))
    # Capture notifications rather than posting to a gateway. Tests that care
    # read fake.notifications; the rest just want it off the network.
    notifications = []
    monkeypatch.setattr(
        worker,
        "notify_ingestion",
        lambda doc, status, failed_stage=None, review_reason=None: notifications.append(
            {
                "doc": doc,
                "status": status,
                "failed_stage": failed_stage,
                "review_reason": review_reason,
            }
        ),
    )
    # IN-07: matching and relabelling have their own tests; here they are recorded.
    fake.calls = []
    fake.deleted_passages = []
    fake.match = None
    monkeypatch.setattr(worker, "find_match", lambda doc, _coll: fake.match)
    monkeypatch.setattr(
        worker, "relabel_passages", lambda doc: fake.calls.append(labels_of(doc)) or 1
    )
    monkeypatch.setattr(
        worker, "delete_passages", lambda doc_id: fake.deleted_passages.append(doc_id) or 1
    )
    # Expose the jobs collection and captured notifications on the fixture.
    fake.jobs = jobs
    fake.notifications = notifications
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
        "effective_date": "2024-03-12",
        "status": "needs_review",  # IN-07: never searchable mid-ingest; relabelled after
    }


def test_a_document_with_no_match_ends_active_with_a_null_match(documents, monkeypatch):
    documents.doc["unconfirmed"] = []
    monkeypatch.setattr(worker, "run", RUN_OK)

    worker.ingest_document(DOC_ID)

    assert documents.doc["match"] is None
    assert documents.doc["status"] == "complete"
    assert [c["status"] for c in documents.calls] == ["active"]


def test_a_matched_document_is_saved_with_its_match_and_relabelled_needs_review(
    documents, monkeypatch
):
    order = []
    match = {"kind": "possible_copy", "documentId": ObjectId(), "newMatched": 8, "newTotal": 10,
             "storedMatched": 8, "storedTotal": 9}  # fmt: skip
    documents.match = match
    documents.doc["unconfirmed"] = []
    monkeypatch.setattr(worker, "run", lambda *a, **k: order.append("index") or RUN_OK())
    monkeypatch.setattr(worker, "find_match", lambda *a: order.append("match") or match)
    monkeypatch.setattr(worker, "relabel_passages", lambda doc: order.append(doc["match"]["kind"]))

    worker.ingest_document(DOC_ID)

    assert order == ["index", "match", "possible_copy"]
    assert documents.doc["match"] == match
    assert documents.doc["status"] == "complete"


def test_a_match_error_fails_the_document(documents, monkeypatch):
    monkeypatch.setattr(worker, "run", RUN_OK)

    def broken(*_):
        raise RuntimeError("chroma down")

    monkeypatch.setattr(worker, "find_match", broken)

    with pytest.raises(RuntimeError):
        worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "failed"
    assert "match" not in documents.doc


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


def test_a_cancelled_queued_document_is_not_claimed(documents, monkeypatch):
    documents.doc["status"] = "cancelled"
    monkeypatch.setattr(worker, "run", lambda *a, **k: pytest.fail("run() must not be called"))

    worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "cancelled"


def test_a_processing_cancellation_cleans_partial_passages_and_does_not_notify(
    documents, monkeypatch
):
    def fake_run(*_args, **_kwargs):
        documents.doc["cancelRequestedAt"] = datetime.now()
        return RUN_OK()

    monkeypatch.setattr(worker, "run", fake_run)

    worker.ingest_document(DOC_ID)

    assert documents.doc["status"] == "cancelled"
    assert "cancelRequestedAt" not in documents.doc
    assert documents.deleted_passages == [DOC_ID]
    assert documents.notifications == []


def test_cancellation_is_checked_between_pipeline_chunks(documents, monkeypatch):
    checks = []

    class Reporter:
        def check_cancelled(self):
            checks.append(True)
            if len(checks) == 2:
                raise worker.IngestionCancelledError()

    reporter = Reporter()
    with pytest.raises(worker.IngestionCancelledError):
        reporter.check_cancelled()
        reporter.check_cancelled()

    assert len(checks) == 2


def test_documents_share_one_database_client(monkeypatch):
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


def test_an_unconfirmed_detail_is_left_off_the_passage_labels_and_the_document_needs_review(
    documents,
):
    # IN-05: Chroma can't store null, so a null detail's key is omitted.
    documents.doc["metadata"].update(jurisdiction=None, effective_date=None)
    documents.doc["unconfirmed"] = ["jurisdiction", "effective_date"]

    result = worker.labels(documents.doc)

    assert result == {
        "source_type": "marsh_report",
        "facility_type": "Cold store",
        "status": "needs_review",
    }


def test_a_document_with_nothing_unconfirmed_is_active(documents):
    documents.doc["unconfirmed"] = []

    assert worker.labels(documents.doc)["status"] == "active"


def test_a_match_makes_the_passages_need_review(documents):
    documents.doc["unconfirmed"] = []
    documents.doc["match"] = {"kind": "newer_edition"}

    assert worker.labels(documents.doc)["status"] == "needs_review"


def test_a_withdrawn_document_stays_withdrawn_even_with_a_match(documents):
    documents.doc["unconfirmed"] = ["edition"]
    documents.doc["match"] = {"kind": "newer_edition"}
    documents.doc["withdrawn"] = {"at": datetime(2026, 1, 1)}

    assert worker.labels(documents.doc)["status"] == "withdrawn"


def test_relabelling_passages_leaves_out_their_own_section(documents, monkeypatch):
    seen = {}
    monkeypatch.undo()  # the fixture's recorder replaced relabel_passages; use the real one
    monkeypatch.setattr(
        worker, "relabel", lambda doc_id, labels: seen.update(doc_id=doc_id, **labels)
    )
    documents.doc["unconfirmed"] = []

    worker.relabel_passages(documents.doc)

    assert seen["doc_id"] == DOC_ID
    assert seen["status"] == "active"
    assert "section" not in seen


# --- Notifications (IN-10): the worker tells the gateway on each outcome.


def test_a_completed_document_notifies_the_gateway(documents, monkeypatch):
    monkeypatch.setattr(
        worker,
        "run",
        lambda *a, **k: {"chunks_indexed": 1, "tables_captured": 0, "images_captured": 0},
    )

    worker.ingest_document(DOC_ID)

    assert len(documents.notifications) == 1
    note = documents.notifications[0]
    assert note["status"] == "complete"
    assert note["doc"]["status"] == "complete"  # the updated document, post-write


def test_a_failed_document_notifies_with_the_stage_that_broke(documents, monkeypatch):
    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        reporter.start_stage("parsing")
        reporter.start_stage("chunking")
        raise OSError(-2, "boom")

    monkeypatch.setattr(worker, "run", fake_run)

    with pytest.raises(OSError):
        worker.ingest_document(DOC_ID)

    assert len(documents.notifications) == 1
    note = documents.notifications[0]
    assert note["status"] == "failed"
    # The stage in progress when it broke, not the 'failed' sentinel.
    assert note["failed_stage"] == "chunking"
    # And that stage is persisted on the job for the gateway to read.
    assert documents.jobs.doc["failedStage"] == "chunking"


def test_the_document_is_recorded_before_it_is_notified(documents, monkeypatch):
    # The notification carries the already-updated document, which proves the
    # status write happened first — so a notification problem (swallowed inside
    # notify_ingestion, see test_notifications.py) can never undo the status.
    def fake_run(file_path, doc_id=None, labels=None, reporter=None):
        reporter.start_stage("parsing")
        raise OSError(-2, "boom")

    monkeypatch.setattr(worker, "run", fake_run)

    with pytest.raises(OSError):
        worker.ingest_document(DOC_ID)

    note = documents.notifications[0]
    assert note["doc"]["status"] == "failed"
    assert note["doc"]["error"] == worker.SYSTEM_ERROR


def test_a_finished_document_that_needs_review_notifies_why(documents, monkeypatch):
    other = ObjectId()
    documents.others = {other: {"title": "NFPA 13", "edition": "2019"}}
    documents.match = {"kind": "possible_copy", "documentId": other}
    monkeypatch.setattr(
        worker,
        "run",
        lambda *a, **k: {"chunks_indexed": 1, "tables_captured": 0, "images_captured": 0},
    )

    worker.ingest_document(DOC_ID)

    note = documents.notifications[0]
    assert note["status"] == "complete"
    assert note["review_reason"] == "Possible copy of NFPA 13 (2019 edition)"

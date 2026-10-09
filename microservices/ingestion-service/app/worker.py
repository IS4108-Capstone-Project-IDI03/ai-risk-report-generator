"""Ingestion worker (IN-01): runs queued knowledge documents through the pipeline.

The gateway stores each uploaded PDF in S3, records it in MongoDB's
`knowledge_documents` as `queued`, and adds a BullMQ job `{documentId}` to the
`ingestion` queue in Redis. This worker takes one job at a time, downloads the
original, runs `app.pipeline.run` and records the outcome on the document.

A separate long-running program, not a web server: it waits on the queue.
Redis/BullMQ knows the jobs; MongoDB knows each document's status.

Run with `python -m app.worker`. Needs REDIS_URL, MONGODB_URI, S3_BUCKET,
AWS_REGION and the AWS credentials, plus everything `run()` needs.
"""

import asyncio
import logging
import os
import signal
import tempfile
from datetime import UTC, datetime
from functools import cache
from pathlib import Path

import boto3
from bson import ObjectId
from bullmq import Worker
from dotenv import load_dotenv
from pymongo import MongoClient, ReturnDocument

from app.matching import find_match
from app.notifications import notify_ingestion, review_reason
from app.pipeline import IngestionCancelledError, UnparsableDocumentError, run
from app.pipeline.indexer import delete_passages, relabel
from app.pipeline.progress import ProgressReporter

load_dotenv(Path(__file__).resolve().parent / "../../../.env")

QUEUE = "ingestion"  # must match server/src/services/ingestion-queue.service.ts

log = logging.getLogger("ingestion-worker")

# Failure reasons the admin sees in Recent uploads. Plain words, cause then next
# step (docs/design-system.md "Errors"); the technical error goes to the log.
UNREADABLE = "No text could be read from this PDF. Upload a copy with selectable text."
SYSTEM_ERROR = "Processing stopped on a system error, not a fault in the file. Upload it again."


def cancellation_requested(collection, document_id: ObjectId) -> bool:
    """Return whether MongoDB has asked this document's worker to stop."""
    current = collection.find_one({"_id": document_id})
    return bool(current and (current.get("status") == "cancelled" or current.get("cancelRequestedAt")))


def ensure_not_cancelled(collection, document_id: ObjectId) -> None:
    if cancellation_requested(collection, document_id):
        raise IngestionCancelledError()


def finish_cancellation(collection, document_id: ObjectId, reporter: ProgressReporter) -> None:
    """Remove partial passages and mark a processing document cancelled."""
    delete_passages(str(document_id))
    collection.find_one_and_update(
        {"_id": document_id, "status": "processing"},
        {
            "$set": {"status": "cancelled", "cancelledAt": datetime.now(UTC)},
            "$unset": {"cancelRequestedAt": "", "error": "", "result": "", "finishedAt": ""},
        },
        return_document=ReturnDocument.AFTER,
    )
    reporter.cancel()


@cache  # one client (and its connection pool) for the life of the worker
def documents():
    """Return the `knowledge_documents` collection in MONGODB_URI's database."""
    return MongoClient(os.environ["MONGODB_URI"]).get_default_database()["knowledge_documents"]


@cache  # shares the same client pool as documents(); cached for the worker's life
def jobs():
    """Return the `ingestion_jobs` collection the ProgressReporter writes to (E2)."""
    return MongoClient(os.environ["MONGODB_URI"]).get_default_database()["ingestion_jobs"]


def download(key: str, dest: str) -> None:
    """Save the S3 object `key` to the local path `dest`."""
    s3 = boto3.client("s3", region_name=os.environ["AWS_REGION"])
    s3.download_file(os.environ["S3_BUCKET"], key, dest)


def labels(doc: dict) -> dict:
    """Return the document's labels as passage metadata: its known details and status.

    Chroma metadata holds only strings and numbers, so the date becomes
    YYYY-MM-DD and an Unconfirmed (null) detail is left out: without that,
    Chroma would reject the whole upsert. Status is `withdrawn` if withdrawn,
    else `needs_review` while any detail is Unconfirmed (IN-05) or the document
    has a `match` (IN-07), else `active`. Must match `labels()` in
    server/src/services/knowledge-document.service.ts, which relabels passages
    after a correction (KB-01) and emits status active, withdrawn or needs_review.
    """
    metadata = dict(doc["metadata"])
    if metadata.get("effective_date") is not None:
        metadata["effective_date"] = metadata["effective_date"].strftime("%Y-%m-%d")
    known = {key: value for key, value in metadata.items() if value is not None}
    if doc.get("withdrawn"):
        status = "withdrawn"
    elif doc.get("unconfirmed") or doc.get("match"):
        status = "needs_review"
    else:
        status = "active"
    return {**known, "status": status}


def relabel_passages(doc: dict) -> int:
    """Put the document's current labels on its passages; returns how many changed.

    Never touches `section`: each passage keeps its own, set at ingest (IN-05).
    Called by ingest_document and by POST /documents/{id}/match.
    """
    return relabel(str(doc["_id"]), labels(doc))


def ingest_document(document_id: str) -> None:
    """Run one queued document through the pipeline; returns None, records the outcome.

    Raises whatever made ingestion fail, after recording it as the reason.
    """
    collection = documents()
    _id = ObjectId(document_id)
    # 1. Claim: one atomic find-and-set, so two workers cannot take the same
    # document. `processing` is claimable too: if a worker crashes, its lock in
    # Redis expires, BullMQ hands the job out again ("stalled"), and the new run
    # starts the document over. A finished document is never re-run.
    doc = collection.find_one_and_update(
        {
            "_id": _id,
            "status": {"$in": ["queued", "processing"]},
            "cancelRequestedAt": {"$exists": False},
        },
        {"$set": {"status": "processing", "startedAt": datetime.now(UTC)}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        log.warning("Document %s is already finished or missing; skipping.", document_id)
        return

    # One progress reporter per job (E2): records each stage transition to
    # ingestion_jobs, which the gateway reads while the document is processing.
    reporter = ProgressReporter(
        jobs(), document_id, lambda: cancellation_requested(collection, _id)
    )

    # 2. Download the original into a temporary folder that deletes itself, and
    # 3. run ingestion pipeline: parse → chunk → anonymise → index, with the
    # document's labels on every passage. run() reports its own stages and calls
    # finish() on success. Passages go in as needs_review so a document that is
    # mid-ingest is never searchable (IN-07); step 4 sets the final status.
    try:
        with tempfile.TemporaryDirectory() as tmp:
            # Keep the original file name: the parser reports it as the doc name.
            path = str(Path(tmp) / Path(doc["fileName"]).name)
            download(doc["file"]["key"], path)
            ensure_not_cancelled(collection, _id)
            summary = run(
                path,
                doc_id=document_id,
                labels={**labels(doc), "status": "needs_review"},
                reporter=reporter,
            )
        # 4. Look for a copy or another edition among stored documents, then give
        # the passages their final labels. An error here fails the document like
        # any other stage; without that it could go live with the wrong status.
        ensure_not_cancelled(collection, _id)
        match = find_match(doc, collection)
        ensure_not_cancelled(collection, _id)
        relabel_passages({**doc, "match": match})
        ensure_not_cancelled(collection, _id)
    except IngestionCancelledError:
        finish_cancellation(collection, _id, reporter)
        return
    # 5. Record the outcome: failed here, complete below. The admin sees a plain
    # reason; re-raising tells BullMQ the job failed (not retried: attempts is 1).
    except Exception as error:
        if cancellation_requested(collection, _id):
            finish_cancellation(collection, _id, reporter)
            return
        log.exception("Ingesting document %s failed.", document_id)
        # The stage that was running when it broke, read before the 'failed'
        # sentinel is appended, so the notification can name it (IN-10).
        failed_stage = reporter.current_stage
        # Record the failed stage so the gateway shows "Failed" (E2), and keep
        # the real stage as a field so the gateway/notification need not infer
        # it from the stage log.
        reporter.start_stage("failed")
        reporter.finish()
        if failed_stage:
            jobs().update_one({"documentId": _id}, {"$set": {"failedStage": failed_stage}})
        reason = UNREADABLE if isinstance(error, UnparsableDocumentError) else SYSTEM_ERROR
        failed = collection.find_one_and_update(
            {"_id": _id},
            {"$set": {"status": "failed", "error": reason, "finishedAt": datetime.now(UTC)}},
            return_document=ReturnDocument.AFTER,
        )
        # Tell the gateway after the status is safely recorded; never let a
        # notification failure undo the status write or mask the ingestion error.
        notify_ingestion(failed or doc, status="failed", failed_stage=failed_stage)
        raise

    completed = collection.find_one_and_update(
        {"_id": _id, "status": "processing", "cancelRequestedAt": {"$exists": False}},
        {
            "$set": {
                "status": "complete",
                "result": {
                    "chunksIndexed": summary["chunks_indexed"],
                    "tablesCaptured": summary["tables_captured"],
                    "imagesCaptured": summary["images_captured"],
                },
                "finishedAt": datetime.now(UTC),
                "match": match,
            }
        },
        return_document=ReturnDocument.AFTER,
    )
    if completed is None:
        if cancellation_requested(collection, _id):
            finish_cancellation(collection, _id, reporter)
            return
        log.warning("Document %s changed before completion; skipping notification.", document_id)
        return
    # A document left waiting for an admin says so, and why, in the bell (IN-07).
    final = completed or doc
    matched = (
        collection.find_one(
            {"_id": match["documentId"]}, {"title": 1, "edition": 1, "withdrawn": 1}
        )
        if match
        else None
    )
    notify_ingestion(final, status="complete", review_reason=review_reason(final, matched))


async def process(job, _token):
    # run() is CPU-bound for minutes; a thread keeps the event loop free for the
    # BullMQ Worker to renew the job's lock in Redis (its "still alive" signal),
    # so BullMQ does not think the worker stalled.
    await asyncio.to_thread(ingest_document, job.data["documentId"])


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    # concurrency 1: documents are ingested one at a time (IN-01 AC3).
    worker = Worker(QUEUE, process, {"connection": os.environ["REDIS_URL"], "concurrency": 1})
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    log.info("Waiting for ingestion jobs on '%s'.", QUEUE)
    await stop.wait()
    await worker.close()


if __name__ == "__main__":
    asyncio.run(main())

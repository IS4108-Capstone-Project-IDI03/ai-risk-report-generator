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

from app.pipeline import UnparsableDocumentError, run

load_dotenv(Path(__file__).resolve().parent / "../../../.env")

QUEUE = "ingestion"  # must match server/src/services/ingestion-queue.service.ts

log = logging.getLogger("ingestion-worker")

# Failure reasons the admin sees in Recent uploads. Plain words, cause then next
# step (docs/design-system.md "Errors"); the technical error goes to the log.
UNREADABLE = "No text could be read from this PDF. Upload a copy with selectable text."
SYSTEM_ERROR = "Processing stopped on a system error, not a fault in the file. Upload it again."


@cache  # one client (and its connection pool) for the life of the worker
def documents():
    """Return the `knowledge_documents` collection in MONGODB_URI's database."""
    return MongoClient(os.environ["MONGODB_URI"]).get_default_database()["knowledge_documents"]


def download(key: str, dest: str) -> None:
    """Save the S3 object `key` to the local path `dest`."""
    s3 = boto3.client("s3", region_name=os.environ["AWS_REGION"])
    s3.download_file(os.environ["S3_BUCKET"], key, dest)


def labels(doc: dict) -> dict:
    """Return the document's labels as passage metadata: its five metadata fields and status.

    Chroma metadata holds only strings and numbers, so the date becomes
    YYYY-MM-DD. Must match `labels()` in
    server/src/services/knowledge-document.service.ts, which relabels passages
    after a correction (KB-01) and emits status active or withdrawn (KB-01 AC12–16).
    """
    metadata = doc["metadata"]
    date = metadata["effective_date"].strftime("%Y-%m-%d")
    # Passages are active when first indexed.
    return {**metadata, "effective_date": date, "status": "active"}


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
        {"_id": _id, "status": {"$in": ["queued", "processing"]}},
        {"$set": {"status": "processing", "startedAt": datetime.now(UTC)}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:
        log.warning("Document %s is already finished or missing; skipping.", document_id)
        return

    # 2. Download the original into a temporary folder that deletes itself, and
    # 3. run ingestion pipeline: parse → chunk → anonymise → index, with the
    # document's labels on every passage.
    try:
        with tempfile.TemporaryDirectory() as tmp:
            # Keep the original file name: the parser reports it as the doc name.
            path = str(Path(tmp) / Path(doc["fileName"]).name)
            download(doc["file"]["key"], path)
            summary = run(path, doc_id=document_id, labels=labels(doc))
    # 4. Record the outcome: failed here, complete below. The admin sees a plain
    # reason; re-raising tells BullMQ the job failed (not retried: attempts is 1).
    except Exception as error:
        log.exception("Ingesting document %s failed.", document_id)
        collection.update_one(
            {"_id": _id},
            {
                "$set": {
                    "status": "failed",
                    "error": (
                        UNREADABLE if isinstance(error, UnparsableDocumentError) else SYSTEM_ERROR
                    ),
                    "finishedAt": datetime.now(UTC),
                }
            },
        )
        raise

    collection.update_one(
        {"_id": _id},
        {
            "$set": {
                "status": "complete",
                "result": {
                    "chunksIndexed": summary["chunks_indexed"],
                    "tablesCaptured": summary["tables_captured"],
                    "imagesCaptured": summary["images_captured"],
                },
                "finishedAt": datetime.now(UTC),
            }
        },
    )


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

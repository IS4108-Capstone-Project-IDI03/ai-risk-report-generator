"""Ingestion → gateway notifications (IN-10).

When a document finishes or fails ingesting, the worker tells the gateway so a
knowledge admin sees it in the header dropdown without watching the uploads
screen. The worker has no session (it is a background process), so it posts to
the gateway's internal endpoint with the shared service key — the one
service-to-service path in the system (see
server/src/routes/internal-notification.routes.ts).

Posting must never break ingestion. The document's status is recorded first;
this is a best-effort courtesy on top, so every failure here is swallowed and
logged. A dropped notification is far less bad than a document wrongly left
un-failed.
"""

import logging
import os

import httpx

log = logging.getLogger("ingestion-worker")

# Matches NOTIFICATION_PURPOSES in server/src/models/notification.model.ts.
_PURPOSE = "ingestion_status"
_SERVICE = "ingestion-service"
# A few seconds is plenty for a loopback/intra-cluster call, and keeps a slow
# gateway from holding up the worker's move to the next job.
_TIMEOUT_SECONDS = 5


def _title(doc: dict) -> str:
    """A human name for the document: its title, or the file name if unset."""
    return doc.get("title") or doc.get("fileName") or "A document"


def _message(doc: dict, status: str, failed_stage: str | None) -> str:
    """The one-line message the admin reads. Sentence case, no emoji."""
    title = _title(doc)
    if status == "failed":
        where = f" during {failed_stage}" if failed_stage else ""
        return f'"{title}" failed to ingest{where}.'
    return f'"{title}" finished ingesting.'


def notify_ingestion(doc: dict, status: str, failed_stage: str | None = None) -> None:
    """Post an ingestion-status notification to the gateway. Never raises.

    Args:
        doc: the knowledge document, as read from MongoDB.
        status: the terminal status just recorded — "complete" or "failed".
        failed_stage: for a failure, the stage that was in progress when it
            broke (parsing/chunking/anonymising/indexing) — never the sentinel
            "failed" the stage log later carries.
    """
    key = os.environ.get("SERVICE_API_KEY")
    if not key:
        # Without a key the gateway would reject the post, so skip it rather
        # than make a doomed request on every ingestion.
        log.warning("SERVICE_API_KEY not set; skipping ingestion notification.")
        return

    gateway = os.environ.get("GATEWAY_URL", "http://localhost:4000")
    context = {"documentId": str(doc["_id"]), "status": status}
    if status == "failed" and failed_stage:
        context["stage"] = failed_stage

    body = {
        "purpose": _PURPOSE,
        "message": _message(doc, status, failed_stage),
        "targetRole": "knowledge_admin",
        "targetUserIds": ["all"],
        "context": context,
        "createdByService": _SERVICE,
    }
    # The admin-facing failure reason is already on the document; carry it as
    # the expandable detail.
    error = doc.get("error")
    if status == "failed" and error:
        body["details"] = error

    try:
        response = httpx.post(
            f"{gateway}/api/internal/notifications",
            json=body,
            headers={"x-service-key": key},
            timeout=_TIMEOUT_SECONDS,
        )
        if response.status_code // 100 != 2:
            log.warning(
                "Gateway rejected ingestion notification for %s: HTTP %s",
                context["documentId"],
                response.status_code,
            )
    except Exception:
        # Swallow: the status is recorded; a failed notification must not undo
        # it or re-raise into the worker's own failure handling.
        log.exception("Could not post ingestion notification for %s", context["documentId"])

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
    if status == "needs_review":
        return f'"{title}" needs review.'
    return f'"{title}" finished ingesting.'


# Must match MATCH_WORDS in client/src/features/knowledge-base/display.ts.
_MATCH_WORDS = {
    "newer_edition": "Possible newer edition of",
    "earlier_edition": "Possible earlier edition of",
    "possible_copy": "Possible copy of",
}


def review_reason(doc: dict, matched: dict | None) -> str | None:
    """Return why a finished document needs review, in the list's words, or None (IN-07).

    `matched` is the document its match points to (title and edition), if any. A
    withdrawn document is never asked to be reviewed, as in the knowledge base list.
    """
    if doc.get("withdrawn"):
        return None
    reasons = []
    if doc.get("match") and not matched:
        # Deleted since matching: still say why, without its name.
        reasons.append(_MATCH_WORDS[doc["match"]["kind"]].removesuffix(" of"))
    elif doc.get("match"):
        notes = [f"{matched['edition']} edition" if matched.get("edition") else None]
        notes.append("withdrawn" if matched.get("withdrawn") else None)
        notes = ", ".join(n for n in notes if n)
        detail = f" ({notes})" if notes else ""
        reasons.append(f"{_MATCH_WORDS[doc['match']['kind']]} {matched['title']}{detail}")
    if doc.get("unconfirmed"):
        reasons.append("Unconfirmed details")
    return " · ".join(reasons) or None


def notify_ingestion(
    doc: dict,
    status: str,
    failed_stage: str | None = None,
    review_reason: str | None = None,
) -> None:
    """Post an ingestion-status notification to the gateway. Never raises.

    Args:
        doc: the knowledge document, as read from MongoDB.
        status: the terminal status just recorded — "complete" or "failed".
        failed_stage: for a failure, the stage that was in progress when it
            broke (parsing/chunking/anonymising/indexing) — never the sentinel
            "failed" the stage log later carries.
        review_reason: for a finished document that waits for an admin (IN-07),
            why — it then says "needs review" instead of "finished ingesting", so
            the admin is told what to do, not just that something happened.
    """
    if status == "complete" and review_reason:
        status = "needs_review"
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
    # The retry number (bumped only when an admin presses Retry) rides in the
    # context so the gateway's dedupe key treats each retry as distinct — a
    # retry that fails again notifies afresh instead of being deduped away. The
    # original upload (retryCount 0 / absent) carries no attempt, so its
    # identity differs from retry #1's. Context values are strings.
    retry_count = doc.get("retryCount") or 0
    if retry_count:
        context["attempt"] = str(retry_count)

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
    if status == "needs_review":
        body["details"] = review_reason

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

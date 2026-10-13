"""Paid-call usage for one document's ingestion (EV-03); wire shape in docs/areas/database.md.

The worker starts a collection per document (`start`), the OCR providers and the
embedder `record` each call, and the worker posts the totals to the gateway
(`post`) when the document completes, fails or is cancelled. The gateway prices
and saves them; this service never writes `ai_calls`.

One collection for the whole process, behind a lock, not a ContextVar: table
and formula OCR run in a thread pool (chunker._run_ocr_jobs), and pool threads
do not inherit the context. The worker ingests one document at a time
(concurrency 1), so one collection is enough. With none started (the API
process, which serves /label) `record` does nothing.

Calls are summed per feature, billed service and model, so a document with
hundreds of OCR regions posts a handful of items, each with its `call_count`.
Calls that reported no usage are summed apart and marked unavailable, so a
partial total is never passed off as complete.
"""

import logging
import os
import threading
import time

import httpx

log = logging.getLogger("ingestion-worker")

_FIELDS = ("input_tokens", "output_tokens", "cache_read_tokens")
# Matches the notifier: a few seconds is plenty within the cluster, and keeps a
# slow gateway from holding up the next job.
_TIMEOUT_SECONDS = 5

_lock = threading.Lock()
_document_id: str | None = None
_totals: dict[tuple, dict] = {}


def start(document_id: str) -> None:
    """Start collecting for this document, dropping anything left from before."""
    global _document_id, _totals
    with _lock:
        _document_id, _totals = document_id, {}


def record(feature: str, billed_service: str, model: str, started: float, **amounts) -> None:
    """Add one call. No amount given means the provider sent none: unavailable, not 0."""
    duration_ms = int((time.perf_counter() - started) * 1000)
    reported = any(amounts.get(f) is not None for f in _FIELDS)
    with _lock:
        if _document_id is None:
            return
        item = _totals.setdefault(
            (feature, billed_service, model, reported),
            {
                "feature": feature,
                "billed_service": billed_service,
                "model": model,
                "document_id": _document_id,
                "call_count": 0,
                "duration_ms": 0,
                **{f: None for f in _FIELDS},
                "search_units": None,
                "audio_seconds": None,
                "usage_status": "recorded" if reported else "unavailable",
            },
        )
        item["call_count"] += 1
        item["duration_ms"] += duration_ms
        for field in _FIELDS:
            value = amounts.get(field)
            if value is not None:
                item[field] = (item[field] or 0) + value


def finish() -> list[dict]:
    """Stop collecting; return the totals, one item per feature, service and model."""
    global _document_id, _totals
    with _lock:
        items = list(_totals.values())
        _document_id, _totals = None, {}
    return items


def post(items: list[dict]) -> None:
    """Send the totals to the gateway, which prices and saves them. Never raises.

    Like the ingestion notification, this is best-effort: a lost post loses
    the cost record, never the document.
    """
    if not items:
        return
    key = os.environ.get("SERVICE_API_KEY")
    if not key:
        log.warning("SERVICE_API_KEY not set; skipping AI-call usage for %d items.", len(items))
        return
    gateway = os.environ.get("GATEWAY_URL", "http://localhost:4000")
    try:
        response = httpx.post(
            f"{gateway}/api/internal/ai-usage",
            json={"usage": items},
            headers={"x-service-key": key},
            timeout=_TIMEOUT_SECONDS,
        )
        if response.status_code // 100 != 2:
            log.warning("Gateway rejected AI-call usage: HTTP %s", response.status_code)
    except Exception:  # noqa: BLE001 - bookkeeping must never fail ingestion
        log.exception("Could not post AI-call usage for %s", items[0].get("document_id"))

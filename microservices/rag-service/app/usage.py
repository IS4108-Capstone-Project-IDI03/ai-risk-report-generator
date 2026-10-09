"""Paid-call usage for one draft request (EV-03); wire shape in the EV-03 spec.

Called by orchestrator.draft (start) and by llm.py / retriever.py (record). The gateway prices it.
"""

import time
from contextvars import ContextVar

# The current request's list. A contextvar, so no function signature has to carry it
# and each request gets its own list. None means nobody is collecting (e.g. /retrieve).
_items: ContextVar[list[dict] | None] = ContextVar("usage_items", default=None)


def start() -> list[dict]:
    """Start collecting for this request; return the list that fills as calls are recorded."""
    items: list[dict] = []
    _items.set(items)
    return items


def billed(response, field: str):
    """Return a Cohere response's billed_units.<field>, or None if the response has none."""
    return getattr(getattr(getattr(response, "meta", None), "billed_units", None), field, None)


def record(feature: str, billed_service: str, model: str, started: float, **amounts) -> None:
    """Add one usage item. No amount given means the provider sent none: 'unavailable', not 0."""
    items = _items.get()
    if items is None:
        return
    fields = ("input_tokens", "output_tokens", "cache_read_tokens", "search_units")
    items.append(
        {
            "feature": feature,
            "billed_service": billed_service,
            "model": model,
            "duration_ms": int((time.perf_counter() - started) * 1000),
            **{f: amounts.get(f) for f in fields},
            "audio_seconds": None,
            "usage_status": "recorded"
            if any(amounts.get(f) is not None for f in fields)
            else "unavailable",
        }
    )

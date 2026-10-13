"""Waiting out OCR provider rate limits, shared by the API providers (IN-12).

A rate limit (429), an overload (503, 529) or a dropped connection usually
clears within a minute, so a region waits instead of being left unread. All OCR
threads share one pause: the first to be told to slow down holds the others back
too, rather than letting them spend their tries on the same limit.

The wait is the provider's hint when it gives one (Anthropic's `retry-after`
header, sometimes Gemini's `retryDelay`), else exponential backoff with jitter;
either way clamped to MIN..MAX_WAIT_SECONDS. A region still refused after
MAX_WAITS waits raises OcrUnavailableError, which fails the document: indexing
it without its tables would show it Complete with numbers missing from search.
"""

import logging
import random
import re
import threading
import time
from collections.abc import Callable
from typing import TypeVar

from app.pipeline.errors import OcrUnavailableError

log = logging.getLogger(__name__)

MAX_WAITS = 8
BACKOFF_SECONDS = 5.0  # first wait without a hint; doubles each time, up to the cap
BACKOFF_CAP_SECONDS = 60.0
MIN_WAIT_SECONDS = 1.0
MAX_WAIT_SECONDS = 120.0

T = TypeVar("T")

_lock = threading.Lock()
_paused_until = 0.0  # time.monotonic() before which no thread sends a request


def is_transient_status(status: int | None) -> bool:
    """Rate limits and server errors clear on their own; other statuses do not."""
    return status is not None and (status == 429 or status >= 500)


def parse_seconds(value) -> float | None:
    """Seconds from a hint such as "37", "37s" or "1.5s"; None if unreadable.

    An HTTP-date `retry-after` is not parsed: backoff covers it.
    """
    match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*s?\s*", str(value)) if value is not None else None
    return float(match.group(1)) if match else None


def wait_seconds(wait_number: int, hint: float | None) -> float:
    """The provider's hint if any, else backoff with jitter; always within the clamp."""
    if hint is None:
        backoff = min(BACKOFF_SECONDS * 2 ** (wait_number - 1), BACKOFF_CAP_SECONDS)
        hint = backoff * random.uniform(0.5, 1.0)
    return min(max(hint, MIN_WAIT_SECONDS), MAX_WAIT_SECONDS)


def _wait_for_pause() -> None:
    while True:
        with _lock:
            remaining = _paused_until - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(remaining)


def _pause(seconds: float) -> None:
    global _paused_until
    with _lock:
        _paused_until = max(_paused_until, time.monotonic() + seconds)


def call_with_waits(
    ask: Callable[[], T],
    is_transient: Callable[[Exception], bool],
    hint: Callable[[Exception], float | None],
    provider: str,
    task: str,
) -> T:
    """Run `ask`, waiting out transient errors; other errors are re-raised as they are.

    Raises OcrUnavailableError once MAX_WAITS waits have not been enough.
    """
    wait_number = 0
    while True:
        _wait_for_pause()
        try:
            return ask()
        except Exception as error:  # noqa: BLE001 - re-raised unless transient
            if not is_transient(error):
                raise
            wait_number += 1
            if wait_number > MAX_WAITS:
                raise OcrUnavailableError(
                    f"{provider} OCR kept refusing a {task} region after {MAX_WAITS} waits: {error}"
                ) from error
            seconds = wait_seconds(wait_number, hint(error))
            log.warning(
                "%s OCR busy on a %s region (%s); all regions wait %.0f s (%s/%s).",
                provider,
                task,
                error,
                seconds,
                wait_number,
                MAX_WAITS,
            )
            _pause(seconds)

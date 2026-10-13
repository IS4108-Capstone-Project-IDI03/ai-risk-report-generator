"""Waiting out OCR provider rate limits (IN-12), with the waits shortened to nothing."""

import time

import pytest

from app.pipeline.chunking_helper import rate_limit
from app.pipeline.errors import OcrUnavailableError

REAL_PAUSE = rate_limit._pause  # kept before the fixture below replaces it


class _Busy(Exception):
    def __init__(self, hint=None):
        super().__init__("429")
        self.hint = hint


def _flaky(*replies):
    """A request that raises or returns each reply in turn, counting calls."""
    calls = []

    def ask():
        calls.append(1)
        reply = replies[len(calls) - 1]
        if isinstance(reply, Exception):
            raise reply
        return reply

    return ask, calls


def _call(ask):
    return rate_limit.call_with_waits(
        ask, lambda e: isinstance(e, _Busy), lambda e: e.hint, "Test", "table"
    )


@pytest.fixture(autouse=True)
def no_waits(monkeypatch):
    monkeypatch.setattr(rate_limit, "_paused_until", 0.0)
    pauses = []
    monkeypatch.setattr(rate_limit, "_pause", pauses.append)
    return pauses


@pytest.mark.parametrize(
    "value,seconds", [("37", 37.0), ("37s", 37.0), ("1.5s", 1.5), (None, None), ("soon", None)]
)
def test_hints_are_read_as_seconds(value, seconds):
    # An HTTP-date retry-after is left to backoff rather than parsed.
    assert rate_limit.parse_seconds(value) == seconds


def test_a_hint_is_used_but_kept_within_the_clamp():
    assert rate_limit.wait_seconds(1, 37.0) == 37.0
    assert rate_limit.wait_seconds(1, 0.0) == rate_limit.MIN_WAIT_SECONDS
    assert rate_limit.wait_seconds(1, 3600.0) == rate_limit.MAX_WAIT_SECONDS


def test_without_a_hint_the_backoff_doubles_with_jitter_up_to_the_cap():
    first = rate_limit.wait_seconds(1, None)
    assert rate_limit.BACKOFF_SECONDS / 2 <= first <= rate_limit.BACKOFF_SECONDS
    assert rate_limit.wait_seconds(20, None) <= rate_limit.BACKOFF_CAP_SECONDS


def test_a_busy_provider_is_waited_out_using_its_hint(no_waits):
    ask, calls = _flaky(_Busy(hint=37.0), _Busy(), "read")

    assert _call(ask) == "read"
    assert len(calls) == 3
    assert no_waits[0] == 37.0


def test_a_provider_still_busy_after_every_wait_fails_the_document():
    ask, calls = _flaky(*[_Busy()] * (rate_limit.MAX_WAITS + 1))

    with pytest.raises(OcrUnavailableError, match="table region"):
        _call(ask)
    assert len(calls) == rate_limit.MAX_WAITS + 1


def test_other_errors_are_raised_at_once():
    ask, calls = _flaky(ValueError("bad image"))

    with pytest.raises(ValueError):
        _call(ask)
    assert len(calls) == 1


def test_a_pause_holds_back_every_later_request_and_is_never_shortened():
    REAL_PAUSE(0.2)
    until = rate_limit._paused_until
    REAL_PAUSE(0.01)  # another thread's shorter wait does not cut the pause short
    assert rate_limit._paused_until == until

    start = time.monotonic()
    rate_limit._wait_for_pause()
    assert time.monotonic() - start >= 0.15

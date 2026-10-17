"""Claude as the table/formula OCR provider (OCR_PROVIDER=anthropic).

Driven through the public `ocr_model.recognise`. Only the network boundary,
`anthropic_ocr._client`, is replaced: the fake answers `messages.parse` the way
the SDK does, with the answer already validated into `parsed_output`.
"""

from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.pipeline.chunking_helper import anthropic_ocr, ocr_model, rate_limit
from app.pipeline.chunking_helper.ocr_prompts import FormulaReading, TableBlock, TableReading
from app.pipeline.errors import OcrUnavailableError

PNG = b"\x89PNG\r\n\x1a\nfake-pixels"


class _FakeClaude:
    """Stand-in for `anthropic.Anthropic`: hands out queued replies, records requests."""

    def __init__(self):
        self.replies: list = []
        self.requests: list[dict] = []
        self.messages = self

    def parse(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def _status_error(status: int, headers=None):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, headers=headers or {})
    return anthropic.APIStatusError(f"HTTP {status}", response=response, body=None)


def _answer(parsed, stop_reason="end_turn"):
    return SimpleNamespace(parsed_output=parsed, stop_reason=stop_reason)


@pytest.fixture
def claude(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "anthropic")
    monkeypatch.delenv("OCR_MODEL", raising=False)
    fake = _FakeClaude()
    monkeypatch.setattr(anthropic_ocr, "_client", lambda: fake)
    # Waits are recorded, not slept.
    monkeypatch.setattr(rate_limit, "_paused_until", 0.0)
    fake.pauses = []
    monkeypatch.setattr(rate_limit, "_pause", fake.pauses.append)
    return fake


def test_table_crop_comes_back_as_records(claude):
    claude.replies.append(
        _answer(
            TableReading(
                tables=[
                    TableBlock(
                        title="",
                        header_rows=1,
                        header_cols=0,
                        rows=[["Agent", "Qty"], ["FM-200", "2"]],
                    )
                ]
            )
        )
    )

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"


def test_a_refused_region_is_left_unread(claude):
    claude.replies.append(_answer(None, stop_reason="refusal"))

    assert ocr_model.recognise(PNG, "table") is None


def test_a_rejected_request_leaves_the_region_unread(claude):
    claude.replies.append(_status_error(400))

    assert ocr_model.recognise(PNG, "formula") is None
    assert claude.pauses == []


def test_rate_limits_are_waited_out_for_as_long_as_retry_after_says(claude):
    claude.replies += [
        _status_error(429, {"retry-after": "37"}),
        _status_error(529),  # overloaded
        anthropic.APIConnectionError(request=httpx.Request("POST", "https://x")),
        _answer(FormulaReading(latex="x")),
    ]

    assert ocr_model.recognise(PNG, "formula") == "x"
    assert len(claude.pauses) == 3
    assert claude.pauses[0] == 37.0


def test_a_region_still_rate_limited_after_every_wait_fails_the_document(claude):
    claude.replies += [_status_error(429)] * (rate_limit.MAX_WAITS + 1)

    with pytest.raises(OcrUnavailableError):
        ocr_model.recognise(PNG, "table")


def test_a_rejected_api_key_fails_loudly_instead_of_dropping_every_table(claude):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    claude.replies.append(
        anthropic.AuthenticationError(
            "invalid x-api-key", response=httpx.Response(401, request=request), body=None
        )
    )

    with pytest.raises(anthropic.AuthenticationError):
        ocr_model.recognise(PNG, "table")


def test_formula_crop_returns_the_latex_unchanged(claude):
    claude.replies.append(_answer(FormulaReading(latex=r"W = \frac{V}{S}")))

    assert ocr_model.recognise(PNG, "formula") == r"W = \frac{V}{S}"


def test_haiku_reads_crops_unless_ocr_model_names_another(claude):
    claude.replies.append(_answer(FormulaReading(latex="x")))

    ocr_model.recognise(PNG, "formula")

    assert claude.requests[0]["model"] == "claude-haiku-5-5"


def test_claude_reads_crops_when_no_provider_is_set(claude, monkeypatch):
    # The GLM-vs-API comparison (eval/ocr/results/2026-10-10.md) settled the default.
    monkeypatch.delenv("OCR_PROVIDER")
    claude.replies.append(_answer(FormulaReading(latex="x")))

    assert ocr_model.recognise(PNG, "formula") == "x"

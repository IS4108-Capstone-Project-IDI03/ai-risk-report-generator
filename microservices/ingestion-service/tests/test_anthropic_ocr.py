"""Claude as the table/formula OCR provider (OCR_PROVIDER=anthropic).

Driven through the public `ocr_model.recognise`. Only the network boundary,
`anthropic_ocr._client`, is replaced: the fake answers `messages.parse` the way
the SDK does, with the answer already validated into `parsed_output`.
"""

from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.pipeline.chunking_helper import anthropic_ocr, ocr_model
from app.pipeline.chunking_helper.ocr_prompts import FormulaReading, TableReading

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


def _answer(parsed, stop_reason="end_turn"):
    return SimpleNamespace(parsed_output=parsed, stop_reason=stop_reason)


@pytest.fixture
def claude(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "anthropic")
    monkeypatch.delenv("OCR_MODEL", raising=False)
    fake = _FakeClaude()
    monkeypatch.setattr(anthropic_ocr, "_client", lambda: fake)
    return fake


def test_table_crop_comes_back_as_records(claude):
    claude.replies.append(
        _answer(TableReading(rows=[["Agent", "Qty"], ["FM-200", "2"]], header="row"))
    )

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"


def test_a_refused_region_is_left_unread(claude):
    claude.replies.append(_answer(None, stop_reason="refusal"))

    assert ocr_model.recognise(PNG, "table") is None


def test_an_api_failure_after_the_sdk_retries_leaves_the_region_unread(claude):
    claude.replies.append(anthropic.APIConnectionError(request=httpx.Request("POST", "https://x")))

    assert ocr_model.recognise(PNG, "formula") is None


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

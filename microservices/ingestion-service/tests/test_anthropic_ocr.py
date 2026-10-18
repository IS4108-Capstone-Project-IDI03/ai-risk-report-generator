"""Claude as the table/formula OCR provider (OCR_PROVIDER=anthropic).

Driven through the public `ocr_model.recognise`. Only the network boundary,
`anthropic_ocr._client`, is replaced: the fake answers `messages.create` the way
the API does, with the answer as JSON text and a `stop_reason`.
"""

import logging
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.pipeline.chunking_helper import anthropic_ocr, ocr_model, rate_limit
from app.pipeline.chunking_helper.ocr_prompts import (
    PICTURE_PROMPT,
    FormulaReading,
    PictureReading,
    TableBlock,
    TableReading,
)
from app.pipeline.errors import OcrUnavailableError

PNG = b"\x89PNG\r\n\x1a\nfake-pixels"


class _FakeClaude:
    """Stand-in for `anthropic.Anthropic`: hands out queued replies, records requests."""

    def __init__(self):
        self.replies: list = []
        self.requests: list[dict] = []
        self.messages = self

    def create(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply


def _status_error(status: int, headers=None):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status, request=request, headers=headers or {})
    return anthropic.APIStatusError(f"HTTP {status}", response=response, body=None)


def _text_answer(text: str, stop_reason="end_turn"):
    content = [SimpleNamespace(type="text", text=text)] if text else []
    return SimpleNamespace(content=content, stop_reason=stop_reason)


def _answer(reading, stop_reason="end_turn"):
    return _text_answer(reading.model_dump_json() if reading else "", stop_reason)


def _table(rows):
    return TableReading(tables=[TableBlock(title="", header_rows=1, header_cols=0, rows=rows)])


# What production got for the page 98 FM-200 agent table: JSON stopped partway.
CUT_OFF = '{"tables":[{"title":"","header_rows":1,"header_cols":1,"rows":[["E2-N'


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
    claude.replies.append(_answer(_table([["Agent", "Qty"], ["FM-200", "2"]])))

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"


def test_the_answer_is_asked_for_as_json_matching_the_tasks_schema(claude):
    claude.replies.append(_answer(FormulaReading(latex="x")))

    ocr_model.recognise(PNG, "formula")

    output_config = claude.requests[0]["output_config"]
    assert output_config["effort"] == "low"
    assert output_config["format"]["type"] == "json_schema"
    assert output_config["format"]["schema"]["required"] == ["latex"]


def test_a_region_refused_twice_is_left_unread(claude, caplog):
    claude.replies += [_answer(None, stop_reason="refusal")] * 2

    with caplog.at_level(logging.WARNING):
        assert ocr_model.recognise(PNG, "table") is None

    assert len(claude.requests) == 2
    assert "stop_reason=refusal" in caplog.text
    assert "table region left unread after 2 attempts" in caplog.text


def test_an_answer_stopped_partway_through_is_asked_again(claude, caplog):
    claude.replies += [
        _text_answer(CUT_OFF, stop_reason="refusal"),
        _answer(_table([["Nozzle", "Pressure"], ["E2-N1", "6.887 bar"]])),
    ]

    with caplog.at_level(logging.WARNING):
        assert ocr_model.recognise(PNG, "table") == "Nozzle: E2-N1; Pressure: 6.887 bar"

    assert f"stop_reason=refusal, {len(CUT_OFF)} characters" in caplog.text
    assert "read the table region on attempt 2" in caplog.text


def test_invalid_json_twice_leaves_the_region_unread_instead_of_failing_the_document(
    claude, caplog
):
    claude.replies += [_text_answer(CUT_OFF)] * 2

    with caplog.at_level(logging.WARNING):
        assert ocr_model.recognise(PNG, "table") is None

    assert "invalid TableReading" in caplog.text


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


def test_picture_crop_comes_back_as_a_generated_description(claude):
    claude.replies.append(
        _answer(
            PictureReading(
                kind="photograph",
                description="A sprinkler head with paint over its glass bulb.",
                visible_text="K-80",
            )
        )
    )

    assert ocr_model.recognise(PNG, "picture") == (
        "Image description (generated, photograph): "
        "A sprinkler head with paint over its glass bulb.\n"
        "Text in image: K-80"
    )


def test_a_picture_without_printed_text_has_no_text_line(claude):
    claude.replies.append(
        _answer(PictureReading(kind="photograph", description="A clear exit.", visible_text=""))
    )

    assert ocr_model.recognise(PNG, "picture") == (
        "Image description (generated, photograph): A clear exit."
    )


def test_a_picture_is_asked_about_with_where_it_sits(claude):
    claude.replies.append(_answer(PictureReading(kind="diagram", description="d", visible_text="")))

    ocr_model.recognise(
        PNG, "picture", context="Section: Fire Protection > Sprinklers\nCaption: Figure 3 Riser"
    )

    image, prompt, context = claude.requests[0]["messages"][0]["content"]
    assert image["type"] == "image"
    assert prompt["text"] == PICTURE_PROMPT
    assert context["text"] == "Section: Fire Protection > Sprinklers\nCaption: Figure 3 Riser"


def test_an_unknown_task_is_a_programming_error(claude):
    with pytest.raises(ValueError, match="unknown OCR task"):
        ocr_model.recognise(PNG, "barcode")

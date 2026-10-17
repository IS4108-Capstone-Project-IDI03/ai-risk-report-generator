"""Gemini as the table/formula OCR provider (OCR_PROVIDER=gemini).

Driven through the public `ocr_model.recognise`. Only the network boundary,
`gemini_ocr._client`, is replaced: the fake returns canned JSON answers (or
raises) the way `genai.Client().interactions.create` would.
"""

import json
from types import SimpleNamespace

import pytest

from app.pipeline.chunking_helper import gemini_ocr, ocr_model, rate_limit
from app.pipeline.errors import OcrUnavailableError

PNG = b"\x89PNG\r\n\x1a\nfake-pixels"


class _FakeGemini:
    """Stand-in for `genai.Client`: hands out queued replies, records requests."""

    def __init__(self):
        self.replies: list = []
        self.requests: list[dict] = []
        self.interactions = self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def create(self, **kwargs):
        self.requests.append(kwargs)
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return SimpleNamespace(status="completed", output_text=reply)


class _HttpError(Exception):
    """An HTTP failure as the interactions SDK reports it (`status_code`)."""

    def __init__(self, status_code: int, body=None):
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code
        self.body = body


TABLE_ANSWER = json.dumps(
    {
        "tables": [
            {
                "title": "",
                "header_rows": 1,
                "header_cols": 0,
                "rows": [["Agent", "Qty"], ["FM-200", "2"]],
            }
        ]
    }
)


@pytest.fixture
def gemini(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "gemini")
    fake = _FakeGemini()
    monkeypatch.setattr(gemini_ocr, "_client", lambda: fake)
    # Waits are recorded, not slept.
    monkeypatch.setattr(rate_limit, "_paused_until", 0.0)
    fake.pauses = []
    monkeypatch.setattr(rate_limit, "_pause", fake.pauses.append)
    return fake


def test_table_crop_comes_back_as_records(gemini):
    gemini.replies.append(TABLE_ANSWER)

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"


def test_headings_on_both_axes_label_each_record(gemini):
    # Gemini says one heading row and one heading column: each value is labelled
    # by its column heading and its row heading.
    gemini.replies.append(
        json.dumps(
            {
                "tables": [
                    {
                        "title": "Table 4 Design concentration",
                        "header_rows": 1,
                        "header_cols": 1,
                        "rows": [
                            ["Agent", "FM-200", "Novec 1230"],
                            ["Design concentration", "7.0%", "4.5%"],
                        ],
                    }
                ]
            }
        )
    )

    assert ocr_model.recognise(PNG, "table") == (
        "### Table 4 Design concentration\nDesign concentration | FM-200: 7.0%; Novec 1230: 4.5%"
    )


def test_formula_crop_returns_the_latex_unchanged(gemini):
    latex = r"W = \frac{V}{S} \left( \frac{C}{100 - C} \right)"
    gemini.replies.append(json.dumps({"latex": latex}))

    assert ocr_model.recognise(PNG, "formula") == (
        r"W = \frac{V}{S} \left( \frac{C}{100 - C} \right)"
    )


def test_rate_limits_are_retried_until_an_answer_comes_back(gemini):
    retry_info = {
        "error": {
            "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "37s"}]
        }
    }
    gemini.replies += [_HttpError(429, retry_info), _HttpError(429), TABLE_ANSWER]

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"
    assert len(gemini.pauses) == 2
    assert gemini.pauses[0] == 37.0  # Gemini's retryDelay, when it sends one


def test_a_region_still_overloaded_after_every_wait_fails_the_document(gemini):
    gemini.replies += [_HttpError(503)] * (rate_limit.MAX_WAITS + 1)

    with pytest.raises(OcrUnavailableError):
        ocr_model.recognise(PNG, "table")


def test_a_rejected_request_leaves_the_region_unread(gemini):
    gemini.replies.append(_HttpError(400))

    assert ocr_model.recognise(PNG, "table") is None
    assert gemini.pauses == []


def test_an_answer_without_text_leaves_the_region_unread(gemini, monkeypatch):
    # A safety block or cut-off answer comes back with no text (as in S5's interpreter).
    blocked = SimpleNamespace(status="incomplete", output_text=None)
    monkeypatch.setattr(gemini, "create", lambda **kwargs: blocked)

    assert ocr_model.recognise(PNG, "formula") is None


def test_an_unknown_provider_is_named_in_the_error(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "textract")

    with pytest.raises(ValueError, match=r"'textract'.*gemini.*glm"):
        ocr_model.recognise(PNG, "table")


def test_a_rejected_api_key_fails_loudly_instead_of_dropping_every_table(gemini):
    gemini.replies.append(_HttpError(401))

    with pytest.raises(_HttpError):
        ocr_model.recognise(PNG, "table")

"""Gemini as the table/formula OCR provider (OCR_PROVIDER=gemini).

Driven through the public `ocr_model.recognise`. Only the network boundary,
`gemini_ocr._client`, is replaced: the fake returns canned JSON answers (or
raises) the way `genai.Client().interactions.create` would.
"""

import json
from types import SimpleNamespace

import pytest

from app.pipeline.chunking_helper import gemini_ocr, ocr_model

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

    def __init__(self, status_code: int):
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


TABLE_ANSWER = json.dumps({"rows": [["Agent", "Qty"], ["FM-200", "2"]], "header": "row"})


@pytest.fixture
def gemini(monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "gemini")
    monkeypatch.setattr(gemini_ocr, "BACKOFF_SECONDS", 0)
    fake = _FakeGemini()
    monkeypatch.setattr(gemini_ocr, "_client", lambda: fake)
    return fake


def test_table_crop_comes_back_as_records(gemini):
    gemini.replies.append(TABLE_ANSWER)

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"


def test_column_headings_named_by_gemini_label_each_record(gemini):
    # The length heuristic alone reads this as headerless; Gemini's answer says
    # the first column holds the headings.
    gemini.replies.append(
        json.dumps(
            {
                "rows": [
                    ["Agent", "FM-200", "Novec 1230"],
                    ["Design concentration", "7.0%", "4.5%"],
                ],
                "header": "column",
            }
        )
    )

    assert ocr_model.recognise(PNG, "table") == (
        "Agent: FM-200; Design concentration: 7.0%\nAgent: Novec 1230; Design concentration: 4.5%"
    )


def test_formula_crop_returns_the_latex_unchanged(gemini):
    latex = r"W = \frac{V}{S} \left( \frac{C}{100 - C} \right)"
    gemini.replies.append(json.dumps({"latex": latex}))

    assert ocr_model.recognise(PNG, "formula") == (
        r"W = \frac{V}{S} \left( \frac{C}{100 - C} \right)"
    )


def test_rate_limits_are_retried_until_an_answer_comes_back(gemini):
    gemini.replies += [_HttpError(429), _HttpError(429), TABLE_ANSWER]

    assert ocr_model.recognise(PNG, "table") == "Agent: FM-200; Qty: 2"


def test_a_region_gives_up_after_three_server_errors(gemini):
    gemini.replies += [_HttpError(503), _HttpError(503), _HttpError(503)]

    assert ocr_model.recognise(PNG, "table") is None


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

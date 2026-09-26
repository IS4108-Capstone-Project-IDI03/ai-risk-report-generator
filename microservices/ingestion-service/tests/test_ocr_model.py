"""Cached GLM-OCR client (IN-03, Phase 2).

`ocr_model` owns one `OCRClient` for the whole process, shared by the table and
formula extractors. No real OCR service is contacted: `OCRClient` is swapped for
a recorder so the request payload, the caching guarantees and the failure
handling are all exercised hermetically.
"""

import base64
import threading

import pytest

from app.pipeline.chunking_helper import ocr_model

# Fake table image
PNG = b"\x89PNG\r\n\x1a\nfake-pixels"


class _FakeClient:
    """Stand-in for OCRClient that records payloads and returns a canned reply."""

    instances: list["_FakeClient"] = []

    def __init__(self, config=None):
        self.config = config
        self.payloads: list[dict] = []
        self.stopped = False
        self.reply = ({"choices": [{"message": {"content": "| a | b |"}}]}, 200)
        _FakeClient.instances.append(self)

    def process(self, payload):
        self.payloads.append(payload)
        return self.reply

    def stop(self):
        self.stopped = True


@pytest.fixture(autouse=True)
def fake_client(monkeypatch):
    """Swap in the recorder and guarantee a cold cache around every test."""
    _FakeClient.instances = []
    ocr_model.close_ocr_client()
    monkeypatch.setattr(ocr_model, "OCRClient", _FakeClient)
    yield _FakeClient
    ocr_model.close_ocr_client()


# --- caching ------------------------------------------------------------------


def test_client_is_built_once_across_many_calls(fake_client):
    for _ in range(5):
        ocr_model.recognise(PNG, "table")

    # The whole point of the cache: one client, not one per region.
    assert len(fake_client.instances) == 1
    assert len(fake_client.instances[0].payloads) == 5


def test_ocr_client_returns_the_same_instance(fake_client):
    assert ocr_model.ocr_client() is ocr_model.ocr_client()
    assert len(fake_client.instances) == 1


def test_table_and_formula_share_one_client(fake_client):
    ocr_model.recognise(PNG, "table")
    ocr_model.recognise(PNG, "formula")

    # Two tasks, one model: a second client would mean a second connection pool.
    assert len(fake_client.instances) == 1


def test_concurrent_first_use_builds_only_one_client(fake_client):
    """lru_cache guards its dict but not the factory; the lock must single-flight."""
    barrier = threading.Barrier(8)

    def worker():
        barrier.wait()
        ocr_model.ocr_client()

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(fake_client.instances) == 1


def test_close_stops_the_session_and_clears_the_cache(fake_client):
    first = ocr_model.ocr_client()
    ocr_model.close_ocr_client()

    assert first.stopped is True

    second = ocr_model.ocr_client()
    assert second is not first
    assert len(fake_client.instances) == 2


def test_close_without_a_built_client_does_not_build_one(fake_client):
    ocr_model.close_ocr_client()
    # Must not construct a client just to close it.
    assert fake_client.instances == []


def test_close_is_idempotent(fake_client):
    ocr_model.ocr_client()
    ocr_model.close_ocr_client()
    ocr_model.close_ocr_client()
    assert len(fake_client.instances) == 1


# --- request payload ----------------------------------------------------------


def _sent(fake_client) -> dict:
    return fake_client.instances[0].payloads[0]


def test_task_selects_the_models_own_prompt(fake_client):
    ocr_model.recognise(PNG, "table")
    content = _sent(fake_client)["messages"][0]["content"]
    assert content[0]["text"] == "Table Recognition:"


def test_formula_task_uses_the_formula_prompt(fake_client):
    ocr_model.recognise(PNG, "formula")
    content = _sent(fake_client)["messages"][0]["content"]
    assert content[0]["text"] == "Formula Recognition:"


def test_image_is_sent_as_a_png_data_uri(fake_client):
    ocr_model.recognise(PNG, "table")
    content = _sent(fake_client)["messages"][0]["content"]
    url = content[1]["image_url"]["url"]

    assert url.startswith("data:image/png;base64,")
    # Round-trips to the exact bytes we handed in.
    assert base64.b64decode(url.split(",", 1)[1]) == PNG


def test_decoding_is_deterministic(fake_client):
    ocr_model.recognise(PNG, "table")
    payload = _sent(fake_client)
    assert payload["temperature"] < 0.5
    assert "repetition_penalty" in payload


def test_unknown_task_is_a_programming_error(fake_client):
    with pytest.raises(ValueError, match="unknown OCR task"):
        ocr_model.recognise(PNG, "barcode")


# --- response handling --------------------------------------------------------


def test_returns_recognised_text(fake_client):
    assert ocr_model.recognise(PNG, "table") == "| a | b |"


def test_non_200_status_returns_none(fake_client):
    client = ocr_model.ocr_client()
    client.reply = ({"error": "API request failed", "status_code": 503}, 503)
    # One bad region must not fail the whole document.
    assert ocr_model.recognise(PNG, "table") is None


def test_error_payload_with_200_returns_none(fake_client):
    client = ocr_model.ocr_client()
    client.reply = ({"error": "Ollama API error: model not found"}, 200)
    assert ocr_model.recognise(PNG, "table") is None


def test_empty_choices_returns_none(fake_client):
    client = ocr_model.ocr_client()
    client.reply = ({"choices": []}, 200)
    assert ocr_model.recognise(PNG, "table") is None


def test_blank_content_returns_none(fake_client):
    client = ocr_model.ocr_client()
    client.reply = ({"choices": [{"message": {"content": "   \n "}}]}, 200)
    assert ocr_model.recognise(PNG, "table") is None


def test_content_is_stripped(fake_client):
    client = ocr_model.ocr_client()
    client.reply = ({"choices": [{"message": {"content": "  x^2  \n"}}]}, 200)
    assert ocr_model.recognise(PNG, "formula") == "x^2"


# --- configuration ------------------------------------------------------------


def test_api_mode_is_overridable_by_env(monkeypatch):
    """glmocr maps host/port/model but not api_mode; we add that."""
    monkeypatch.setenv("GLMOCR_OCR_API_MODE", "openai")
    assert ocr_model._ocr_api_config().api_mode == "openai"

    monkeypatch.setenv("GLMOCR_OCR_API_MODE", "ollama_generate")
    assert ocr_model._ocr_api_config().api_mode == "ollama_generate"


def test_api_path_is_overridable_by_env(monkeypatch):
    monkeypatch.setenv("GLMOCR_OCR_API_PATH", "/v1/chat/completions")
    assert ocr_model._ocr_api_config().api_path == "/v1/chat/completions"


def test_host_and_port_come_from_env(monkeypatch):
    """Compose points the service at `ollama` rather than localhost this way."""
    monkeypatch.setenv("GLMOCR_OCR_API_HOST", "ollama")
    monkeypatch.setenv("GLMOCR_OCR_API_PORT", "11434")

    config = ocr_model._ocr_api_config()
    assert config.api_host == "ollama"
    assert config.api_port == 11434


def test_model_name_comes_from_env(monkeypatch):
    monkeypatch.setenv("GLMOCR_OCR_MODEL", "glm-ocr:q4")
    assert ocr_model._ocr_api_config().model == "glm-ocr:q4"


def test_blank_env_override_is_ignored(monkeypatch):
    """An empty Compose variable must not blank out the YAML value."""
    monkeypatch.setenv("GLMOCR_OCR_API_MODE", "")
    assert ocr_model._ocr_api_config().api_mode


# --- _looks_truncated ---------------------------------------------------------


def test_complete_table_is_not_truncated():
    text = "| A | B |\n|---|---|\n| 1 | 2 |"
    assert ocr_model._looks_truncated(text, "table") is False


def test_table_missing_closing_pipe_is_truncated():
    # Last row ends mid-cell — generation was cut off.
    text = "| A | B |\n|---|---|\n| 1 | 2"
    assert ocr_model._looks_truncated(text, "table") is True


def test_table_with_only_header_row_is_not_truncated():
    # Single-row table still ends with |.
    text = "| A | B |"
    assert ocr_model._looks_truncated(text, "table") is False


def test_formula_balanced_braces_not_truncated():
    assert ocr_model._looks_truncated(r"$E = mc^2$", "formula") is False


def test_formula_unbalanced_braces_truncated():
    assert ocr_model._looks_truncated(r"\frac{a}{b} + \sqrt{c", "formula") is True


def test_formula_odd_dollar_count_truncated():
    assert ocr_model._looks_truncated(r"$E = mc^2", "formula") is True


def test_unknown_task_never_truncated():
    # Unknown tasks pass through without retry.
    assert ocr_model._looks_truncated("anything", "text") is False


def test_empty_output_not_truncated():
    assert ocr_model._looks_truncated("", "table") is False


# --- adaptive retry -----------------------------------------------------------


def test_complete_table_needs_no_retry(fake_client):
    """A complete table is returned on the first call with no retry."""
    client = ocr_model.ocr_client()
    client.reply = ({"choices": [{"message": {"content": "| A | B |\n| 1 | 2 |"}}]}, 200)

    result = ocr_model.recognise(PNG, "table")

    assert result == "| A | B |\n| 1 | 2 |"
    assert len(client.payloads) == 1


def test_truncated_table_retries_with_higher_token_budget(fake_client):
    """A truncated table triggers a retry with a larger max_tokens."""
    client = ocr_model.ocr_client()
    replies = iter([
        ({"choices": [{"message": {"content": "| A | B |\n| 1 | 2"}}]}, 200),   # truncated
        ({"choices": [{"message": {"content": "| A | B |\n| 1 | 2 |"}}]}, 200), # complete
    ])
    client.reply = None

    original_process = client.process

    def patched_process(payload):
        client.payloads.append(payload)
        return next(replies)

    client.process = patched_process

    result = ocr_model.recognise(PNG, "table")

    assert result == "| A | B |\n| 1 | 2 |"
    assert len(client.payloads) == 2
    # Second call must use a higher token budget.
    assert client.payloads[1]["max_tokens"] > client.payloads[0]["max_tokens"]


def test_still_truncated_after_all_retries_returns_best_effort(fake_client):
    """If all retries produce truncated output, return the last result rather
    than None — partial content is better than discarding the region."""
    client = ocr_model.ocr_client()
    partial = "| A | B |\n| 1 | 2"
    call_count = 0

    def always_truncated(payload):
        nonlocal call_count
        call_count += 1
        client.payloads.append(payload)
        return ({"choices": [{"message": {"content": partial}}]}, 200)

    client.process = always_truncated

    result = ocr_model.recognise(PNG, "table")

    # Must not return None — a partial table is still useful for retrieval.
    assert result == partial
    # Must have tried more than once.
    assert call_count > 1


def test_token_budgets_are_ordered_and_bounded():
    budgets = ocr_model._token_budgets()
    assert budgets == sorted(budgets)
    assert budgets[0] == ocr_model.MAX_TOKENS
    assert budgets[-1] <= ocr_model.MAX_TOKENS_RETRY
    assert len(budgets) == ocr_model._ADAPTIVE_RETRIES + 1

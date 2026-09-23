"""One cached GLM-OCR client, shared by the table and formula extractors.

`glmocr.ocr_client.OCRClient` instead of `glmocr.GlmOcr` which 
POST an image plus a task prompt to the OCR service and return text. It
imports nothing heavier than `requests`.

Caching
-------
The client is built once per process and reused for every region of every
document. 

`lru_cache` guards its own dict but does not serialise the factory, so two
threads that both miss can both build. FastAPI runs sync endpoints in a
threadpool, so that is reachable here; `_BUILD_LOCK` makes the build
single-flight.

The blocking preflight (`OCRClient.start()`) is skipped on purpose: it polls the
service every 10s until `connect_timeout` expires and only then raises. Skipping
it lets `process()` create the session lazily and surface a connection failure
immediately, per region, instead of stalling process startup.
"""

import base64
import os
import threading
from functools import lru_cache
from pathlib import Path

from glmocr.config import OCRApiConfig, load_config
from glmocr.ocr_client import OCRClient

# GLM-OCR's own task prompts, copied from the SDK's packaged config.yaml
# (`pipeline.page_loader.task_prompt_mapping`). The model was trained against
# these exact strings, so they are not ours to reword.
TASK_PROMPTS = {
    "text": "Text Recognition:",
    "table": "Table Recognition:",
    "formula": "Formula Recognition:",
}

# Service config lives at the service root; `load_config` layers
# GLMOCR_* env vars and .env on top of it (env wins), which is how Compose
# points us at the `ollama` service instead of localhost.
CONFIG_PATH = Path(__file__).resolve().parents[3] / "config.yml"

# Generation parameters mirroring glmocr's page_loader defaults. Deterministic
# decoding matters: we re-read the same region on every re-ingest and want the
# same text out.
MAX_TOKENS = 8192
TEMPERATURE = 0.0

_BUILD_LOCK = threading.Lock()


def _ocr_api_config() -> OCRApiConfig:
    """Resolve the OCR API config from YAML + environment.

    `load_config` already maps GLMOCR_MODE / GLMOCR_OCR_API_HOST /
    GLMOCR_OCR_API_PORT / GLMOCR_OCR_MODEL / GLMOCR_OCR_API_URL /
    GLMOCR_OCR_API_KEY. It does *not* map `api_mode` or `api_path`, which are the
    two knobs that differ between an Ollama backend (`/api/generate`,
    `ollama_generate`) and an OpenAI-compatible one such as vLLM
    (`/v1/chat/completions`, `openai`), so those are applied here to keep the
    backend switchable without editing YAML.
    """
    # Passing a non-existent path raises; fall back to the SDK default YAML so a
    # missing config.yml degrades to "env vars only" rather than crashing.
    config = load_config(CONFIG_PATH if CONFIG_PATH.is_file() else None)
    ocr_api = config.pipeline.ocr_api

    api_mode = os.getenv("GLMOCR_OCR_API_MODE", "").strip()
    if api_mode:
        ocr_api.api_mode = api_mode

    api_path = os.getenv("GLMOCR_OCR_API_PATH", "").strip()
    if api_path:
        ocr_api.api_path = api_path

    return ocr_api


@lru_cache(maxsize=1)
def _build_client() -> OCRClient:
    """Construct the client. Cached; call `ocr_client()` instead."""
    return OCRClient(_ocr_api_config())


def ocr_client() -> OCRClient:
    """The process-wide OCR client, built on first use."""
    with _BUILD_LOCK:
        return _build_client()


def close_ocr_client() -> None:
    """Close the pooled HTTP session and drop the cached client.

    Safe when nothing was built: `currsize` is checked so we do not construct a
    client purely in order to close it.
    """
    with _BUILD_LOCK:
        if _build_client.cache_info().currsize:
            try:
                _build_client().stop()
            except Exception:  # noqa: BLE001 - shutdown must not raise
                pass
        _build_client.cache_clear()


def _data_uri(image_png: bytes) -> str:
    """Encode PNG bytes as a data URI.

    Both API modes consume this: the OpenAI path forwards it as an `image_url`,
    and `ollama_generate` splits the base64 payload back out for Ollama's
    `images` field.
    """
    encoded = base64.b64encode(image_png).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def recognise(image_png: bytes, task: str) -> str | None:
    """Recognise one cropped region, returning Markdown/LaTeX text or None.

    Args:
        image_png: the region as PNG bytes (see `image_crop.crop_png`).
        task: one of `TASK_PROMPTS` — "table", "formula" or "text". Selects the
            prompt the model was trained on for that content type.

    Returns:
        The recognised text, or None when the service errored or returned
        nothing. Returning None rather than raising keeps one unreadable region
        from failing a whole document; the caller decides whether to fall back.

    Raises:
        ValueError: for an unknown task, which is a programming error rather
            than a runtime condition.
    """
    try:
        prompt = TASK_PROMPTS[task]
    except KeyError:
        expected = sorted(TASK_PROMPTS)
        raise ValueError(f"unknown OCR task {task!r}; expected one of {expected}") from None

    payload = {
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": _data_uri(image_png)}},
                ],
            }
        ],
        "max_tokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }

    response, status = ocr_client().process(payload)
    if status != 200 or "error" in response:
        return None

    choices = response.get("choices") or []
    if not choices:
        return None
    content = (choices[0].get("message", {}).get("content") or "").strip()
    return content or None

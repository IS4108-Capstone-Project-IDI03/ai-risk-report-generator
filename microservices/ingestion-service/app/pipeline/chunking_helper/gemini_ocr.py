"""Gemini reads cropped table and formula regions (OCR_PROVIDER=gemini).

The client pattern is copied from speech-ocr-service's photo interpreter
(`app/processors/vision.py`): one `genai.Client` held open for the call, a
JSON `response_format` built from a pydantic schema, `store=False`.
"""

import base64
import logging
import os
import time

from google import genai
from pydantic import BaseModel, ValidationError

from app.pipeline.chunking_helper.ocr_prompts import TASKS

log = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.8-flash"

# Retry policy for rate limits and server errors: 3 tries, waits of 2 s then 4 s.
ATTEMPTS = 3
BACKOFF_SECONDS = 2.0


def _model() -> str:
    return os.getenv("OCR_MODEL", "").strip() or DEFAULT_MODEL


def _client() -> genai.Client:
    """A fresh client per request; tests replace this with a fake."""
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def _status(error: Exception) -> int | None:
    # The interactions SDK names it status_code; google.genai.errors names it code.
    status = getattr(error, "status_code", None) or getattr(error, "code", None)
    return status if isinstance(status, int) else None


def _retryable(error: Exception) -> bool:
    """Rate limits, server errors and lost connections are worth another try."""
    status = _status(error)
    return status is None or status == 429 or status >= 500


def _ask(prompt: str, schema: type[BaseModel], data: str):
    with _client() as client:
        return client.interactions.create(
            model=_model(),
            # Image before the text that asks about it.
            input=[
                {"type": "image", "data": data, "mime_type": "image/png"},
                {"type": "text", "text": prompt},
            ],
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": schema.model_json_schema(),
            },
            generation_config={"temperature": 0},
            store=False,
        )


def recognise(image_png: bytes, task: str) -> str | None:
    """Read one cropped region; same contract as `ocr_model.recognise`.

    Returns None when Gemini fails after `ATTEMPTS` tries or answers in an
    unexpected form, so one unreadable region never fails the document.
    """
    prompt, schema, to_text = TASKS[task]
    data = base64.b64encode(image_png).decode("ascii")
    for attempt in range(1, ATTEMPTS + 1):
        try:
            result = _ask(prompt, schema, data)
        except Exception as error:  # noqa: BLE001 - any failure leaves this region unread
            if _status(error) in (401, 403, 404):
                # A bad key or model name would leave every region unread; fail the document.
                raise
            if attempt == ATTEMPTS or not _retryable(error):
                log.warning("Gemini OCR gave up on a %s region: %s", task, error)
                return None
            time.sleep(BACKOFF_SECONDS * 2 ** (attempt - 1))
            continue
        try:
            return to_text(schema.model_validate_json(result.output_text)) or None
        except ValidationError as error:
            log.warning("Gemini OCR answered a %s region in an unexpected form: %s", task, error)
            return None
    return None

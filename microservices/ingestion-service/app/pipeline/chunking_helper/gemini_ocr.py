"""Gemini reads cropped table and formula regions (OCR_PROVIDER=gemini).

The client pattern is copied from speech-ocr-service's photo interpreter
(`app/processors/vision.py`): one `genai.Client` held open for the call, a
JSON `response_format` built from a pydantic schema, `store=False`.

Rate limits, server errors and dropped connections are waited out by
`rate_limit`; a region still refused fails the document (OcrUnavailableError).
"""

import base64
import logging
import os
import time

import httpx
from google import genai
from pydantic import BaseModel, ValidationError

from app import usage
from app.pipeline.chunking_helper.ocr_prompts import TASKS
from app.pipeline.chunking_helper.rate_limit import (
    call_with_waits,
    is_transient_status,
    parse_seconds,
)
from app.pipeline.errors import OcrUnavailableError

log = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.8-flash"


def _model() -> str:
    return os.getenv("OCR_MODEL", "").strip() or DEFAULT_MODEL


def _client() -> genai.Client:
    """A fresh client per request; tests replace this with a fake."""
    return genai.Client(api_key=os.getenv("GEMINI_API_KEY"))


def _status(error: Exception) -> int | None:
    # The interactions SDK names it status_code; google.genai.errors names it code.
    status = getattr(error, "status_code", None) or getattr(error, "code", None)
    return status if isinstance(status, int) else None


def _is_transient(error: Exception) -> bool:
    """Rate limits (429), server errors (503 overload included) and lost connections."""
    status = _status(error)
    if status is not None:
        return is_transient_status(status)
    # The interactions SDK keeps its error classes private, so its connection
    # errors are known by name.
    if isinstance(error, (httpx.TransportError, ConnectionError, TimeoutError)):
        return True
    return type(error).__name__ in ("APIConnectionError", "APITimeoutError")


def _hint(error: Exception) -> float | None:
    """Seconds from the `retryDelay` a 429's body sometimes carries (google.rpc.RetryInfo)."""
    body = getattr(error, "body", None) or getattr(error, "details", None)
    if not isinstance(body, dict):
        return None
    details = (body.get("error") if isinstance(body.get("error"), dict) else body).get("details")
    for detail in details if isinstance(details, list) else []:
        if isinstance(detail, dict) and "retryDelay" in detail:
            return parse_seconds(detail["retryDelay"])
    return None


def _ask(prompt: str, schema: type[BaseModel], data: str):
    started = time.perf_counter()
    with _client() as client:
        result = client.interactions.create(
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
    _record(result, started)
    return result


def _record(result, started: float) -> None:
    """Record one answered request (EV-03). Thinking is billed as output, so it is added in."""
    tokens = getattr(result, "usage", None)
    answer = getattr(tokens, "total_output_tokens", None)
    thought = getattr(tokens, "total_thought_tokens", None)
    usage.record(
        "ocr",
        "gemini-ocr",
        getattr(result, "model", None) or _model(),
        started,
        input_tokens=getattr(tokens, "total_input_tokens", None),
        output_tokens=None if answer is None else answer + (thought or 0),
    )


def recognise(image_png: bytes, task: str) -> str | None:
    """Read one cropped region; same contract as `ocr_model.recognise`.

    Returns None when Gemini rejects the request for another reason or answers
    in an unexpected form, so one unreadable region never fails the document.
    """
    prompt, schema, to_text = TASKS[task]
    data = base64.b64encode(image_png).decode("ascii")
    try:
        result = call_with_waits(
            lambda: _ask(prompt, schema, data), _is_transient, _hint, "Gemini", task
        )
    except OcrUnavailableError:
        raise
    except Exception as error:  # noqa: BLE001 - any other failure leaves this region unread
        if _status(error) in (401, 403, 404):
            # A bad key or model name would leave every region unread; fail the document.
            raise
        log.warning("Gemini OCR gave up on a %s region: %s", task, error)
        return None
    try:
        return to_text(schema.model_validate_json(result.output_text)) or None
    except ValidationError as error:
        log.warning("Gemini OCR answered a %s region in an unexpected form: %s", task, error)
        return None

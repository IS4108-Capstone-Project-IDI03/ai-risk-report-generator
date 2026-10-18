"""Claude reads cropped table, formula and picture regions (OCR_PROVIDER=anthropic).

Uses structured outputs through `messages.create` and validates the answer here,
not with `messages.parse`: `parse` raises on any incomplete JSON, and the safety
filter sometimes stops an answer partway through (seen on FM-200 agent tables),
which would fail the whole document. A refused, cut-off or invalid answer is
asked once more, since refusals are not repeatable, then left unread (None).

The SDK itself retries rate limits, server errors and dropped connections a few
times (`MAX_RETRIES`); after that `rate_limit` waits them out, and a region still
refused fails the document (OcrUnavailableError). Any other API error leaves the
region unread (None), the same contract as the other providers.
"""

import base64
import logging
import os
import time

import anthropic
from pydantic import BaseModel, TypeAdapter, ValidationError

from app import usage
from app.pipeline.chunking_helper.ocr_prompts import task_spec
from app.pipeline.chunking_helper.rate_limit import (
    call_with_waits,
    is_transient_status,
    parse_seconds,
)

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-haiku-5-5"
MAX_RETRIES = 2  # 3 tries in all
MAX_TOKENS = 16000  # a dense full-page table plus thinking fits well inside this
MAX_ATTEMPTS = 2  # an unusable answer is asked once more, then the region is left unread


def _model() -> str:
    return os.getenv("OCR_MODEL", "").strip() or DEFAULT_MODEL


def _client() -> anthropic.Anthropic:
    """The API client (reads ANTHROPIC_API_KEY); tests replace this with a fake."""
    return anthropic.Anthropic(max_retries=MAX_RETRIES)


def _output_format(schema: type[BaseModel]) -> dict:
    """The JSON-schema format `messages.parse` would send for `schema`."""
    return {
        "type": "json_schema",
        "schema": anthropic.transform_schema(TypeAdapter(schema).json_schema()),
    }


def _ask(prompt: str, schema: type[BaseModel], data: str, context: str = ""):
    started = time.perf_counter()
    response = _client().messages.create(
        model=_model(),
        max_tokens=MAX_TOKENS,
        # Transcription needs little reasoning; low effort keeps it fast and cheap.
        output_config={"effort": "low", "format": _output_format(schema)},
        messages=[
            {
                "role": "user",
                "content": [
                    # Image before the text that asks about it.
                    {
                        "type": "image",
                        "source": {"type": "base64", "media_type": "image/png", "data": data},
                    },
                    {"type": "text", "text": prompt},
                    *([{"type": "text", "text": context}] if context else []),
                ],
            }
        ],
    )
    # Recorded here, once per answered request: a refused or cut-off answer is
    # still billed, and a request retried after a rate limit is not (EV-03).
    tokens = getattr(response, "usage", None)
    usage.record(
        "ocr",
        "anthropic",
        getattr(response, "model", None) or _model(),
        started,
        input_tokens=getattr(tokens, "input_tokens", None),
        output_tokens=getattr(tokens, "output_tokens", None),
        cache_read_tokens=getattr(tokens, "cache_read_input_tokens", None),
    )
    return response


def _is_transient(error: Exception) -> bool:
    """Rate limits (429), overloads (529), server errors and dropped connections."""
    if isinstance(error, anthropic.APIConnectionError):  # timeouts included
        return True
    return isinstance(error, anthropic.APIStatusError) and is_transient_status(error.status_code)


def _hint(error: Exception) -> float | None:
    """Seconds from the `retry-after` header Anthropic sends with a 429."""
    response = getattr(error, "response", None)
    return parse_seconds(response.headers.get("retry-after")) if response is not None else None


def _reading(response, schema: type[BaseModel]) -> tuple[BaseModel | None, str]:
    """(validated answer, "") or (None, why it is unusable)."""
    text = "".join(block.text for block in response.content if block.type == "text")
    if response.stop_reason != "end_turn":
        return None, f"stop_reason={response.stop_reason}, {len(text)} characters of answer"
    try:
        return schema.model_validate_json(text), ""
    except ValidationError as error:
        why = error.errors()[0]["msg"]
        return None, f"invalid {schema.__name__} ({why}), {len(text)} characters"


def recognise(image_png: bytes, task: str, context: str = "") -> str | None:
    """Read one cropped region; same contract as `ocr_model.recognise`."""
    prompt, schema, to_text = task_spec(task)
    data = base64.standard_b64encode(image_png).decode("ascii")
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            response = call_with_waits(
                lambda: _ask(prompt, schema, data, context), _is_transient, _hint, "Claude", task
            )
        except (
            anthropic.AuthenticationError,
            anthropic.PermissionDeniedError,
            anthropic.NotFoundError,
        ):
            # A bad key or model name would leave every region unread; fail the document instead.
            raise
        except anthropic.APIError as error:
            log.warning("Claude OCR gave up on a %s region: %s", task, error)
            return None
        reading, problem = _reading(response, schema)
        if reading is not None:
            if attempt > 1:
                log.warning("Claude OCR read the %s region on attempt %s.", task, attempt)
            return to_text(reading) or None
        log.warning(
            "Claude OCR: unusable %s reading on attempt %s of %s: %s",
            task,
            attempt,
            MAX_ATTEMPTS,
            problem,
        )
    log.warning("Claude OCR: %s region left unread after %s attempts.", task, MAX_ATTEMPTS)
    return None

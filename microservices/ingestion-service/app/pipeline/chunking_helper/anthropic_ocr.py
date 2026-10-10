"""Claude reads cropped table and formula regions (OCR_PROVIDER=anthropic).

Uses the official SDK's structured outputs (`messages.parse` with a pydantic
schema), so the answer arrives already validated. The SDK itself retries rate
limits, server errors and dropped connections (`MAX_RETRIES`); after that the
region is left unread (None), the same contract as the other providers.
"""

import base64
import logging
import os

import anthropic
from pydantic import BaseModel

from app.pipeline.chunking_helper.ocr_prompts import TASKS

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-haiku-5-5"
MAX_RETRIES = 2  # 3 tries in all
MAX_TOKENS = 16000  # a dense full-page table plus thinking fits well inside this


def _model() -> str:
    return os.getenv("OCR_MODEL", "").strip() or DEFAULT_MODEL


def _client() -> anthropic.Anthropic:
    """The API client (reads ANTHROPIC_API_KEY); tests replace this with a fake."""
    return anthropic.Anthropic(max_retries=MAX_RETRIES)


def _ask(prompt: str, schema: type[BaseModel], data: str):
    return _client().messages.parse(
        model=_model(),
        max_tokens=MAX_TOKENS,
        # Transcription needs little reasoning; low effort keeps it fast and cheap.
        output_config={"effort": "low"},
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
                ],
            }
        ],
        output_format=schema,
    )


def recognise(image_png: bytes, task: str) -> str | None:
    """Read one cropped region; same contract as `ocr_model.recognise`."""
    prompt, schema, to_text = TASKS[task]
    data = base64.standard_b64encode(image_png).decode("ascii")
    try:
        response = _ask(prompt, schema, data)
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
    # A refusal or a cut-off answer (stop_reason refusal / max_tokens) has no parsed output.
    if response.parsed_output is None:
        log.warning("Claude OCR: no %s reading (stop_reason=%s)", task, response.stop_reason)
        return None
    return to_text(response.parsed_output) or None

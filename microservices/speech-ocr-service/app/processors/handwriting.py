"""Handwriting transcriber (CP-19). Stateless — reads one page from S3, returns its text.

A page is a photo of the engineer's handwritten site notes. Like a voice transcript (CP-03),
the text is the engineer's own words written out, never interpreted. A word the model cannot
read for certain is kept as its best guess and marked uncertain, so the engineer knows what to
check against the page.
"""

import base64
import time

import boto3
from google import genai
from google.genai import types
from pydantic import BaseModel, ValidationError

from app.config import (
    AWS_REGION,
    GEMINI_API_KEY,
    HANDWRITING_MODEL,
    HANDWRITING_PROVIDER,
    S3_BUCKET,
)
from app.processors.images import upright_jpeg

# Bump whenever the prompt wording changes, so a saved transcript names the prompt it came from.
PROMPT_VERSION = "cp19-v1"

# Gemini's SDK retries a refused request three times, with no limit on how long each may take.
# On a busy or rate-limited key that held a page for minutes, past the gateway's five-minute wait,
# which then reported S5 as unreachable. One retry, each at most this long, keeps S5's answer, and
# its reason, well inside that wait.
REQUEST_TIMEOUT_MS = 90_000
HTTP_OPTIONS = types.HttpOptions(
    timeout=REQUEST_TIMEOUT_MS, retry_options=types.HttpRetryOptions(attempts=1)
)


class HandwritingError(Exception):
    """The reason a page could not be transcribed, shown to the engineer."""


class Word(BaseModel):
    text: str
    uncertain: bool


class Line(BaseModel):
    words: list[Word]


# Words, not one string, so which words are uncertain comes back as data rather than markup the
# model could leave unbalanced.
class Reading(BaseModel):
    lines: list[Line]


SYSTEM_INSTRUCTION = """You transcribe a photo of one page of handwritten notes that a Marsh \
property risk engineer wrote during a site survey. The notes are in English.

Write out the handwriting word for word, in reading order, one entry per line of writing. Keep \
the engineer's own words exactly as written: their abbreviations (spk, CV, FHR), numbers, units \
and spelling, even where a word looks misspelt. Do not expand, correct, summarise or explain \
anything, and add no word that is not on the page.

Write an arrow as → and a tick as ✓. Leave out crossed-out words and drawings. Leave out printed \
text, except a printed label that the handwriting fills in: for a form field, write the label, \
then the handwritten value.

If you cannot read a word for certain, write your best guess and set uncertain to true. Set it \
to false only for words you are sure of. Never leave out a word because it is hard to read.

If the page has no handwriting, return no lines."""

PROMPT = "One page of handwritten site notes."


def _read(key: str) -> bytes:
    try:
        stored = boto3.client("s3", region_name=AWS_REGION).get_object(Bucket=S3_BUCKET, Key=key)
        return stored["Body"].read()
    except Exception as error:
        # The gateway maps these message prefixes to user-facing reasons
        # (server/src/services/observation.service.ts); keep them in sync.
        raise HandwritingError(f"The page could not be read from storage: {error}") from error


def _prepare(image: bytes) -> str:
    """The page upright and shrunk (see `upright_jpeg`), as base64."""
    try:
        jpeg = upright_jpeg(image)
    except Exception as error:
        raise HandwritingError(f"The page could not be opened: {error}") from error
    return base64.b64encode(jpeg).decode("ascii")


def _transcribe_gemini(image: str) -> tuple[Reading, dict]:
    started = time.perf_counter()
    try:
        # Held open for the whole call, as in vision.py: a discarded client closes its connection.
        with genai.Client(api_key=GEMINI_API_KEY, http_options=HTTP_OPTIONS) as client:
            result = client.interactions.create(
                model=HANDWRITING_MODEL,
                system_instruction=SYSTEM_INSTRUCTION,
                # The page before the text that asks about it.
                input=[
                    {"type": "image", "data": image, "mime_type": "image/jpeg"},
                    {"type": "text", "text": PROMPT},
                ],
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": Reading.model_json_schema(),
                },
                # Transcription, not writing: the likeliest reading every time.
                generation_config={"temperature": 0},
                # The engineer's notes on a client's site: Google need not keep the request.
                store=False,
            )
    except Exception as error:
        raise HandwritingError(f"The page could not be transcribed: {error}") from error
    duration_ms = round((time.perf_counter() - started) * 1000)
    # A safety block or a cut-off answer comes back without usable text.
    if result.status != "completed" or not result.output_text:
        raise HandwritingError(
            f"The page could not be transcribed: no answer came back (status {result.status})."
        )
    try:
        reading = Reading.model_validate_json(result.output_text)
    except ValidationError as error:
        raise HandwritingError(
            "The page could not be transcribed: the answer was not in the expected form."
        ) from error

    tokens = result.usage
    input_tokens = getattr(tokens, "total_input_tokens", None)
    answer = getattr(tokens, "total_output_tokens", None)
    thought = getattr(tokens, "total_thought_tokens", None)
    usage = {
        "feature": "transcribe-handwriting",
        "billed_service": "gemini-vision",
        "model": result.model or HANDWRITING_MODEL,
        "duration_ms": duration_ms,
        "input_tokens": input_tokens,
        # Google bills thinking as output, so it is added in.
        "output_tokens": None if answer is None else answer + (thought or 0),
        "cache_read_tokens": None,
        "search_units": None,
        "audio_seconds": None,
        "usage_status": "recorded" if input_tokens is not None else "unavailable",
    }
    return reading, usage


_PROVIDERS = {"gemini": _transcribe_gemini}


def _units(text: str) -> int:
    """Length as JavaScript counts it (UTF-16), since the browser marks the uncertain words."""
    return len(text.encode("utf-16-le")) // 2


def _text(reading: Reading) -> tuple[str, list[list[int]]]:
    """The page as text, a line per line of writing, and where each uncertain word sits in it.

    Each uncertain word is `[start, end)` in UTF-16 code units of the text.
    """
    parts: list[str] = []
    uncertain: list[list[int]] = []
    at = 0
    for line in reading.lines:
        words = [(" ".join(w.text.split()), w.uncertain) for w in line.words]
        words = [(text, unsure) for text, unsure in words if text]
        if not words:
            continue
        for i, (text, unsure) in enumerate(words):
            gap = ("\n" if parts else "") if i == 0 else " "
            parts.append(gap)
            at += _units(gap)
            if unsure:
                uncertain.append([at, at + _units(text)])
            parts.append(text)
            at += _units(text)
    return "".join(parts), uncertain


def transcribe_page(s3_key: str) -> dict:
    return transcribe_image(_read(s3_key))


def transcribe_image(image: bytes) -> dict:
    """The transcript of a page already in hand; transcribe_page() and the eval both use it."""
    provider = _PROVIDERS.get(HANDWRITING_PROVIDER)
    if provider is None:
        raise HandwritingError(
            f"The page could not be transcribed: HANDWRITING_PROVIDER {HANDWRITING_PROVIDER!r} "
            "is not supported."
        )
    reading, usage = provider(_prepare(image))
    transcript, uncertain = _text(reading)
    return {
        # Empty when the page has no handwriting (CP-19 AC10).
        "transcript": transcript,
        "uncertain": uncertain,
        "provider": HANDWRITING_PROVIDER,
        "model": usage["model"],
        "prompt_version": PROMPT_VERSION,
        "usage": [usage],
    }

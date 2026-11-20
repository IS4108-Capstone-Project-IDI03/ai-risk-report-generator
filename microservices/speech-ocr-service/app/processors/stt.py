"""Whisper STT processor. Stateless — reads the audio from S3, returns the transcript."""

import os
import time

import boto3
from openai import OpenAI

from app.config import AWS_REGION, S3_BUCKET, WHISPER_MODEL
from app.processors import tidy


class TranscriptionError(Exception):
    """The reason a recording could not be transcribed, shown to the engineer."""


# The SDK gives objects, a plain dict gives keys; take either.
def _get(segment, key):
    return segment[key] if isinstance(segment, dict) else getattr(segment, key)


def _segments(result) -> list[dict]:
    """Whisper's timed pieces as {start, end, text}, each text tidied (CP-27); [] when it returns
    none."""
    return [
        {"start": _get(s, "start"), "end": _get(s, "end"), "text": tidy.rules(_get(s, "text"))}
        for s in getattr(result, "segments", None) or []
    ]


# Whisper's own score for "this piece is not speech". Real speech scores near 0; silence and room
# noise score 0.8 or more, and Whisper then invents text such as "Thank you for watching."
NO_SPEECH_ABOVE = 0.6


def _spoken(result) -> str:
    """The transcript without the pieces Whisper itself says are not speech."""
    pieces = getattr(result, "segments", None)
    if not pieces:
        return result.text.strip()
    heard = [
        _get(s, "text").strip() for s in pieces if _get(s, "no_speech_prob") <= NO_SPEECH_ABOVE
    ]
    return " ".join(heard).strip()


# Whisper takes the prompt as the sentence said before the audio. It hears the terms in it
# correctly (the standards and fire-protection words engineers say), and it copies the prompt's
# style: fluent sentences with no "um" or "uh" make it leave fillers out (CP-27).
_TERMS = (
    "We checked it against NFPA 13, NFPA 25 and NFPA 72, the FM Global data sheets and "
    "Singapore SS CP 52, looking at the sprinkler design density for ordinary hazard group 2 "
    "and extra hazard storage, the fire pump, the standpipe, the deluge system and the clearance "
    "below the sprinklers."
)
# A spoken chat question (CB-10) or dictated text.
CLIP_PROMPT = "This is a question for Marsh risk engineering about fire protection. " + _TERMS
# A voice note or a site-walk recording.
RECORDING_PROMPT = "This is a Marsh risk engineer's site survey note on fire protection. " + _TERMS


def _whisper(
    name: str,
    audio: bytes,
    prompt: str | None = None,
    only_speech: bool = False,
    privacy: dict | None = None,
) -> dict:
    """Send audio to Whisper; return {transcript, spoken, segments, usage}. `name` carries the
    format; `privacy` is passed to the tidy model's pass (CP-27)."""
    # Time only the OpenAI call, so duration_ms excludes any storage read.
    started = time.perf_counter()
    try:
        # verbose_json adds `duration` (clip length in seconds) to the result.
        result = OpenAI().audio.transcriptions.create(
            model=WHISPER_MODEL,
            file=(name, audio),
            response_format="verbose_json",
            # Without this, Whisper guesses the language from the first 30s and
            # can mistake Singapore-accented English for Malay, then write the
            # transcript in Malay. Reports are in English, so pin it.
            language="en",
            **({"prompt": prompt} if prompt else {}),
        )
    except Exception as error:
        raise TranscriptionError(f"Whisper could not transcribe the recording: {error}") from error
    duration_ms = round((time.perf_counter() - started) * 1000)

    # Whisper gives no tokens, so audio_seconds is the only billable number.
    raw_duration = getattr(result, "duration", None)
    audio_seconds = float(raw_duration) if raw_duration is not None else None
    usage = {
        "feature": "transcribe",
        "billed_service": "openai-whisper",
        "model": WHISPER_MODEL,
        "duration_ms": duration_ms,
        "input_tokens": None,
        "output_tokens": None,
        "cache_read_tokens": None,
        "search_units": None,
        "audio_seconds": audio_seconds,
        "usage_status": "recorded" if audio_seconds is not None else "unavailable",
    }
    spoken = _spoken(result) if only_speech else result.text.strip()
    # CP-27: `transcript` is tidied (fillers and stumbles deleted, nothing reworded); `spoken` is
    # Whisper's own text, which the gateway keeps as evidence.
    transcript, tidy_usage = tidy.repair(tidy.rules(spoken), privacy)
    return {
        "transcript": transcript,
        "spoken": spoken,
        "segments": _segments(result),
        "usage": [usage, *tidy_usage],
    }


def transcribe(s3_key: str, privacy: dict | None = None) -> dict:
    try:
        stored = boto3.client("s3", region_name=AWS_REGION).get_object(Bucket=S3_BUCKET, Key=s3_key)
        audio = stored["Body"].read()
    except Exception as error:
        # The gateway maps these message prefixes to user-facing reasons
        # (server/src/services/observation.service.ts); keep them in sync.
        reason = f"The recording could not be read from storage: {error}"
        raise TranscriptionError(reason) from error
    # Whisper picks the decoder from the file name's extension, which the key carries.
    return _whisper(os.path.basename(s3_key), audio, RECORDING_PROMPT, privacy=privacy)


def transcribe_clip(audio: bytes, filename: str, privacy: dict | None = None) -> dict:
    """Transcribe a short clip sent directly (a spoken chat question or dictated text)."""
    # only_speech: a silent or noisy clip must come back empty, not as an invented sentence.
    return _whisper(filename, audio, CLIP_PROMPT, only_speech=True, privacy=privacy)

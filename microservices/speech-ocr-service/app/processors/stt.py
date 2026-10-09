"""Whisper STT processor. Stateless — reads the audio from S3, returns the transcript."""

import os
import time

import boto3
from openai import OpenAI

from app.config import AWS_REGION, S3_BUCKET, WHISPER_MODEL


class TranscriptionError(Exception):
    """The reason a recording could not be transcribed, shown to the engineer."""


def transcribe(s3_key: str) -> dict:
    try:
        stored = boto3.client("s3", region_name=AWS_REGION).get_object(Bucket=S3_BUCKET, Key=s3_key)
        audio = stored["Body"].read()
    except Exception as error:
        # The gateway maps these message prefixes to user-facing reasons
        # (server/src/services/observation.service.ts); keep them in sync.
        reason = f"The recording could not be read from storage: {error}"
        raise TranscriptionError(reason) from error

    # Whisper picks the decoder from the file name's extension, which the key carries.
    # Time only the OpenAI call, so duration_ms excludes the S3 read.
    started = time.perf_counter()
    try:
        # verbose_json adds `duration` (clip length in seconds) to the result.
        result = OpenAI().audio.transcriptions.create(
            model=WHISPER_MODEL,
            file=(os.path.basename(s3_key), audio),
            response_format="verbose_json",
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
    return {"transcript": result.text.strip(), "usage": [usage]}

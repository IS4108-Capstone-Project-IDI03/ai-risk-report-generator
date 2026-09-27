"""Whisper STT processor. Stateless — reads the audio from S3, returns the transcript."""

import os

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
        reason = f"The recording could not be read from storage: {error}"
        raise TranscriptionError(reason) from error

    # Whisper picks the decoder from the file name's extension, which the key carries.
    try:
        result = OpenAI().audio.transcriptions.create(
            model=WHISPER_MODEL, file=(os.path.basename(s3_key), audio)
        )
    except Exception as error:
        raise TranscriptionError(f"Whisper could not transcribe the recording: {error}") from error
    return {"transcript": result.text.strip()}

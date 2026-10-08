from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.processors.ocr import extract_text
from app.processors.stt import TranscriptionError, transcribe
from app.processors.vision import InterpretationError, interpret

router = APIRouter()


class S3KeyRequest(BaseModel):
    s3_key: str


# One observation's photos, with what the engineer recorded about where and what (CP-05).
class InterpretRequest(BaseModel):
    s3_keys: list[str] = Field(min_length=1)
    location: str | None = None
    note: str | None = None


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "speech-ocr"}


@router.post("/transcribe")
def transcribe_audio(request: S3KeyRequest) -> dict:
    # The gateway stores the result and shows `detail` to the engineer on failure.
    try:
        return transcribe(request.s3_key)
    except TranscriptionError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/interpret")
def interpret_photos(request: InterpretRequest) -> dict:
    # The gateway stores the proposal and shows `detail` to the engineer on failure.
    try:
        return interpret(request.s3_keys, request.location, request.note)
    except InterpretationError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/ocr")
def ocr_document(request: S3KeyRequest) -> dict:
    return extract_text(request.s3_key)

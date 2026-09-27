from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.processors.ocr import extract_text
from app.processors.stt import TranscriptionError, transcribe

router = APIRouter()


class S3KeyRequest(BaseModel):
    s3_key: str


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


@router.post("/ocr")
def ocr_document(request: S3KeyRequest) -> dict:
    return extract_text(request.s3_key)

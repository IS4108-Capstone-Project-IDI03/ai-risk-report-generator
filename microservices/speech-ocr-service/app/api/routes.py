from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.processors.handwriting import HandwritingError, transcribe_page
from app.processors.stt import TranscriptionError, transcribe
from app.processors.vision import InterpretationError, interpret

router = APIRouter()


class S3KeyRequest(BaseModel):
    s3_key: str


class PhotoItem(BaseModel):
    label: str = Field(min_length=1)
    s3_key: str


class TextItem(BaseModel):
    label: str = Field(min_length=1)
    kind: Literal["note", "recording", "page"]
    text: str = Field(min_length=1)


# Everything the engineer captured about one finding, each item by the name the proposal cites
# it by (CP-05, CP-21), with where it was found, and which parts of the proposal to write: the
# categories, the photos' description, or (left out) both, or the categories alone without photos.
class InterpretRequest(BaseModel):
    photos: list[PhotoItem] = []
    texts: list[TextItem] = []
    location: str | None = None
    parts: list[Literal["categories", "description"]] | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def has_evidence(self):
        if not self.photos and not self.texts:
            raise ValueError("There is nothing to read: no photo, note or transcript.")
        if self.parts and "description" in self.parts and not self.photos:
            raise ValueError("There are no photos to describe.")
        labels = [item.label for item in (*self.photos, *self.texts)]
        if len(set(labels)) != len(labels):
            raise ValueError("Each item needs its own label.")
        return self


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
def interpret_observation(request: InterpretRequest) -> dict:
    # The gateway stores the proposal and shows `detail` to the engineer on failure.
    try:
        return interpret(
            [p.model_dump() for p in request.photos],
            [t.model_dump() for t in request.texts],
            request.location,
            tuple(request.parts) if request.parts else None,
        )
    except InterpretationError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/transcribe-handwriting")
def transcribe_handwriting(request: S3KeyRequest) -> dict:
    # One page of handwritten notes (CP-19). As for a recording, the gateway stores the result
    # and shows `detail` to the engineer on failure.
    try:
        return transcribe_page(request.s3_key)
    except HandwritingError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

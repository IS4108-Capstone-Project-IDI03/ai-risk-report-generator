import base64
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.privacy import PrivacyUnavailable
from app.processors.chat_pdf import PdfRefused, extract_pages
from app.processors.chat_photo import check_faces
from app.processors.handwriting import HandwritingError, transcribe_page
from app.processors.stt import TranscriptionError, transcribe, transcribe_clip
from app.processors.vision import (
    InterpretationError,
    describe_chat_photo,
    describe_photo,
    interpret,
)

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


# A detail privacy-service masks wherever it appears (PV-01): one client, site, address or person.
class KnownEntity(BaseModel):
    type: str
    names: list[str] = Field(min_length=1)


# Whether to protect client details before Gemini, as the gateway decided (PV-04). Left out,
# S5 reads as it did before PV-04.
class Privacy(BaseModel):
    enabled: bool
    known_entities: list[KnownEntity] = []
    # Whether details Gemini adds to its answer (a name read off a photo) are taken out.
    check_answers: bool = False


# Everything the engineer captured about one finding, each item by the name the proposal cites
# it by (CP-05, CP-21), with where it was found, and which parts of the proposal to write: the
# categories, the photos' description, or (left out) both, or the categories alone without photos.
class InterpretRequest(BaseModel):
    photos: list[PhotoItem] = []
    texts: list[TextItem] = []
    location: str | None = None
    parts: list[Literal["categories", "description"]] | None = Field(default=None, min_length=1)
    privacy: Privacy | None = None

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


class ClipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    audio_base64: str
    # Its extension tells Whisper the format (webm, m4a...).
    filename: str = "question.webm"


@router.post("/transcribe-clip")
def transcribe_audio_clip(request: ClipRequest) -> dict:
    """A spoken chat question sent as bytes (CB-10): no S3 round trip, stored nowhere."""
    try:
        audio = base64.b64decode(request.audio_base64, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="The audio is not valid base64.") from error
    try:
        return transcribe_clip(audio, request.filename)
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
            request.privacy.model_dump() if request.privacy else None,
        )
    except (InterpretationError, PrivacyUnavailable) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


class PdfRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pdf_base64: str


@router.post("/chat-pdf/extract")
def chat_pdf_extract(request: PdfRequest) -> dict:
    """The text of each page of a chat PDF, or why it cannot be used (CB-09)."""
    try:
        data = base64.b64decode(request.pdf_base64, validate=True)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="The PDF is not valid base64.") from error
    try:
        return extract_pages(data)
    except PdfRefused as error:
        # 422: the file is the problem, so the gateway shows this wording and does not retry.
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.post("/chat-photo/faces")
def chat_photo_faces(request: S3KeyRequest) -> dict:
    """How many faces a chat photo has, and a blurred copy (CB-08)."""
    try:
        return check_faces(request.s3_key)
    except (InterpretationError, PrivacyUnavailable) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/chat-photo/describe")
def chat_photo_describe(request: S3KeyRequest) -> dict:
    """What a chat photo shows and what could not be made out (CB-08)."""
    try:
        return describe_chat_photo(request.s3_key)
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


# One site-walk photo, and whether to protect it as /interpret does (PV-08). Left out, S5
# describes it as it did before PV-08.
class DescribePhotoRequest(S3KeyRequest):
    privacy: Privacy | None = None


@router.post("/describe-photo")
def describe_site_photo(request: DescribePhotoRequest) -> dict:
    # One site photo (CP-22), described so it can be matched to a finding. As for /interpret,
    # the gateway shows `detail` to the engineer on failure.
    try:
        return describe_photo(
            request.s3_key, request.privacy.model_dump() if request.privacy else None
        )
    except (InterpretationError, PrivacyUnavailable) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

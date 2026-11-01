import base64
import binascii

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.faces import NotAnImage, blur_faces
from app.masker import KnownEntity, mask

router = APIRouter()


# Details the caller already knows about, e.g. the assessment's client and its other names.
# A known entity's placeholder restores to its first name.
class KnownEntityModel(BaseModel):
    type: str
    names: list[str] = Field(min_length=1)


class MaskRequest(BaseModel):
    texts: list[str]
    known_entities: list[KnownEntityModel] = []
    # From an earlier call in the same request, so its placeholders keep their meaning.
    mapping: dict[str, str] = {}


# Photos as base64 JPEG or PNG, all of one request's in one call (PV-04).
class RedactImageRequest(BaseModel):
    images: list[str]


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "privacy"}


@router.post("/mask")
def mask_texts(request: MaskRequest) -> dict:
    known = [KnownEntity(e.type, e.names) for e in request.known_entities]
    texts, mapping = mask(request.texts, known, request.mapping)
    return {"texts": texts, "mapping": mapping}


@router.post("/redact-image")
def redact_images(request: RedactImageRequest) -> dict:
    images, faces = [], []
    for number, data in enumerate(request.images, 1):
        try:
            image, count = blur_faces(base64.b64decode(data, validate=True))
        except (binascii.Error, NotAnImage):
            # Names the photo by its position, never by its content (Rule 5).
            raise HTTPException(
                status_code=422, detail=f"Image {number} could not be read as a picture."
            ) from None
        images.append(base64.b64encode(image).decode("ascii"))
        faces.append(count)
    return {"images": images, "faces": faces}

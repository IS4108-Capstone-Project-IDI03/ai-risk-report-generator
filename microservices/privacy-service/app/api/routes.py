from fastapi import APIRouter
from pydantic import BaseModel, Field

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


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "privacy"}


@router.post("/mask")
def mask_texts(request: MaskRequest) -> dict:
    print(request.texts)
    known = [KnownEntity(e.type, e.names) for e in request.known_entities]
    texts, mapping = mask(request.texts, known, request.mapping)
    print(texts)
    print(mapping)
    return {"texts": texts, "mapping": mapping}

from typing import Annotated

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.generation.generator import TEMPLATE
from app.generation.llm import GenerationFailed
from app.orchestrator.orchestrator import draft, draft_ofis_for, run
from app.retrieval.retriever import retrieve
from app.retrieval_config import COLLECTION, chroma_client

router = APIRouter()
Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]


class GenerateRequest(BaseModel):
    query: Query


# Label filters on the passages searched (KB-01); omitted ones don't filter.
class Filters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_type: str | None = None
    jurisdiction: str | None = None
    facility_type: str | None = None


class RetrieveRequest(BaseModel):
    query: Query
    filters: Filters = Filters()


class Assessment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference: str
    jurisdiction: str
    facility_type: str
    standards: list[str] = []


# One site observation as the gateway sends it, with only its finished voice transcripts.
class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    COPE_dimension: str
    note: str | None = None
    transcripts: list[str] = []
    severity: str | None = None
    location: str | None = None
    standard: str | None = None


class DraftOfisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment: Assessment
    observations: list[Observation] = []
    # Titles of OFIs the engineer already accepted, so they aren't proposed again.
    accepted: list[str] = []


class DraftSectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_id: str
    assessment: Assessment
    observations: list[Observation] = Field(min_length=1)


class ChunksExistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(min_length=1, max_length=200)


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "rag"}


@router.post("/generate")
def generate_report(request: GenerateRequest) -> dict:
    return run(request.query)


@router.post("/retrieve")
def retrieve_chunks(request: RetrieveRequest) -> dict:
    # Calls the retriever directly — used by the evaluation harness.
    return {"results": retrieve(request.query, request.filters.model_dump(exclude_none=True))}


@router.get("/sections")
def list_sections() -> dict:
    # The template's sections and what each needs, so the gateway doesn't keep its own copy.
    return {
        "sections": [
            {
                "id": section_id,
                "title": section["title"],
                "cope_dimensions": section["cope_dimensions"],
                "min_observations": section["min_observations"],
                "subsections": [
                    {"heading": sub["heading"], "kind": sub["kind"]}
                    for sub in section["subsections"]
                ],
            }
            for section_id, section in TEMPLATE["sections"].items()
        ],
        "template_version": TEMPLATE["version"],
    }


@router.post("/chunks/exist")
def chunks_exist(request: ChunksExistRequest) -> dict:
    # Do cited chunks still exist? One Chroma get, no `where`, so withdrawn and
    # needs_review passages count as found. Citation id "C:<doc>:<n>" -> chunk id "<doc>:<n>".
    chunk_ids = [i[2:] for i in request.ids if i[:2] in ("C:", "P:")]
    try:
        found = {}
        if chunk_ids:
            collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
            got = collection.get(ids=chunk_ids, include=["metadatas"])
            found = dict(zip(got["ids"], got["metadatas"]))
    except Exception as error:
        raise HTTPException(503, f"Chunk lookup failed: {error}") from error
    results = []
    for id_ in request.ids:
        chunk = id_[2:] if id_[:2] in ("C:", "P:") else None
        meta = (found.get(chunk) or {}) if chunk in found else None
        if meta is None:
            results.append(
                {"id": id_, "exists": False, "doc_id": None, "status": None, "page_start": None}
            )
        else:
            results.append(
                {
                    "id": id_,
                    "exists": True,
                    "doc_id": meta.get("doc_id", id_[2:].rpartition(":")[0]),
                    "status": meta.get("status", "active"),
                    "page_start": meta.get("page_start"),
                }
            )
    return {"results": results}


@router.post("/sections/draft")
def draft_section(request: DraftSectionRequest) -> dict:
    if request.section_id not in TEMPLATE["sections"]:
        raise HTTPException(404, f"Section {request.section_id} is not in the report template")
    try:
        return draft(request.section_id, request.assessment, request.observations)
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


@router.post("/ofis/draft")
def draft_ofis(request: DraftOfisRequest) -> dict:
    """Draft Section 3 Opportunities for Improvement (GN-05) for the gateway to save."""
    try:
        return draft_ofis_for(request.assessment, request.observations, request.accepted)
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error

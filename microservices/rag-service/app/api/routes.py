from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.orchestrator.orchestrator import run
from app.retrieval.retriever import retrieve

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

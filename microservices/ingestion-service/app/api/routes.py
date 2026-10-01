from typing import Annotated, Literal

import pymupdf
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.pipeline.indexer import index_chunks, relabel

router = APIRouter()


class IngestRequest(BaseModel):
    filename: str


NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


# The labels every passage carries, so search can filter on them (KB-01).
class Labels(BaseModel):
    source_type: NonEmpty
    jurisdiction: NonEmpty
    facility_type: NonEmpty
    COPE_dimension: NonEmpty
    effective_date: NonEmpty
    # KB-02: retrieval skips withdrawn passages. The default keeps /index working without it.
    status: Literal["active", "withdrawn"] = "active"


class ChunkMetadata(Labels):
    document_id: NonEmpty
    page: int = Field(ge=1)


class IndexChunk(BaseModel):
    id: NonEmpty
    text: Annotated[NonEmpty, Field(max_length=8000)]
    metadata: ChunkMetadata


class IndexRequest(BaseModel):
    chunks: list[IndexChunk] = Field(min_length=1, max_length=96)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({chunk.id for chunk in self.chunks}) != len(self.chunks):
            raise ValueError("Chunk IDs must be unique within a request")
        return self


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "ingestion"}


@router.post("/ingest")
def ingest(request: IngestRequest) -> dict:
    """Accept a document for ingestion.

    The real work is `app.pipeline.run(file_path)`, which parses -> chunks ->
    anonymises -> indexes and is CPU-bound (minutes per document). It is not run
    inline here: this endpoint acknowledges the request so a caller/worker can
    invoke `run()` out of band. A future revision can enqueue `run()` on a
    background worker and expose job status; that reuses `run()` unchanged.
    """
    return {"status": "queued", "file": request.filename}


@router.post("/inspect")
async def inspect(request: Request) -> dict:
    """Open an uploaded PDF so the gateway can reject one that cannot be ingested.

    Returns the page count, or 422 with the reason shown to the admin (IN-01).
    Called by the gateway (server/src/services/ingestion.service.ts) before it
    stores anything; saves nothing itself.
    """
    try:
        doc = pymupdf.open(stream=await request.body(), filetype="pdf")
    except Exception as error:
        raise HTTPException(422, "The file is not a valid PDF and cannot be opened.") from error
    with doc:
        if doc.needs_pass:
            raise HTTPException(422, "The PDF is password-protected.")
        if doc.page_count == 0:
            raise HTTPException(422, "The PDF has no pages.")
        return {"pages": doc.page_count}


@router.post("/index")
def index(request: IndexRequest) -> dict:
    """Internal dev endpoint for pre-anonymised chunks, not raw documents."""
    count = index_chunks([chunk.model_dump() for chunk in request.chunks])
    return {"status": "indexed", "chunks_indexed": count}


@router.put("/documents/{doc_id}/labels")
def relabel_document(doc_id: str, labels: Labels) -> dict:
    """Put a corrected document's labels on all its passages (KB-01).

    Called by the gateway (server/src/services/knowledge-document.service.ts)
    after the admin saves a correction; returns how many passages changed.
    """
    return {"passagesUpdated": relabel(doc_id, labels.model_dump())}

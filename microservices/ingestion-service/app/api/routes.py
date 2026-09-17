from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.pipeline.indexer import index_chunks

router = APIRouter()


class IngestRequest(BaseModel):
    filename: str


NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ChunkMetadata(BaseModel):
    document_id: NonEmpty
    source_type: NonEmpty
    jurisdiction: NonEmpty
    facility_type: NonEmpty
    COPE_dimension: NonEmpty
    effective_date: NonEmpty
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


@router.post("/index")
def index(request: IndexRequest) -> dict:
    """Internal dev endpoint for pre-anonymised chunks, not raw documents."""
    count = index_chunks([chunk.model_dump() for chunk in request.chunks])
    return {"status": "indexed", "chunks_indexed": count}

import io
import json
from typing import Annotated, Literal

import pymupdf
from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, Field, StringConstraints, model_validator

from app import extract_text, manual, matching, usage, worker
from app.labelling import label_pdf
from app.matching import comparison_rows, find_match
from app.pipeline.chunking_helper import ocr_model
from app.pipeline.indexer import index_chunks, relabel

router = APIRouter()


class IngestRequest(BaseModel):
    filename: str


NonEmpty = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


# The labels a relabel may change (KB-01). Each detail is optional: an Unconfirmed
# detail is not sent, and the passage keeps the value it has (IN-05). No
# section: each passage keeps its own, set at ingest (IN-05 AC11).
class Labels(BaseModel):
    source_type: NonEmpty | None = None
    jurisdiction: NonEmpty | None = None
    facility_type: NonEmpty | None = None
    effective_date: NonEmpty | None = None
    # KB-01/IN-05: retrieval skips withdrawn and needs_review passages.
    status: Literal["active", "withdrawn", "needs_review"] = "active"


# What /index requires of a passage: every label, including its own section.
class ChunkMetadata(BaseModel):
    source_type: NonEmpty
    jurisdiction: NonEmpty
    facility_type: NonEmpty
    section: NonEmpty
    effective_date: NonEmpty
    status: Literal["active", "withdrawn"] = "active"
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


# A manual clause's screenshot (IN-18): where it is stored and what it shows.
class ManualImage(BaseModel):
    key: NonEmpty
    kind: Literal["table", "formula", "picture"]


# One clause of a manually entered standard (IN-18), as the gateway stores it in
# `manual_sections`. `seq` is its fixed number (passage ids), `order` its place in the list.
class ManualSection(BaseModel):
    seq: int = Field(ge=1)
    order: int = Field(ge=0)
    clause: NonEmpty
    headings: list[NonEmpty] = Field(default_factory=list, max_length=20)
    text: Annotated[NonEmpty, Field(max_length=200_000)]
    images: list[ManualImage] = Field(default_factory=list, max_length=20)


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


def open_pdf(body: bytes) -> int:
    """Return the page count of a PDF, or raise 422 with the reason shown to the admin."""
    try:
        doc = pymupdf.open(stream=body, filetype="pdf")
    except Exception as error:
        raise HTTPException(422, "The file is not a valid PDF and cannot be opened.") from error
    with doc:
        if doc.needs_pass:
            raise HTTPException(422, "The PDF is password-protected.")
        if doc.page_count == 0:
            raise HTTPException(422, "The PDF has no pages.")
        return doc.page_count


@router.post("/inspect")
async def inspect(request: Request) -> dict:
    """Open an uploaded PDF so the gateway can reject one that cannot be ingested.

    Returns the page count, or 422 with the reason shown to the admin (IN-01).
    Called by the gateway (server/src/services/ingestion.service.ts) before it
    stores anything; saves nothing itself.
    """
    return {"pages": open_pdf(await request.body())}


@router.post("/label")
async def label(
    file: Annotated[UploadFile, File()], privacy: Annotated[str | None, Form()] = None
) -> dict:
    """Read a PDF's details (type, title, edition, date, country, facility) with models.

    Returns each detail's value, confidence and evidence, the Unconfirmed list and
    per-call usage (IN-05). Called by the gateway (server/src/services/ingestion.service.ts)
    during upload, with the PDF and its privacy settings (`{enabled, known_entities, detect?}`
    as JSON, PV-05); saves nothing. Model problems give a 200 with everything Unconfirmed.
    """
    body = await file.read()
    open_pdf(body)
    # In a thread: OCR and model calls would block the event loop.
    return await run_in_threadpool(label_pdf, body, json.loads(privacy) if privacy else None)


@router.post("/index")
def index(request: IndexRequest) -> dict:
    """Internal dev endpoint for pre-anonymised chunks, not raw documents."""
    count = index_chunks([chunk.model_dump() for chunk in request.chunks])
    return {"status": "indexed", "chunks_indexed": count}


# A screenshot bigger than this is refused (IN-18); a clause's table is far smaller.
MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024


def screenshot_png(body: bytes) -> bytes:
    """Return the screenshot as PNG bytes, or raise 422 if it is not a readable image."""
    if len(body) > MAX_SCREENSHOT_BYTES:
        raise HTTPException(422, "The image is over 10 MB. Crop it to the table or figure.")
    try:
        with Image.open(io.BytesIO(body)) as image:
            image.load()
            out = io.BytesIO()
            image.convert("RGB").save(out, format="PNG")
            return out.getvalue()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError) as error:
        raise HTTPException(422, "The file is not an image that can be read.") from error


def read_screenshot(png: bytes, kind: str, context: str, doc_id: str) -> tuple[str | None, list]:
    """OCR one screenshot, collecting its usage in this thread; returns the text and usage."""
    with usage.collecting(doc_id) as used:
        text = ocr_model.recognise(png, kind, context)
    return text, used


@router.post("/recognise")
async def recognise(
    file: Annotated[UploadFile, File()],
    kind: Annotated[Literal["table", "formula", "picture"], Form()],
    document_id: Annotated[NonEmpty, Form(alias="documentId")],
    context: Annotated[str, Form(max_length=2000)] = "",
) -> dict:
    """Read a manual clause's screenshot with OCR_PROVIDER (IN-18); saves nothing.

    A table comes back as records, a formula as LaTeX, a picture as a description (with the
    clause's heading trail as context). The admin checks the text before the clause is saved.
    Returns the usage for the gateway to record against `documentId` (EV-03), as /label does.
    """
    png = screenshot_png(await file.read())
    # In a thread: the model call would block the event loop.
    text, used = await run_in_threadpool(read_screenshot, png, kind, context, document_id)
    if not text:
        raise HTTPException(502, "The image couldn't be read. Try again, or type the text in.")
    return {"text": text, "usage": used}


@router.put("/documents/{doc_id}/labels")
def relabel_document(doc_id: str, labels: Labels) -> dict:
    """Put a corrected document's labels on all its passages (KB-01).

    Called by the gateway (server/src/services/knowledge-document.service.ts)
    after the admin saves a correction; returns how many passages changed.
    """
    return {"passagesUpdated": relabel(doc_id, labels.model_dump(exclude_none=True))}


def stored_document(doc_id: str) -> dict:
    """Return the `knowledge_documents` record, or raise 404 if there is none."""
    try:
        found = worker.documents().find_one({"_id": ObjectId(doc_id)})
    except InvalidId:
        found = None
    if found is None:
        raise HTTPException(404, "Document not found.")
    return found


@router.post("/documents/{doc_id}/match")
def match_document(doc_id: str) -> dict:
    """Re-check a document for a copy or another edition (IN-07); returns its new match.

    Saves `match` on the record and relabels the passages to the final status.
    Called by the gateway after a details correction or a discard.
    """
    doc = stored_document(doc_id)
    if doc.get("status") != "complete":
        # Without this, a half-ingested document could be matched and relabelled.
        raise HTTPException(409, "The document has not finished ingesting.")
    match = find_match(doc, worker.documents())
    worker.documents().update_one({"_id": doc["_id"]}, {"$set": {"match": match}})
    worker.relabel_passages({**doc, "match": match})
    return {"match": {**match, "documentId": str(match["documentId"])} if match else None}


def manual_document(doc_id: str) -> dict:
    """Return a manually entered document, or raise 404 / 409 (an uploaded one takes no clauses)."""
    doc = stored_document(doc_id)
    if doc.get("entryMethod") != "manual":
        raise HTTPException(409, "Only a manually entered document has clauses to change.")
    return doc


@router.put("/documents/{doc_id}/manual-sections/{section_id}")
def save_manual_section(doc_id: str, section_id: str, section: ManualSection) -> dict:
    """Index one clause of a manual document, replacing its passages (IN-18).

    Called by the gateway after it saves the clause to `manual_sections`. Synchronous: one
    clause is one embedding call. Returns how many passages it has, and the embedding's
    usage for the gateway to record (EV-03), as /label does.
    """
    doc = manual_document(doc_id)
    with usage.collecting(doc_id) as used:
        count = manual.save(doc, {**section.model_dump(), "section_id": section_id})
    return {"passagesIndexed": count, "usage": used}


@router.delete("/documents/{doc_id}/manual-sections/{section_id}")
def delete_manual_section(doc_id: str, section_id: str) -> dict:
    """Delete one clause's passages from the search index (IN-18); returns how many."""
    manual_document(doc_id)
    return {"passagesDeleted": manual.delete(doc_id, section_id)}


@router.get("/documents/{doc_id}/clauses")
def document_clauses(doc_id: str) -> dict:
    """A document's text grouped into clauses, to start a new manual edition from (IN-18).

    Reads the index only; the gateway copies the clauses into the new draft, unchecked.
    """
    stored_document(doc_id)
    return {"clauses": manual.clauses(doc_id)}


@router.delete("/documents/{doc_id}/passages")
def delete_passages(doc_id: str) -> dict:
    """Delete a document's passages from the search index; returns how many (IN-07)."""
    collection = matching.passages_collection()
    ids = collection.get(where={"doc_id": doc_id}, include=[])["ids"] if collection else []
    if ids:
        collection.delete(ids=ids)
    return {"passagesDeleted": len(ids)}


@router.get("/documents/{doc_id}/passages")
def list_passages(
    doc_id: str,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    chapter: str | None = None,
    section: str | None = None,
    page_from: Annotated[int | None, Query(alias="pageFrom", ge=1)] = None,
    page_to: Annotated[int | None, Query(alias="pageTo", ge=1)] = None,
    ids: Annotated[list[str] | None, Query()] = None,
) -> dict:
    """Return one page of a document's passages in reading order, the total and its outline (IN-17).

    Filters by the outline's chapter and section, by a page range (passages that overlap
    it) and by `ids`, a search's ranked results, kept in that order. Reads the index only: an
    unknown document has no passages. The gateway checks the document exists.
    """
    if page_from is not None and page_to is not None and page_from > page_to:
        raise HTTPException(422, "The page range ends before it starts.")
    if ids is not None and len(ids) > 50:
        raise HTTPException(422, "At most 50 passage ids can be listed at once.")
    return matching.document_passages(
        doc_id, offset, limit, chapter, section, page_from, page_to, ids
    )


@router.get("/documents/{doc_id}/comparison/{other_id}")
def comparison(doc_id: str, other_id: str) -> dict:
    """Return the two documents' passages side by side, new document first (IN-07)."""
    stored_document(doc_id)
    stored_document(other_id)
    return {"rows": comparison_rows(doc_id, other_id)}


# CP-23: reads an uploaded file into plain text for the gateway, and lists the email
# attachments it couldn't read with the reason. Writes nothing.
@router.post("/extract-text")
async def extract_text_route(request: Request, filename: str):
    data = await request.body()
    try:
        documents, failed = await run_in_threadpool(extract_text.extract_documents, filename, data)
    except extract_text.UnsupportedType:
        raise HTTPException(415, "Only PDF, Word (.docx) and email (.eml, .msg) files can be read.")
    except extract_text.Unreadable as err:
        raise HTTPException(422, str(err))
    return {"documents": documents, "failed": failed}

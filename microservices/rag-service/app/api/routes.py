from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.chat.answer import answer_events
from app.generation.generator import TEMPLATE
from app.generation.llm import GenerationFailed
from app.orchestrator.orchestrator import draft, draft_ofis_for, draft_summary_for, run
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


class Assessment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reference: str
    jurisdiction: str
    facility_type: str


# One site observation as the gateway sends it, with only its finished voice transcripts.
class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    # Its COPE categories, one or more. A single string, as eval cases and gateways
    # from before an observation could have several send, reads as a list of one.
    COPE_dimension: Annotated[list[str], Field(min_length=1)]
    note: str | None = None
    transcripts: list[str] = []
    severity: str | None = None
    location: str | None = None
    standard: str | None = None

    @field_validator("COPE_dimension", mode="before")
    @classmethod
    def _one_category_as_list(cls, value):
        return [value] if isinstance(value, str) else value


class DraftOfisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment: Assessment
    observations: list[Observation] = []
    # Titles of OFIs the engineer already accepted, so they aren't proposed again.
    accepted: list[str] = []


# One finding of the saved draft, with the engineer's decision on it (RV-02).
class CurrentStatement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    heading: str
    text: str
    decision: Literal["pending", "accepted", "edited", "rejected"]


# A regenerated draft (RV-02): the saved draft's findings and decisions, and what the
# engineer asked to change, if anything.
Instruction = Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]


class Redraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    instruction: Instruction | None = None
    current: list[CurrentStatement] = []


class DraftSectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_id: str
    assessment: Assessment
    observations: list[Observation] = Field(min_length=1)
    redraft: Redraft | None = None


# One report section as the gateway sends it for the Executive Summary: its text, flattened.
class ReportSectionText(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    text: str


class DraftSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment: Assessment
    sections: list[ReportSectionText] = Field(min_length=1)


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
            }
            for section_id, section in TEMPLATE["sections"].items()
        ],
    }


@router.post("/sections/draft")
def draft_section(request: DraftSectionRequest) -> dict:
    if request.section_id not in TEMPLATE["sections"]:
        raise HTTPException(404, f"Section {request.section_id} is not in the report template")
    try:
        return draft(request.section_id, request.assessment, request.observations, request.redraft)
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


@router.post("/ofis/draft")
def draft_ofis(request: DraftOfisRequest) -> dict:
    """Draft Section 3 Opportunities for Improvement (GN-05) for the gateway to save."""
    try:
        return draft_ofis_for(request.assessment, request.observations, request.accepted)
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


@router.post("/summary/draft")
def draft_summary(request: DraftSummaryRequest) -> dict:
    """Draft Section 2's Executive Summary (GN-07) from the sections the gateway sends."""
    try:
        return draft_summary_for(request.assessment, request.sections)
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


# One message as OpenUI's chat screen sends it. Its content is text for the
# engineer's own messages; other roles' may carry tool calls, so stay loose.
class ChatMessage(BaseModel):
    role: str
    content: str | list | None = None


# One piece of extra context (AG-UI's shape), e.g. a remembered fact (CB-05).
class ChatContext(BaseModel):
    description: str = ""
    value: str


# The body OpenUI's fetchLLM posts. Unknown fields are ignored, not refused,
# since OpenUI adds its own (threadId, runId, tools).
class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    messages: Annotated[list[ChatMessage], Field(min_length=1)]
    context: list[ChatContext] = []


@router.post("/chat")
def chat(request: ChatRequest) -> StreamingResponse:
    """Stream one cited answer to the conversation's last message (CB-01)."""
    messages = [m.model_dump() for m in request.messages]
    events = answer_events(messages, [c.value for c in request.context])
    return StreamingResponse(events, media_type="text/event-stream")

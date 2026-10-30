from typing import Annotated, Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.chat.answer import answer_events
from app.chat.passages import get_passage
from app.generation.generator import TEMPLATE
from app.generation.llm import GenerationFailed
from app.generation.proposals import propose_figures
from app.orchestrator.orchestrator import (
    draft,
    draft_checklist_for,
    draft_ofis_for,
    draft_summary_for,
    run,
)
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


# One site observation as the gateway sends it, with only its finished voice transcripts and
# transcribed handwritten pages.
class Observation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    # Its COPE categories, one or more. A single string, as eval cases and gateways
    # from before an observation could have several send, reads as a list of one.
    COPE_dimension: Annotated[list[str], Field(min_length=1)]
    note: str | None = None
    transcripts: list[str] = []
    # Pages of the engineer's handwritten notes, transcribed word for word (CP-19).
    handwriting: list[str] = []
    severity: str | None = None
    location: str | None = None
    standard: str | None = None

    @field_validator("COPE_dimension", mode="before")
    @classmethod
    def _one_category_as_list(cls, value):
        return [value] if isinstance(value, str) else value

    def recorded(self) -> list[str]:
        """Everything the engineer recorded, in order: note, voice transcripts, handwritten pages.

        What searches and checks read of an observation, so a new kind of capture reaches them
        all at once.
        """
        return [text for text in (self.note, *self.transcripts, *self.handwriting) if text]


# PII protection (PV-02 Rule 1): the gateway decides whether it is on, and lists the
# assessment's client, site, address and staff names. Without it, nothing is masked.
class KnownEntity(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str
    names: Annotated[list[str], Field(min_length=1)]


class Privacy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool
    known_entities: list[KnownEntity] = []


def _privacy(request) -> dict | None:
    return request.privacy.model_dump() if request.privacy else None


class DraftOfisRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment: Assessment
    observations: list[Observation] = []
    # Titles of OFIs the engineer already accepted, so they aren't proposed again.
    accepted: list[str] = []
    privacy: Privacy | None = None


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
    # Sections 4 and 5 (GN-03): the engineer's figures and the gateway's results, as
    # lines of text, for the model to use unchanged.
    # Bounded by the gateway's schema: 60 value rows, each listed once per level.
    facts: Annotated[str, Field(max_length=40000)] | None = None
    privacy: Privacy | None = None


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
    privacy: Privacy | None = None


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
        return draft(
            request.section_id,
            request.assessment,
            request.observations,
            request.redraft,
            request.facts,
            privacy=_privacy(request),
        )
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


@router.post("/ofis/draft")
def draft_ofis(request: DraftOfisRequest) -> dict:
    """Draft Section 3 Opportunities for Improvement (GN-05) for the gateway to save."""
    try:
        return draft_ofis_for(
            request.assessment,
            request.observations,
            request.accepted,
            privacy=_privacy(request),
        )
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


@router.post("/summary/draft")
def draft_summary(request: DraftSummaryRequest) -> dict:
    """Draft Section 2's Executive Summary (GN-07) from the sections the gateway sends."""
    try:
        return draft_summary_for(request.assessment, request.sections, privacy=_privacy(request))
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


# One knowledge-base standard the engineer kept in scope for a checklist (CP-30 AC1-2).
class ScopeStandard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    source_type: str
    standard_number: str | None = None


# Only the facility type and country: a checklist is about the kind of site, so no client
# detail is sent and nothing needs masking.
class DraftChecklistRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    facility_type: str
    jurisdiction: str
    standards: list[ScopeStandard] = []


@router.post("/checklist/draft")
def draft_checklist(request: DraftChecklistRequest) -> dict:
    """Generate a pre-survey checklist (CP-30) for the gateway to save."""
    try:
        return draft_checklist_for(request.facility_type, request.jurisdiction, request.standards)
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


# Proposed figures for Section 4 or 5 (GN-03 addendum): the observations, the drafted
# sections' text, and for Section 5 the business interruption items to estimate.
class ProposeFiguresRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_id: Literal["4", "5"]
    assessment: Assessment
    observations: list[Observation] = Field(min_length=1)
    sections: list[ReportSectionText] = []
    te_items: list[str] = []


@router.post("/figures/propose")
def propose(request: ProposeFiguresRequest) -> dict:
    """Propose Section 4's scores or Section 5's per-level inputs for the engineer to confirm."""
    try:
        return propose_figures(
            request.section_id,
            request.assessment,
            request.observations,
            request.sections,
            request.te_items,
        )
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


# A knowledge document's details, sent by the gateway (never trusted from the browser)
# so the answer model can name each passage's document.
class ChatDocument(BaseModel):
    id: str
    title: str
    issuingBody: str | None = None
    standardNumber: str | None = None
    edition: str | None = None


# The body OpenUI's fetchLLM posts. Unknown fields are ignored, not refused,
# since OpenUI adds its own (threadId, runId, tools).
class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    messages: Annotated[list[ChatMessage], Field(min_length=1)]
    context: list[ChatContext] = []
    documents: list[ChatDocument] = []
    # The signed-in user's role, set by the gateway; shapes the "not covered" offer.
    role: str = "risk_engineer"
    # Set by the gateway (PV-03), never by the browser.
    privacy: Privacy | None = None


@router.post("/chat")
def chat(request: ChatRequest) -> StreamingResponse:
    """Stream one cited answer to the conversation's last message (CB-01)."""
    messages = [m.model_dump() for m in request.messages]
    documents = [d.model_dump() for d in request.documents]
    context = [c.value for c in request.context]
    events = answer_events(messages, context, documents, request.role, privacy=_privacy(request))
    return StreamingResponse(events, media_type="text/event-stream")


@router.get("/passages/{passage_id}")
def passage(passage_id: str) -> dict:
    """Return one passage's text and page boxes for the citation panel (CB-02)."""
    found = get_passage(passage_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Passage not found.")
    return found

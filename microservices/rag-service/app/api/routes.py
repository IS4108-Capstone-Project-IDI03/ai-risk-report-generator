import logging
import time
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app import config, usage
from app.assistant.coverage import check_coverage
from app.assistant.wording import word_messages
from app.chat.answer import answer_events
from app.chat.passages import get_passage
from app.client_insights.summary import summarise_client
from app.client_intake.read import read_client_intake
from app.comparison.compare import compare_reports
from app.generation import llm
from app.generation.generator import TEMPLATE
from app.generation.llm import GenerationFailed
from app.generation.proposals import propose_figures
from app.orchestrator.orchestrator import (
    ask_events,
    draft,
    draft_checklist_for,
    draft_ofis_for,
    draft_summary_for,
    run,
)
from app.privacy import PrivacyUnavailable
from app.privacy import session as privacy_session
from app.retrieval.keyword_search import search_passages
from app.retrieval.retriever import retrieve
from app.retrieval_config import EMBEDDING_MODEL, chroma_client, cohere_client
from app.site_walk.kind_suggest import suggest_kinds
from app.site_walk.observation_rate import rate_observation
from app.site_walk.propose import propose_site_walk

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
    # The engineer's own recommendations from a split note (CP-35 hand-off); sent only for OFI
    # drafting, which bases its fix on them. Client text, so masked like the note.
    recommendations: list[str] = []

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
    # Kinds privacy-service also finds on its own (CP-23 client intake only).
    detect: list[Literal["CLIENT", "SITE"]] = []
    # PV-09: the admin's Never masked words, passed on to /mask. None (left out) until the gateway
    # has seeded the list, so privacy-service uses its own file; [] would mean none at all.
    never_masked: list[str] | None = None


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


class _Ping(BaseModel):
    ok: bool


def _ping_llm() -> None:
    # The drafting path: LLM_PROVIDER, and the admin's model from the X-Model header.
    llm.complete("Answer with ok true.", "ok?", _Ping, "low", feature="walkthrough")


def _ping_chat() -> None:
    llm.complete_json(
        "Answer with ok true.",
        "ok?",
        _Ping,
        provider=config.CHAT_PROVIDER,
        model=config.CHAT_MODEL,
        effort=config.CHAT_EFFORT,
        feature="walkthrough",
    )


def _ping_search() -> None:
    # Chat's and Ask's search: Chroma must answer and Cohere must embed. One fixed word, no
    # reranking (that is the costly call), nothing from any user.
    chroma_client().heartbeat()
    started = time.perf_counter()
    response = cohere_client().embed(
        model=EMBEDDING_MODEL,
        texts=["ping"],
        input_type="search_query",
        embedding_types=["float"],
        truncate="NONE",
    )
    usage.record(
        "walkthrough",
        "cohere-embed",
        EMBEDDING_MODEL,
        started,
        input_tokens=usage.billed(response, "input_tokens"),
    )


def _ping_privacy() -> None:
    httpx.get(f"{config.PRIVACY_SERVICE_URL}/health", timeout=5).raise_for_status()


_PINGS = {
    "llm": _ping_llm,
    "chat": _ping_chat,
    "search": _ping_search,
    "privacy": _ping_privacy,
}


@router.get("/health/providers")
def health_providers(need: Literal["llm", "chat", "search", "privacy"]) -> dict:
    """Make one tiny real request for one thing a walkthrough's try-it needs (F-12).

    `llm` is the drafting model, `chat` the chat model, `search` the embedding search and
    `privacy` privacy-service. Sends a fixed word, never user text. Returns `ok` and the
    paid call's `usage`, for the gateway to record; a failure is `ok: false`, not an error.
    """
    calls = usage.start()
    try:
        _PINGS[need]()
    except Exception:
        logging.getLogger("uvicorn.error").exception("Provider check %r failed", need)
        return {"ok": False, "usage": calls}
    return {"ok": True, "usage": calls}


@router.post("/generate")
def generate_report(request: GenerateRequest) -> dict:
    return run(request.query)


@router.post("/retrieve")
def retrieve_chunks(request: RetrieveRequest) -> dict:
    # Calls the retriever directly — used by the evaluation harness.
    return {"results": retrieve(request.query, request.filters.model_dump(exclude_none=True))}


@router.get("/sections")
def list_sections() -> dict:
    # The template's sections and what each needs, so the gateway doesn't keep its own copy. Each
    # lists its parts too (AS-08), so the gateway can say which have no text or read Not entered.
    return {
        "sections": [
            {
                "id": section_id,
                "title": section["title"],
                "cope_dimensions": section["cope_dimensions"],
                "min_observations": section["min_observations"],
                "subsections": [
                    {
                        "heading": sub["heading"],
                        "kind": sub["kind"],
                        **({"fields": sub["fields"]} if sub.get("fields") else {}),
                    }
                    for sub in section["subsections"]
                ],
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


# A site walk (CP-22), as the gateway's site-walk-proposal worker sends it. Must match the
# rag-service section of .local-docs/specs/sprint-4/CP-22-contract.md.
class Segment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: float
    end: float
    text: str


class WalkRecording(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seq: int
    # How long the recording lasts; without it, its last segment's end stands in.
    duration_sec: float | None = None
    segments: list[Segment]


# A note typed during a recorded walk: it takes the next seq, like a recording, so the walk
# is read in the order it was made. It has no times, so nothing of it can be played.
class WalkNote(BaseModel):
    model_config = ConfigDict(extra="forbid")
    seq: int
    kind: Literal["typed"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class RecordedWalk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["recordings"]
    recordings: Annotated[list[WalkRecording | WalkNote], Field(min_length=1)]


class TypedWalk(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["typed"]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class ExistingLocation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    building: str | None = None
    floor: str | None = None
    name: str


# A photo taken during the walk, with S5's description of it (/describe-photo).
class WalkPhoto(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    recording_seq: int | None = None
    offset_sec: float | None = None
    description: str | None = None


class ProposeSiteWalkRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    report_id: str
    transcript: Annotated[RecordedWalk | TypedWalk, Field(discriminator="kind")]
    existing_locations: list[ExistingLocation] = []
    photos: list[WalkPhoto] = []
    # The assessment's site name: the building when the walk names levels but no building.
    site_name: str | None = None
    privacy: Privacy | None = None


@router.post("/site-walks/propose")
def propose_site_walk_route(request: ProposeSiteWalkRequest) -> dict:
    """Propose a site walk's locations and observations (CP-22) for the engineer to review."""
    try:
        return propose_site_walk(
            request.transcript,
            request.existing_locations,
            request.photos,
            _privacy(request),
            request.site_name,
        )
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


class RateObservationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # The note, transcripts, page text and photo description, joined by blank lines.
    text: Annotated[str, Field(min_length=1)]
    privacy: Privacy | None = None


@router.post("/observations/rate")
def rate_observation_route(request: RateObservationRequest) -> dict:
    """Suggest a category and severity for one observation (CP-24), with not-sure flags."""
    try:
        rated = rate_observation(request.text, _privacy(request))
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error
    rated.pop("probabilities")
    return rated


# A client intake (CP-23), as the gateway sends it once each file's text is out. Must match
# the rag-service section of the CP-23 contract (.local-docs/specs/sprint-4/CP-23/CP-23.md).
class IntakeDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    text: str


class RecordedSite(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    address: str | None = None
    has_assessments: bool = False


class RecordedClient(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str
    division: str | None = None
    sites: list[RecordedSite] = []


class Jurisdiction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    name: str


class ReadClientIntakeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    documents: Annotated[list[IntakeDocument], Field(min_length=1)]
    clients: list[RecordedClient] = []
    facility_types: list[str]
    jurisdictions: list[Jurisdiction]
    privacy: Privacy | None = None


@router.post("/client-intakes/read")
def read_client_intake_route(request: ReadClientIntakeRequest) -> dict:
    """Read a client's documents into a proposed client, sites and assessments (CP-23)."""
    try:
        return read_client_intake(
            request.documents,
            request.clients,
            request.facility_types,
            request.jurisdictions,
            _privacy(request),
        )
    # 503, not 502: the gateway tells the engineer client details couldn't be protected (AC19).
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


# One figure the gateway counted (CP-29), as lines of text the model may cite by `label`.
class InsightFigure(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    title: str
    lines: Annotated[list[str], Field(min_length=1)]


# One of the engineer's observations at the client's sites, cited by `label`.
class InsightObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    site: str
    location: str | None = None
    severity: str
    categories: list[str] = []
    date: str | None = None
    text: str


class ClientInsightsSummaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    client: str
    figures: Annotated[list[InsightFigure], Field(min_length=1)]
    observations: Annotated[list[InsightObservation], Field(min_length=1)]
    privacy: Privacy | None = None


@router.post("/client-insights/summary")
def client_insights_summary_route(request: ClientInsightsSummaryRequest) -> dict:
    """Write a short cited summary of a client's insights (CP-29), every statement checked."""
    try:
        return summarise_client(
            request.client, request.figures, request.observations, _privacy(request)
        )
    # 503, not 502: the gateway tells the engineer client details couldn't be protected.
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


# One previous report item, or one piece of current evidence, as the comparison (RV-13) is
# given it: cited by `label` (P1 for the previous report; O1, F1, R1 for the current
# assessment's observations, draft findings and draft recommendations).
class ComparedItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    kind: Literal["finding", "recommendation", "observation"]
    section: str
    title: str | None = None
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    severity: str | None = None
    priority: str | None = None
    categories: list[str] = []
    location: str | None = None


class CompareReportsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    previous: Annotated[list[ComparedItem], Field(min_length=1)]
    current: Annotated[list[ComparedItem], Field(min_length=1)]
    privacy: Privacy | None = None


@router.post("/comparison/compare")
def compare_reports_route(request: CompareReportsRequest) -> dict:
    """Suggest an outcome for each previous report item (RV-13); the gateway decides the rest."""
    try:
        return compare_reports(request.previous, request.current, _privacy(request))
    # 503, not 502: the gateway tells the engineer client details couldn't be protected.
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
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
    # RT-04: the document's source tier and its jurisdiction, set by the gateway.
    tier: str | None = None
    jurisdiction: str | None = None


# One page of a file attached to the chat (CB-09), sent by the gateway from what it stored.
class ChatAttachmentPage(BaseModel):
    page: int
    text: str


class ChatAttachment(BaseModel):
    id: str
    name: str
    pages: list[ChatAttachmentPage]


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
    # The files attached to this chat (CB-09), read from storage by the gateway.
    attachments: list[ChatAttachment] = []
    # RT-04: tier ids, highest authority first. Empty keeps the relevance order.
    tier_order: list[str] = []


@router.post("/chat")
def chat(request: ChatRequest) -> StreamingResponse:
    """Stream one cited answer to the conversation's last message (CB-01)."""
    messages = [m.model_dump() for m in request.messages]
    documents = [d.model_dump() for d in request.documents]
    context = [c.value for c in request.context]
    attachments = [a.model_dump() for a in request.attachments]
    events = answer_events(
        messages,
        context,
        documents,
        request.role,
        privacy=_privacy(request),
        attachments=attachments,
        tier_order=request.tier_order,
    )
    return StreamingResponse(events, media_type="text/event-stream")


# A search for a checklist item's reference (CP-32 AC2): the words to look for, in the
# standards the checklist was generated from.
class SearchPassagesRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: Query
    document_ids: Annotated[list[str], Field(min_length=1, max_length=50)]
    limit: Annotated[int, Field(ge=1, le=30)] = 10


@router.post("/passages/search")
def passage_search(request: SearchPassagesRequest) -> dict:
    """Return the documents' passages that best match the words, best first (CP-32)."""
    return {"results": search_passages(request.query, request.document_ids, request.limit)}


# One knowledge document searched by meaning in the knowledge base's Passages view (IN-17).
class MeaningSearchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: Query
    document_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    limit: Annotated[int, Field(ge=1, le=30)] = 20
    privacy: Privacy | None = None


# Candidates read from Chroma before reranking: twice what is kept, so the reranker chooses.
MEANING_CANDIDATES = 40


@router.post("/passages/meaning")
def passage_meaning(request: MeaningSearchRequest) -> dict:
    """Return one document's active passages ranked by meaning, best first (IN-17): one Cohere
    embedding and one rerank, as chat's search.

    With protection on, the query reaches Cohere masked, and so do the passages the reranker
    reads (a past report's restored words are masked again), as in chat (PV-03, PV-05).
    `usage` lists the paid calls, for the gateway to record (EV-03).
    """
    calls = usage.start()
    protection = privacy_session(_privacy(request))
    masking = {"rank_texts": protection.mask, "protection": protection}
    try:
        query = protection.mask([request.query])[0] if protection.enabled else request.query
        hits = retrieve(
            query,
            {"doc_id": [request.document_id]},
            candidates=MEANING_CANDIDATES,
            top_n=request.limit,
            **(masking if protection.enabled else {}),
        )
    # Fail closed: nothing reached Cohere unmasked. 503 so the gateway says why.
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
    return {"results": [{"id": hit["id"]} for hit in hits], "usage": calls}


# An observation as the Ask tab sends it (AS-01): any of the assessment's, categorised or not,
# since a question is not about one section's categories. Uncategorised is null (CP-02).
class AskObservation(Observation):
    COPE_dimension: list[str] | None = None


# A knowledge document's name for the prompt, sent by the gateway (never by the browser).
class AskDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    name: str


Question = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]


# A standard's or past report's passage that a selected passage cites (AS-02), as the draft
# was given it: its chunk id, words and Chroma labels, read by the gateway from the draft.
class AskPassageSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    kind: Literal["standard", "report"]
    text: Annotated[str, StringConstraints(max_length=20_000)]
    metadata: dict = {}


# One of the section's findings still in the draft, with the engineer's decision on it, its
# citations (O:/C:/P: refs) and whether the selected passage is in it.
class AskFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(max_length=5000)]
    state: Literal["pending", "accepted", "edited"]
    citations: Annotated[list[str], Field(max_length=50)] = []
    in_passage: bool = False


# Text the engineer selected in the draft to ask about (AS-02): its section, as the report
# heads it ("9. Fire Protection"), its words (the citation markers left out), the sources it
# cites and the section's findings.
class AskPassage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_id: Annotated[str, StringConstraints(pattern=r"^(1[0-2]|[1-9]|A)$")]
    section_title: Annotated[str, StringConstraints(max_length=200)]
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4000)]
    citations: Annotated[list[str], Field(max_length=50)] = []
    sources: Annotated[list[AskPassageSource], Field(max_length=50)] = []
    findings: Annotated[list[AskFinding], Field(max_length=200)] = []


# A subsection of the section that drafted text can go in (AS-04): its index in the section,
# as the gateway counts them, and its heading.
class AskSubsection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: Annotated[int, Field(ge=-1, le=50)]
    heading: Annotated[str, StringConstraints(max_length=300)]


# Text for one of Sections 4 to 12 instead of an answer (AS-04): new text to insert ("draft"),
# with the subsections it can go in, or a rewrite of the request's passage ("rewrite"), whose
# words are then the paragraphs to rewrite.
class AskPropose(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["draft", "rewrite"]
    section_id: Annotated[str, StringConstraints(pattern=r"^(1[0-2]|[4-9])$")]
    section_title: Annotated[str, StringConstraints(max_length=200)]
    subsections: Annotated[list[AskSubsection], Field(max_length=50)] = []


# Writing guidance for one of Sections 4 to 12 instead of an answer (AS-08): what the section
# should cover, from the report template's definition of it and the selected standards. The
# section as the report heads it ("9. Fire Protection"). ("What is missing" needs no model: the
# gateway lists it.)
class AskGuide(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["cover"]
    section_id: Annotated[str, StringConstraints(pattern=r"^(1[0-2]|[4-9])$")]
    section_title: Annotated[str, StringConstraints(max_length=200)]


class AskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: Question
    assessment: Assessment
    observations: list[AskObservation] = []
    # The standards selected on the assessment, as the gateway read them from
    # knowledge_documents (AC3): only their passages are searched. For a proposal (AS-04)
    # they are its drafting set, the only standards it may cite.
    standard_ids: list[str] = []
    documents: list[AskDocument] = []
    privacy: Privacy | None = None
    passage: AskPassage | None = None
    propose: AskPropose | None = None
    guide: AskGuide | None = None

    @model_validator(mode="after")
    def _rewrite_has_passage(self):
        if self.propose and self.propose.kind == "rewrite" and self.passage is None:
            raise ValueError("A rewrite needs the passage to rewrite.")
        if self.guide and (self.passage or self.propose):
            raise ValueError("Writing guidance is asked on its own.")
        return self


@router.post("/assessments/ask")
def ask_assessment(request: AskRequest) -> StreamingResponse:
    """Stream one cited answer to a question about an assessment (AS-01), or about a passage
    selected in its draft (AS-02), or text proposed for a section (AS-04), or what a section
    should cover (AS-08), through the orchestrator: retrieve, assemble, generate, guardrail. Its
    last event is the result."""
    events = ask_events(
        request.question,
        request.assessment,
        request.observations,
        request.standard_ids,
        {d.id: d.name for d in request.documents},
        privacy=_privacy(request),
        passage=request.passage,
        propose=request.propose,
        guide=request.guide,
    )
    return StreamingResponse(events, media_type="text/event-stream")


@router.get("/passages/{passage_id}")
def passage(passage_id: str) -> dict:
    """Return one passage's text and page boxes for the citation panel (CB-02)."""
    found = get_passage(passage_id)
    if found is None:
        raise HTTPException(status_code=404, detail="Passage not found.")
    return found


# MarshBot's coverage check (AS-06): the checklist and the observations, to find the items
# nothing covers and the observations too thin for their section. Uncategorised observations
# (no COPE_dimension) are left out by the gateway, as for drafting.
class CoverageItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    area: str
    text: str


class CoverageSection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section_id: str
    title: str
    cope_dimensions: list[str]


class AssistantCoverageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assessment: Assessment
    checklist: list[CoverageItem]
    observations: list[Observation] = []
    sections: list[CoverageSection]
    privacy: Privacy | None = None


@router.post("/assistant/coverage")
def assistant_coverage(request: AssistantCoverageRequest) -> dict:
    """Find the checklist items no observation covers and the observations too thin (AS-06)."""
    try:
        return check_coverage(request, privacy=_privacy(request))
    # 503, not 502: the gateway can tell client details couldn't be protected.
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


# MarshBot's wording (AS-06): the rules' messages and the items they point at. `parts` are
# the gateway's MessagePart objects (server/src/services/assistant/types.ts), passed through.
class WordingViewer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    first_name: str
    role: Literal["engineer", "admin"]


class WordingMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    text: str
    parts: list[dict] = []


class WordingItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    title: str
    detail: str | None = None
    kind: str
    weight: Literal["fix_now", "gap", "reminder", "info"]


class AssistantWordingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    viewer: WordingViewer
    messages: list[WordingMessage]
    items: list[WordingItem] = []
    privacy: Privacy | None = None


@router.post("/assistant/wording")
def assistant_wording(request: AssistantWordingRequest) -> dict:
    """Reword MarshBot's messages as OpenUI programs that point at items by id (AS-06)."""
    try:
        return word_messages(request, privacy=_privacy(request))
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error


class SuggestKindsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, Field(min_length=1, max_length=5000)]
    privacy: Privacy | None = None


@router.post("/suggest-kinds")
def suggest_kinds_route(request: SuggestKindsRequest) -> dict:
    """Suggest the kinds an observation's text holds (CP-36)."""
    try:
        return suggest_kinds(request.text, _privacy(request))
    except PrivacyUnavailable as error:
        raise HTTPException(503, str(error)) from error
    except GenerationFailed as error:
        raise HTTPException(502, str(error)) from error

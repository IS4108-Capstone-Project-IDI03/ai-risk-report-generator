"""PV-02 and PV-03 leak test (Rule 10): with protection on, no seeded client detail reaches any
external API. The Cohere, Anthropic and OpenAI SDK clients are replaced by recorders, and Chroma
by an in-memory collection, so every step between the route and the paid APIs runs for real.
privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

import json
from contextlib import contextmanager
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import config
from app.chat.answer import Filters, Plan
from app.generation import llm
from app.generation.generator import (
    Ofi,
    OfiDraft,
    SectionDraft,
    Statement,
    Subsection,
    SummaryDraft,
)
from app.main import app
from app.retrieval import retriever

client = TestClient(app)

SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}
ASSESSMENT = {"reference": "RPT-2026-0001", "jurisdiction": "Singapore", "facility_type": "Office"}
OBSERVATION = {
    "id": "obs1",
    "COPE_dimension": ["Construction"],
    "note": "John Tan (NRIC S1234567D) says L3 riser shafts are not fire-stopped.",
    "transcripts": ["Acme Holdings will fix it; call +65 9123 4567."],
    "severity": "high",
    "location": "Acme Holdings Tower, Level 3 riser",
}
# Stored passages: a standard, and a past report that names a person.
PASSAGES = [
    (
        "fm:4",
        "Fire-stop penetrations in rated walls.",
        {"source_type": "fm_standard", "headings": ["Fire Stopping"]},
    ),
    (
        "rep:9",
        "As John Tan noted, the building is of fire-resistive construction.",
        {
            "source_type": "marsh_report",
            "headings": ["Property Risk Evaluation Report", "Construction"],
        },
    ),
    (
        "rep:40",
        "Formalize impairment handling, as John Tan of Acme Holdings agreed.",
        {
            "source_type": "marsh_report",
            "headings": ["Report", "Opportunities for Improvement", "Management Programs"],
        },
    ),
]


class Recorder:
    """Stands in for the Cohere and Anthropic SDK clients, keeping every payload sent."""

    def __init__(self, parsed):
        self.payloads: list[str] = []
        self.parsed = parsed
        self.beta = SimpleNamespace(messages=SimpleNamespace(parse=self.parse))

    def embed(self, texts, **_):
        self.payloads.extend(texts)
        return SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.1] for _ in texts]))

    def rerank(self, query, documents, top_n, **_):
        self.payloads.extend([query, *documents])
        results = [SimpleNamespace(index=i, relevance_score=0.9) for i in range(top_n)]
        return SimpleNamespace(results=results)

    def parse(self, system, messages, **_):
        self.payloads.extend([system, *(m["content"] for m in messages)])
        return SimpleNamespace(
            parsed_output=self.parsed, model="m", stop_reason="end_turn", usage=None
        )


class Collection:
    def __init__(self, passages=PASSAGES):
        self.passages = passages

    def count(self):
        return len(self.passages)

    def query(self, query_embeddings, where, **_):
        # As Chroma's filter does: past reports, or standards, by source_type.
        wanted = "marsh_report" in str(where)
        hits = [p for p in self.passages if (p[2]["source_type"] == "marsh_report") == wanted]
        rows = range(len(query_embeddings))
        return {
            "ids": [[p[0] for p in hits] for _ in rows],
            "documents": [[p[1] for p in hits] for _ in rows],
            "metadatas": [[p[2] for p in hits] for _ in rows],
            "distances": [[0.3 for _ in hits] for _ in rows],
        }


@pytest.fixture
def external(monkeypatch, fake_privacy):
    """Records what would reach Cohere and Anthropic; the model's reply names a placeholder."""

    def with_reply(parsed, passages=PASSAGES):
        recorder = Recorder(parsed)
        chroma = SimpleNamespace(get_collection=lambda **_: Collection(passages))
        monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
        monkeypatch.setattr(retriever, "cohere_client", lambda: recorder)
        monkeypatch.setattr(llm, "_anthropic_client", lambda: recorder)
        return recorder

    return with_reply


def leaked(payloads: list[str]) -> list[str]:
    return [s for s in SEEDED if any(s in p for p in payloads)]


def test_section_drafting_sends_no_seeded_detail(external):
    recorder = external(
        SectionDraft(
            subsections=[
                Subsection(
                    heading="Construction Narrative",
                    statements=[Statement(text="[PERSON_1] reported it.", citations=["O1"])],
                )
            ],
            questions=[],
        )
    )

    response = client.post(
        "/sections/draft",
        json={
            "section_id": "7",
            "assessment": ASSESSMENT,
            "observations": [OBSERVATION],
            "facts": "Agreed with John Tan.",
            "redraft": {
                "instruction": "Name Acme Holdings.",
                "current": [
                    {"heading": "Construction Narrative", "text": "John Tan.", "decision": "edited"}
                ],
            },
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    assert recorder.payloads
    assert leaked(recorder.payloads) == [], [p for p in recorder.payloads if leaked([p])]
    statement = response.json()["subsections"][0]["statements"][0]
    assert statement["text"] == "John Tan reported it."


def test_ofi_drafting_sends_no_seeded_detail(external):
    recorder = external(
        OfiDraft(
            ofis=[
                Ofi(
                    title="Brief [PERSON_1] on valve supervision",
                    category="Physical Protection",
                    type="Fire Protection System",
                    description="[CLIENT_1] supervises control valves open.",
                    observation="As observed, the riser was not fire-stopped.",
                    likelihood="Likely",
                    consequence="Major",
                    effort="Minor Capital",
                    observations=["O1"],
                    standards=["C1"],
                    precedent="P1",
                )
            ]
        )
    )

    response = client.post(
        "/ofis/draft",
        json={
            "assessment": ASSESSMENT,
            "observations": [OBSERVATION],
            "accepted": ["Brief Acme Holdings on impairments"],
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    assert recorder.payloads
    assert leaked(recorder.payloads) == [], [p for p in recorder.payloads if leaked([p])]
    assert response.json()["ofis"][0]["title"] == "Brief John Tan on valve supervision"


# PV-05: a past report stored with its own tags. Its mapping names a client and a person this
# assessment doesn't list, so only the report's mapping says they are client details.
REPORT = "6abb28ae16068a0793e9962a"
OTHER_CLIENT = ["Northwind Pte Ltd", "Mary Lim"]
TAGGED_REPORT = [
    PASSAGES[0],
    (
        "r:9",
        "As [PERSON_1] of [CLIENT_1] noted, the building is of fire-resistive construction.",
        {
            "source_type": "marsh_report",
            "doc_id": REPORT,
            "headings": ["Property Risk Evaluation Report", "Construction"],
        },
    ),
    (
        "r:40",
        "Formalize impairment handling, as [PERSON_1] of [CLIENT_1] agreed.",
        {
            "source_type": "marsh_report",
            "doc_id": REPORT,
            "headings": ["Report", "Opportunities for Improvement", "Management Programs"],
        },
    ),
]


@pytest.mark.parametrize("path", ["/sections/draft", "/ofis/draft"])
def test_a_past_reports_own_client_and_people_reach_no_external_api(
    external, stored_mappings, path
):
    stored_mappings[REPORT] = {"[PERSON_1]": "Mary Lim", "[CLIENT_1]": "Northwind Pte Ltd"}
    reply = (
        SectionDraft(
            subsections=[
                Subsection(
                    heading="Construction Narrative",
                    statements=[Statement(text="The riser is open.", citations=["O1"])],
                )
            ],
            questions=[],
        )
        if path == "/sections/draft"
        else OfiDraft(ofis=[])
    )
    recorder = external(reply, TAGGED_REPORT)
    body = {"assessment": ASSESSMENT, "observations": [OBSERVATION], "privacy": PRIVACY}
    if path == "/sections/draft":
        body["section_id"] = "7"

    response = client.post(path, json=body)

    assert response.status_code == 200, response.text
    sent = [p for p in recorder.payloads if any(name in p for name in OTHER_CLIENT)]
    assert sent == []


def test_summary_drafting_sends_no_seeded_detail(external):
    recorder = external(
        SummaryDraft(statements=[Statement(text="[PERSON_1] confirmed it.", citations=["S7"])])
    )

    response = client.post(
        "/summary/draft",
        json={
            "assessment": ASSESSMENT,
            "sections": [
                {"id": "7", "title": "Construction", "text": " ".join(SEEDED) + " confirmed."}
            ],
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    assert recorder.payloads
    assert leaked(recorder.payloads) == [], [p for p in recorder.payloads if leaked([p])]
    assert response.json()["statements"][0]["text"] == "John Tan confirmed it."


class _Stream:
    """An SDK answer stream: Anthropic reads `text_stream`, OpenAI iterates events."""

    def __init__(self, deltas: list[str]):
        self.text_stream = iter(deltas)
        self.events = [SimpleNamespace(type="response.output_text.delta", delta=d) for d in deltas]
        final = SimpleNamespace(model="m", stop_reason="end_turn", status="completed", usage=None)
        self.get_final_message = self.get_final_response = lambda: final

    def __iter__(self):
        return iter(self.events)


class ChatRecorder(Recorder):
    """Also stands in for chat's SDK calls on either provider: the plan's parse and the
    answer's stream. Each request is kept whole, so nothing in it can slip past."""

    def __init__(self, plan, deltas: list[str]):
        super().__init__(plan)
        self.deltas = deltas
        self.beta = SimpleNamespace(
            messages=SimpleNamespace(parse=self.parse_json, stream=self.stream)
        )
        self.responses = SimpleNamespace(parse=self.parse_json, stream=self.stream)

    def parse_json(self, **request):
        self.payloads.append(json.dumps(request, default=str))
        return SimpleNamespace(
            parsed_output=self.parsed,
            output_parsed=self.parsed,
            model="m",
            stop_reason="end_turn",
            status="completed",
            usage=None,
        )

    @contextmanager
    def stream(self, **request):
        self.payloads.append(json.dumps(request, default=str))
        yield _Stream(self.deltas)


@pytest.mark.parametrize("provider", ["anthropic", "openai"])
def test_chat_sends_no_seeded_detail(external, monkeypatch, provider):
    monkeypatch.setattr(config, "CHAT_PLAN_PROVIDER", provider)
    monkeypatch.setattr(config, "CHAT_PROVIDER", provider)
    recorder = ChatRecorder(
        Plan(
            kind="search",
            query="impairment handling agreed by [PERSON_1]",
            filters=Filters(source_type="marsh_report"),
            reply="",
        ),
        [
            "root = Answer([s1])\n",
            's1 = Statement("[PERSON_1] noted fire-resistive construction.", [c1])\n',
            'c1 = Cite("P1", "As [PERSON_1] noted")\n',
        ],
    )
    external(None)  # Chroma and Cohere as for drafting; chat's models are the chat recorder
    monkeypatch.setattr(retriever, "cohere_client", lambda: recorder)
    monkeypatch.setattr(llm, "_anthropic_client", lambda: recorder)
    monkeypatch.setattr(llm, "_openai_client", lambda: recorder)

    response = client.post(
        "/chat",
        json={
            "messages": [
                {"role": "user", "content": "Who handles impairments at Acme Holdings?"},
                {"role": "assistant", "content": "John Tan does."},
                {"role": "user", "content": "Did John Tan (S1234567D) agree to formalize it?"},
            ],
            "context": [{"description": "note", "value": "Call +65 9123 4567."}],
            "documents": [{"id": "rep", "title": "Acme Holdings Tower survey"}],
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    assert len(recorder.payloads) >= 4  # embed, rerank, plan, answer
    assert leaked(recorder.payloads) == [], [p for p in recorder.payloads if leaked([p])]
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    program = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert "John Tan noted fire-resistive construction." in program
    result = next(e["value"] for e in events if e.get("name") == "chat_result")
    assert result["error"] is None
    assert [c["verified"] for c in result["citations"]] == [True]


def test_a_past_reports_tags_are_renumbered_not_read_as_this_assessments(external, stored_mappings):
    # A guard, passing when first run: restoring before masking already renumbers them.
    # The past report's [PERSON_1] is Mary Lim; this assessment's [PERSON_1] is John Tan.
    stored_mappings[REPORT] = {"[PERSON_1]": "Mary Lim", "[CLIENT_1]": "Northwind Pte Ltd"}
    recorder = external(
        SectionDraft(
            subsections=[
                Subsection(
                    heading="Construction Narrative",
                    statements=[Statement(text="[PERSON_2] noted it.", citations=["O1", "P1"])],
                )
            ],
            questions=[],
        ),
        TAGGED_REPORT,
    )

    response = client.post(
        "/sections/draft",
        json={
            "section_id": "7",
            "assessment": ASSESSMENT,
            "observations": [OBSERVATION],
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    prompt = recorder.payloads[-1]
    assert "As [PERSON_2] of [CLIENT_2] noted" in prompt
    body = response.json()
    assert body["subsections"][0]["statements"][0]["text"] == "Mary Lim noted it."
    assert body["sources"]["P:r:9"]["text"].startswith("As Mary Lim of Northwind Pte Ltd noted")


def test_chat_sends_no_name_from_a_past_reports_mapping(external, monkeypatch, stored_mappings):
    stored_mappings[REPORT] = {"[PERSON_1]": "Mary Lim", "[CLIENT_1]": "Northwind Pte Ltd"}
    recorder = ChatRecorder(
        Plan(
            kind="search",
            query="who noted fire-resistive construction",
            filters=Filters(source_type="marsh_report"),
            reply="",
        ),
        [
            "root = Answer([s1])\n",
            's1 = Statement("[PERSON_2] noted fire-resistive construction.", [c1])\n',
            'c1 = Cite("P1", "As [PERSON_2] of [CLIENT_1] noted")\n',
        ],
    )
    external(None, TAGGED_REPORT)
    monkeypatch.setattr(retriever, "cohere_client", lambda: recorder)
    monkeypatch.setattr(llm, "_anthropic_client", lambda: recorder)
    monkeypatch.setattr(llm, "_openai_client", lambda: recorder)

    response = client.post(
        "/chat",
        json={
            "messages": [{"role": "user", "content": "Who at John Tan's site noted it?"}],
            "documents": [{"id": REPORT, "title": "Past survey"}],
            "privacy": PRIVACY,
        },
    )

    assert response.status_code == 200, response.text
    sent = [p for p in recorder.payloads if any(name in p for name in OTHER_CLIENT)]
    assert sent == []
    events = [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]
    program = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    assert "Mary Lim noted fire-resistive construction." in program
    result = next(e["value"] for e in events if e.get("name") == "chat_result")
    assert [c["verified"] for c in result["citations"]] == [True]

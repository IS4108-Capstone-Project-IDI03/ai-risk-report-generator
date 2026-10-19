"""PV-02 leak test (Rule 10): with protection on, no seeded client detail reaches any external
API. The Cohere and Anthropic SDK clients are replaced by recorders, and Chroma by an
in-memory collection, so every step between the route and the paid APIs runs for real.
privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

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
    def count(self):
        return len(PASSAGES)

    def query(self, query_embeddings, where, **_):
        # As Chroma's filter does: past reports, or standards, by source_type.
        wanted = "marsh_report" in str(where)
        hits = [p for p in PASSAGES if (p[2]["source_type"] == "marsh_report") == wanted]
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

    def with_reply(parsed):
        recorder = Recorder(parsed)
        chroma = SimpleNamespace(get_collection=lambda **_: Collection())
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

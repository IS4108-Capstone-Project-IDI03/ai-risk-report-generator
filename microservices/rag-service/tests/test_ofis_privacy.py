"""PV-02: OFI drafting (GN-05) with PII protection on. Client details are masked before any
Cohere or Anthropic call and restored in the OFIs. Search, rerank and the LLM are mocked;
privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

from fastapi.testclient import TestClient

from app.generation.generator import Ofi, OfiDraft
from app.main import app

client = TestClient(app)

SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}
ASSESSMENT = {"reference": "RPT-2026-0901", "jurisdiction": "SG", "facility_type": "Office"}
VALVE = {
    "id": "valve",
    "COPE_dimension": "Protection",
    "note": "John Tan (S1234567D) found the B1 sprinkler valve SHUT; call +65 9123 4567.",
    "severity": "critical",
    "location": "Acme Holdings fire pump room",
}
STANDARD = {
    "id": "nfpa25:12",
    "text": "Control valves shall be supervised in the open position.",
    "metadata": {"doc_id": "nfpa25", "headings": ["Valves"], "page_start": 12},
    "distance": 0.4,
}
PAST_OFI = {
    "id": "rep:40",
    "text": "Formalize Fire Protection System Impairment, as John Tan agreed.",
    "metadata": {
        "doc_id": "mall-2",
        "headings": ["Report", "Opportunities for Improvement", "Management Programs"],
    },
}
REQUEST = {
    "assessment": ASSESSMENT,
    "observations": [VALVE],
    "accepted": ["Brief Acme Holdings on impairments"],
    "privacy": PRIVACY,
}


def ofi(**fields) -> Ofi:
    return Ofi(
        **{
            "title": "Supervise sprinkler control valves",
            "category": "Physical Protection",
            "type": "Fire Protection System",
            "description": "Supervise control valves in the open position, as per NFPA 25.",
            "observation": "As observed at the fire pump room, the valve was shut.",
            "likelihood": "Likely",
            "consequence": "Major",
            "effort": "Minor Capital",
            "observations": ["O1"],
            "standards": ["C1"],
            "precedent": "P1",
            **fields,
        }
    )


def draft(monkeypatch, ofis=(), request=REQUEST):
    """Drafts through the route; returns the response and what Cohere and the model got."""
    sent = {"search": [], "rerank": [], "prompts": []}

    def search(requests):
        sent["search"].extend(q for q, _, _ in requests)
        return [
            [PAST_OFI] if filters["source_type"] == "marsh_report" else [STANDARD]
            for _, filters, _ in requests
        ]

    def rerank(query, passages, top_n=None):
        sent["rerank"].append(query)
        sent["rerank"].extend(p["text"] for p in passages)
        return passages

    def complete(system, user, schema, effort):
        sent["prompts"].append(system + "\n" + user)
        return OfiDraft(ofis=list(ofis)), "m"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.orchestrator.orchestrator.rerank", rerank)
    monkeypatch.setattr("app.generation.generator.complete", complete)
    return client.post("/ofis/draft", json=request), sent


def test_no_client_detail_reaches_cohere_or_the_model(monkeypatch, fake_privacy):
    response, sent = draft(monkeypatch)

    assert response.status_code == 200
    assert sent["search"] and sent["rerank"] and sent["prompts"]
    for payload in sent["search"] + sent["rerank"] + sent["prompts"]:
        assert not [s for s in SEEDED if s in payload], payload
    prompt = sent["prompts"][0]
    assert "[PERSON_1] ([NRIC_1]) found the B1 sprinkler valve SHUT" in prompt
    assert "- Brief [CLIENT_1] on impairments" in prompt


def test_the_ofis_show_the_real_names(monkeypatch, fake_privacy):
    response, _ = draft(
        monkeypatch,
        [
            ofi(
                title="Brief [PERSON_1] on valve supervision",
                description="[CLIENT_1] supervises control valves open, as per NFPA 25.",
                observation="As [PERSON_1] observed, the B1 valve was shut.",
            )
        ],
    )

    [made] = response.json()["ofis"]
    assert made["title"] == "Brief John Tan on valve supervision"
    assert made["description"] == "Acme Holdings supervises control valves open, as per NFPA 25."
    assert made["observation"] == "As John Tan observed, the B1 valve was shut."
    assert response.json()["sources"]["P:rep:40"]["text"] == PAST_OFI["text"]


def test_provenance_records_protection_but_never_the_values(monkeypatch, fake_privacy):
    response, _ = draft(monkeypatch, [ofi()])
    off, _ = draft(monkeypatch, request={k: v for k, v in REQUEST.items() if k != "privacy"})

    # John Tan, the NRIC, the phone number and Acme Holdings: four details masked.
    assert response.json()["provenance"]["privacy"] == {"enabled": True, "masked_count": 4}
    assert off.json()["provenance"]["privacy"] == {"enabled": False, "masked_count": 0}


def test_if_the_privacy_service_is_down_nothing_is_sent_and_the_reason_is_given(
    monkeypatch, fake_privacy
):
    fake_privacy.failure = 503

    response, sent = draft(monkeypatch)

    assert response.status_code == 502
    assert "privacy service" in response.json()["detail"]
    assert sent == {"search": [], "rerank": [], "prompts": []}

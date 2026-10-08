"""Section 3 Opportunities for Improvement (GN-05). Retrieval and the LLM are mocked."""

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.generation.generator import OFI_CONFIG, Ofi, OfiDraft, ram_priority
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def keep_vector_order(monkeypatch):
    # Rerank is a paid Cohere call: every test keeps the vector order unless it replaces this.
    monkeypatch.setattr(
        "app.orchestrator.orchestrator.rerank", lambda query, passages, top_n=None: passages
    )


ASSESSMENT = {
    "reference": "RPT-2026-0901",
    "jurisdiction": "SG",
    "facility_type": "Office",
    "standards": ["NFPA 25"],
}
VALVE = {
    "id": "valve",
    "COPE_dimension": "Protection",
    "note": "B1 spk CV found SHUT, not chained, no tamper switch.",
    "severity": "critical",
    "location": "Fire pump room, Basement 1",
}
PANEL = {
    "id": "panel",
    "COPE_dimension": "Protection",
    "note": "FA panel monitored by central stn co.",
    "severity": "low",
}
STANDARD = {
    "id": "nfpa25:12",
    "text": "Control valves shall be supervised in the open position.",
    "metadata": {"doc_id": "nfpa25", "headings": ["Valves"], "page_start": 12},
    "distance": 0.4,
}
PAST_OFI = {
    "id": "rep:40",
    "text": "2025-02: Description; Formalize Fire Protection System Impairment: As per NFPA 25...",
    "metadata": {
        "doc_id": "mall-2",
        "headings": [
            "Property Risk Evaluation Report",
            "Opportunities for Improvement",
            "Management Programs",
        ],
    },
}
RAM_BOILERPLATE = {
    "id": "rep:2",
    "text": "Likelihood Insignificant Minor Moderate Major Catastrophic",
    "metadata": {
        "doc_id": "mall-2",
        "headings": [
            "Property Risk Evaluation Report",
            "Opportunities for Improvement",
            "Risk Assessment Matrix (RAM)",
        ],
    },
}
OTHER_PAST = {
    "id": "rep:9",
    "text": "Wet sprinklers throughout.",
    "metadata": {
        "doc_id": "mall-2",
        "headings": ["Property Risk Evaluation Report", "Fire Protection"],
    },
}


def fake_search(calls):
    def search(requests):
        calls.extend(requests)
        return [
            [PAST_OFI, RAM_BOILERPLATE, OTHER_PAST]
            if filters["source_type"] == "marsh_report"
            else [STANDARD]
            for _, filters, _ in requests
        ]

    return search


def ofi(**fields) -> Ofi:
    return Ofi(
        **{
            "title": "Supervise sprinkler control valves",
            "category": "Physical Protection",
            "type": "Fire Protection System",
            "description": "Supervise control valves in the open position, as per NFPA 25.",
            "observation": "As observed at the Basement 1 fire pump room, the valve was shut.",
            "likelihood": "Likely",
            "consequence": "Major",
            "effort": "Minor Capital",
            "observations": ["O1"],
            "standards": ["C1"],
            "precedent": "P1",
            **fields,
        }
    )


def draft(monkeypatch, ofis, observations=(VALVE, PANEL), accepted=()):
    calls, prompts = [], []
    monkeypatch.setattr("app.orchestrator.orchestrator.search", fake_search(calls))

    def complete(system, user, schema, effort):
        prompts.append((system, user))
        return OfiDraft(ofis=ofis), "claude-sonnet-5-5"

    monkeypatch.setattr("app.generation.generator.complete", complete)
    response = client.post(
        "/ofis/draft",
        json={
            "assessment": ASSESSMENT,
            "observations": list(observations),
            "accepted": list(accepted),
        },
    )
    return response, calls, prompts


def test_an_ofi_rests_on_current_observations_and_names_its_precedent(monkeypatch):
    response, calls, prompts = draft(monkeypatch, [ofi()], accepted=["Improve Hot Work Permit"])
    assert response.status_code == 200
    body = response.json()
    [made] = body["ofis"]
    # AC1: labels map back to the current observation and the standard; AC6: the
    # priority is the matrix's Likely x Major, set in code.
    assert made["observations"] == ["valve"]
    assert made["standards"] == ["C:nfpa25:12"]
    assert made["priority"] == "Priority 1"
    # AC2: the precedent's report reference is returned with it.
    assert made["precedent"] == "P:rep:40"
    assert body["sources"]["P:rep:40"]["doc_id"] == "mall-2"
    assert body["sources"]["C:nfpa25:12"]["page_start"] == 12
    assert body["provenance"]["prompt_version"].startswith("gn05")
    assert body["provenance"]["config_version"] == OFI_CONFIG["version"]
    # Paid calls are listed for the gateway's cost report (EV-03), as for sections.
    assert isinstance(body["usage"], list)

    # Only moderate-or-worse observations are candidates, searched by their own words.
    queries = [q for q, _, _ in calls]
    assert queries == [
        "B1 sprinkler control valve found SHUT, not chained, no tamper switch.",
        "B1 sprinkler control valve found SHUT, not chained, no tamper switch.",
    ]
    system, user = prompts[0]
    assert "FA panel" not in user
    # Past OFIs are retrieved by heading: the matrix boilerplate and other sections are not.
    assert "Formalize Fire Protection System Impairment" in user
    assert "Likelihood Insignificant" not in user
    assert "Wet sprinklers throughout" not in user
    # Accepted OFIs are listed so they are not proposed again.
    assert "Improve Hot Work Permit" in user
    assert "Hot Work Permit" in system  # the type list


def test_an_ofi_without_a_resolving_observation_is_dropped(monkeypatch):
    response, _, _ = draft(
        monkeypatch,
        [
            ofi(title="From nothing", observations=["O9"]),
            ofi(title="Kept", standards=["C1", "C7"], precedent="P5"),
        ],
    )
    [kept] = response.json()["ofis"]
    # AC1: an OFI must rest on a current observation; unknown standard and precedent
    # labels are dropped rather than shown.
    assert kept["title"] == "Kept"
    assert kept["standards"] == ["C:nfpa25:12"]
    assert kept["precedent"] is None


def test_no_moderate_or_worse_observation_makes_no_model_call(monkeypatch):
    response, calls, prompts = draft(monkeypatch, [ofi()], observations=(PANEL,))
    assert response.json()["ofis"] == []
    assert calls == [] and prompts == []


def test_a_failed_rerank_still_drafts(monkeypatch):
    def rerank(query, passages, top_n=None):
        raise RuntimeError("rate limited")

    monkeypatch.setattr("app.orchestrator.orchestrator.rerank", rerank)
    response, _, _ = draft(monkeypatch, [ofi()])
    assert response.status_code == 200
    assert len(response.json()["ofis"]) == 1


# AC6: the priority is the template's matrix, looked up in code.
@pytest.mark.parametrize(
    ("likelihood", "consequence", "priority"),
    [
        ("Almost Certain", "Catastrophic", "Priority 1"),
        ("Very Rare", "Insignificant", "Priority 4"),
        ("Very Rare", "Catastrophic", "Priority 2"),
        ("Possible", "Minor", "Priority 3"),
        ("Unlikely", "Major", "Priority 2"),
    ],
)
def test_priority_comes_from_the_risk_assessment_matrix(likelihood, consequence, priority):
    assert ram_priority(likelihood, consequence) == priority


# AC5: the model can only answer from Marsh's value lists.
@pytest.mark.parametrize(
    "field",
    [
        {"type": "Made-up type"},
        {"category": "Electrical"},
        {"effort": "Huge"},
        {"likelihood": "Often"},
    ],
)
def test_values_outside_the_configured_lists_are_rejected(field):
    with pytest.raises(ValidationError):
        ofi(**field)

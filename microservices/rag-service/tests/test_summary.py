"""Executive Summary drafting (GN-07 AC2). The LLM is mocked; nothing is retrieved."""

from fastapi.testclient import TestClient

from app.generation.generator import Statement, SummaryDraft
from app.main import app

client = TestClient(app)

REQUEST = {
    "assessment": {
        "reference": "RPT-2026-0001",
        "jurisdiction": "Singapore",
        "facility_type": "Office",
    },
    "sections": [
        {
            "id": "3",
            "title": "Opportunities for Improvement",
            "text": "Priority 1 — Fit riser fire-stopping.",
        },
        {
            "id": "7",
            "title": "Construction",
            "text": "Construction Narrative\nThe building is concrete.",
        },
    ],
}


def draft(monkeypatch, statements):
    prompts = []

    def complete(system, user, schema, effort):
        prompts.append((system, user))
        return SummaryDraft(statements=statements), "claude-test"

    monkeypatch.setattr("app.generation.generator.complete", complete)
    return client.post("/summary/draft", json=REQUEST), prompts


def test_the_summary_is_drafted_only_from_the_sections_sent(monkeypatch):
    response, prompts = draft(
        monkeypatch,
        [
            Statement(text="The building is concrete.", citations=["S7"]),
            Statement(text="Riser fire-stopping is the top priority.", citations=["S3", "S7"]),
        ],
    )

    assert response.status_code == 200
    body = response.json()
    # Each section's text reaches the model under a short label, and nothing else does.
    _, user = prompts[0]
    assert "[S3] Opportunities for Improvement" in user and "The building is concrete." in user
    assert body["statements"] == [
        {"text": "The building is concrete.", "citations": ["S:7"], "supported": True},
        {
            "text": "Riser fire-stopping is the top priority.",
            "citations": ["S:3", "S:7"],
            "supported": True,
        },
    ]
    assert body["guardrail"] == {"passed": True, "unsupported_count": 0}
    assert body["provenance"]["prompt_version"].startswith("gn07")
    assert body["provenance"]["model"] == "claude-test"


def test_the_summary_model_is_told_to_copy_placeholders_exactly(monkeypatch):
    # Saved sections hold real names, masked as placeholders (PV-02); keep them intact.
    response, prompts = draft(monkeypatch, [])

    system, _ = prompts[0]
    assert "Copy bracketed placeholders such as [PERSON_1] or [CLIENT_1] exactly" in system
    assert response.json()["provenance"]["prompt_version"] == "gn07-v3"


def test_a_statement_resting_on_no_section_sent_is_unsupported(monkeypatch):
    response, _ = draft(
        monkeypatch,
        [
            Statement(text="Sprinklers cover the site.", citations=["S9"]),
            Statement(text="The site is well run.", citations=[]),
        ],
    )

    body = response.json()
    assert [s["supported"] for s in body["statements"]] == [False, False]
    assert body["guardrail"] == {"passed": False, "unsupported_count": 2}

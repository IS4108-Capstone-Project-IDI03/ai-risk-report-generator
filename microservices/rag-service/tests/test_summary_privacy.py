"""PV-02: Executive Summary drafting (GN-07) with PII protection on. The saved sections hold
real names, so they reach the model masked and the summary is restored. The LLM is mocked;
privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

import httpx
from fastapi.testclient import TestClient

from app.generation.generator import Statement, SummaryDraft
from app.main import app

client = TestClient(app)

SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
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
            "text": "Priority 1 — Acme Holdings to fit riser fire-stopping.",
        },
        {
            "id": "7",
            "title": "Construction",
            "text": "John Tan (+65 9123 4567, NRIC S1234567D) confirmed concrete frame.",
        },
    ],
    "privacy": {
        "enabled": True,
        "known_entities": [
            {"type": "CLIENT", "names": ["Acme Holdings"]},
            {"type": "PERSON", "names": ["John Tan"]},
        ],
    },
}


def draft(monkeypatch, statements=(), request=REQUEST):
    prompts = []

    def complete(system, user, schema, effort):
        prompts.append(system + "\n" + user)
        return SummaryDraft(statements=list(statements)), "m"

    monkeypatch.setattr("app.generation.generator.complete", complete)
    return client.post("/summary/draft", json=request), prompts


def test_no_client_detail_reaches_the_model(monkeypatch, fake_privacy):
    response, prompts = draft(monkeypatch)

    assert response.status_code == 200
    [prompt] = prompts
    assert not [s for s in SEEDED if s in prompt]
    assert "Priority 1 — [CLIENT_1] to fit riser fire-stopping." in prompt


def test_the_summary_shows_real_names_and_flags_a_garbled_placeholder(monkeypatch, fake_privacy):
    response, _ = draft(
        monkeypatch,
        [
            Statement(text="[CLIENT_1] should fit riser fire-stopping.", citations=["S3"]),
            Statement(text="[PERSON_4] confirmed the frame.", citations=["S7"]),
        ],
    )

    body = response.json()
    assert [(s["text"], s["supported"]) for s in body["statements"]] == [
        ("Acme Holdings should fit riser fire-stopping.", True),
        ("[PERSON_4] confirmed the frame.", False),
    ]
    assert body["guardrail"] == {"passed": False, "unsupported_count": 1}


def test_provenance_records_protection_but_never_the_values(monkeypatch, fake_privacy):
    response, _ = draft(monkeypatch)
    off, _ = draft(monkeypatch, request={k: v for k, v in REQUEST.items() if k != "privacy"})

    # Acme Holdings, John Tan, the phone number and the NRIC: four details masked.
    assert response.json()["provenance"]["privacy"] == {"enabled": True, "masked_count": 4}
    assert off.json()["provenance"]["privacy"] == {"enabled": False, "masked_count": 0}


def test_if_the_privacy_service_is_down_nothing_is_sent_and_the_reason_is_given(
    monkeypatch, fake_privacy
):
    fake_privacy.failure = httpx.ReadTimeout("slow")

    response, prompts = draft(monkeypatch)

    assert response.status_code == 502
    assert "privacy service" in response.json()["detail"]
    assert prompts == []

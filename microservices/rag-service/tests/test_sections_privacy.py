"""PV-02: section drafting with PII protection on. Client details are masked before any
Cohere or Anthropic call and restored in the draft. Search, rerank and the LLM are mocked;
privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

import httpx
from fastapi.testclient import TestClient

from app.generation.generator import SectionDraft, Statement, Subsection
from app.main import app

client = TestClient(app)

# Seeded PII (Rule 10): none of it may reach Cohere or the model.
SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}
REQUEST = {
    "section_id": "7",
    "assessment": {
        "reference": "RPT-2026-0001",
        "jurisdiction": "Singapore",
        "facility_type": "Office",
    },
    "observations": [
        {
            "id": "obs1",
            "COPE_dimension": ["Construction"],
            "note": "John Tan (NRIC S1234567D) says L3 riser shafts are not fire-stopped.",
            "transcripts": ["Acme Holdings will fix it; call +65 9123 4567."],
            "severity": "high",
            "location": "Acme Holdings Tower, Level 3 riser",
        }
    ],
    "privacy": PRIVACY,
}
STANDARD = {
    "id": "fm:4",
    "text": "Fire-stop penetrations in rated walls.",
    "metadata": {"doc_id": "fm", "headings": ["Fire Stopping"], "page_start": 4},
}
PRECEDENT = {
    "id": "rep:9",
    "text": "As John Tan noted, the building is of fire-resistive construction.",
    "metadata": {"doc_id": "rep", "headings": ["Property Risk Evaluation Report", "Construction"]},
}


def draft(monkeypatch, subsections=(), questions=(), request=REQUEST):
    """Drafts through the route; returns the response and what Cohere and the model got."""
    sent = {"search": [], "rerank": [], "prompts": []}

    def search(requests):
        sent["search"].extend(q for q, _, _ in requests)
        return [
            [PRECEDENT] if filters["source_type"] == "marsh_report" else [STANDARD]
            for _, filters, _ in requests
        ]

    def rerank(query, passages, top_n=None):
        sent["rerank"].append((query, [p["text"] for p in passages]))
        return passages

    def complete(system, user, schema, effort):
        sent["prompts"].append(system + "\n" + user)
        return SectionDraft(subsections=list(subsections), questions=list(questions)), "m"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.orchestrator.orchestrator.rerank", rerank)
    monkeypatch.setattr("app.generation.generator.complete", complete)
    return client.post("/sections/draft", json=request), sent


def test_no_client_detail_reaches_cohere_or_the_model(monkeypatch, fake_privacy):
    response, sent = draft(monkeypatch)

    assert response.status_code == 200
    queries = sent["search"] + [q for q, _ in sent["rerank"]]
    assert queries and sent["prompts"]
    for payload in queries + sent["prompts"]:
        assert not [s for s in SEEDED if s in payload], payload
    # The masked evidence still reaches the model, as placeholders.
    assert "[PERSON_1] (NRIC [NRIC_1]) says L3 riser shafts" in sent["prompts"][0]


def test_the_draft_shows_the_real_names(monkeypatch, fake_privacy):
    response, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Construction Narrative",
                statements=[
                    Statement(
                        text="[PERSON_1] reported unsealed risers at [CLIENT_1].",
                        citations=["O:obs1"],
                    )
                ],
            )
        ],
        questions=["Has person_1 booked the fire-stopping?"],
    )

    body = response.json()
    [statement] = body["subsections"][0]["statements"]
    assert statement == {
        "text": "John Tan reported unsealed risers at Acme Holdings.",
        "citations": ["O:obs1"],
        "supported": True,
    }
    assert body["questions"] == ["Has John Tan booked the fire-stopping?"]


def test_a_garbled_placeholder_makes_its_statement_unsupported(monkeypatch, fake_privacy):
    response, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Construction Narrative",
                statements=[
                    Statement(text="[PERSON_1] reported the risers.", citations=["O:obs1"]),
                    Statement(text="[PERSON_9] signed off the repairs.", citations=["O:obs1"]),
                ],
            )
        ],
    )

    body = response.json()
    assert [(s["text"], s["supported"]) for s in body["subsections"][0]["statements"]] == [
        ("John Tan reported the risers.", True),
        ("[PERSON_9] signed off the repairs.", False),
    ]
    assert body["guardrail"] == {"passed": False, "unsupported_count": 1}


def test_loss_figures_are_checked_against_the_real_facts_and_notes(monkeypatch, fake_privacy):
    # Section 5's facts can name people too; the model sees them masked, while the number
    # check compares the restored statement with the original facts and observation.
    facts = "Values in SGD. Estimates agreed with John Tan. Level II items: Hotel 28.4% damage"
    response, sent = draft(
        monkeypatch,
        [
            Subsection(
                heading="Level II Scenario",
                statements=[
                    Statement(
                        text="[PERSON_1] (on [PHONE_1]) expects 28.4% damage to the hotel.",
                        citations=["O:obs1"],
                    ),
                    Statement(text="Damage reaches 40% of the building.", citations=["O:obs1"]),
                ],
            )
        ],
        request={**REQUEST, "section_id": "5", "facts": facts},
    )

    assert "John Tan" not in sent["prompts"][0]
    assert "Estimates agreed with [PERSON_1]." in sent["prompts"][0]
    level_2 = next(s for s in response.json()["subsections"] if s["heading"] == "Level II Scenario")
    assert [(s["text"], s["supported"]) for s in level_2["statements"]] == [
        ("John Tan (on +65 9123 4567) expects 28.4% damage to the hotel.", True),
        ("Damage reaches 40% of the building.", False),
    ]


def test_a_redrafts_saved_text_and_instruction_are_masked(monkeypatch, fake_privacy):
    # Saved drafts hold real names, and the engineer may name people in the instruction.
    redraft = {
        "instruction": "Say that John Tan owns the fix.",
        "current": [
            {
                "heading": "Construction Narrative",
                "text": "Acme Holdings has unsealed risers.",
                "decision": "pending",
            }
        ],
    }

    _, sent = draft(monkeypatch, request={**REQUEST, "redraft": redraft})

    [prompt] = sent["prompts"]
    assert not [s for s in SEEDED if s in prompt]
    assert "[pending] Construction Narrative: [CLIENT_1] has unsealed risers." in prompt
    assert "Say that [PERSON_1] owns the fix." in prompt


def test_the_reviewer_sees_the_past_report_passage_as_stored(monkeypatch, fake_privacy):
    response, sent = draft(
        monkeypatch,
        [
            Subsection(
                heading="Construction Narrative",
                statements=[
                    Statement(text="The building is fire-resistive.", citations=["P:rep:9"])
                ],
            )
        ],
    )

    assert "As [PERSON_1] noted, the building" in sent["prompts"][0]
    source = response.json()["sources"]["P:rep:9"]
    assert source["text"] == PRECEDENT["text"]
    assert source["headings"] == PRECEDENT["metadata"]["headings"]


def test_if_the_privacy_service_is_down_nothing_is_sent_and_the_reason_is_given(
    monkeypatch, fake_privacy
):
    fake_privacy.failure = httpx.ConnectError("refused")

    response, sent = draft(monkeypatch)

    assert response.status_code == 502
    assert "privacy service" in response.json()["detail"]
    assert sent == {"search": [], "rerank": [], "prompts": []}


def test_provenance_records_protection_but_never_the_values(monkeypatch, fake_privacy):
    response, _ = draft(monkeypatch)
    off, _ = draft(monkeypatch, request={k: v for k, v in REQUEST.items() if k != "privacy"})

    # John Tan, the NRIC, Acme Holdings and the phone number: four details masked.
    assert response.json()["provenance"]["privacy"] == {"enabled": True, "masked_count": 4}
    assert off.json()["provenance"]["privacy"] == {"enabled": False, "masked_count": 0}
    assert not [s for s in SEEDED if s in str(response.json()["provenance"])]

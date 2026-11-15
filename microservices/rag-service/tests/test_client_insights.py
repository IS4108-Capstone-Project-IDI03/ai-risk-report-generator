"""CP-29: POST /client-insights/summary. The model (`complete`) is mocked; privacy-service's
/mask is faked in-process (conftest `fake_privacy`)."""

import httpx
from fastapi.testclient import TestClient

from app.client_insights.summary import NOTHING_CHECKED, Statement, Summary
from app.main import app

client = TestClient(app)

FIGURES = [
    {
        "label": "F1",
        "title": "Observations by category, at each site's latest assessment",
        "lines": [
            "Across 2 sites: Construction 1, Occupancy 2, Protection 3 (6 observations).",
            "Tilbury: Construction 1, Protection 2; 1 Critical, 1 High, of 3 observations.",
        ],
    },
    {
        "label": "F3",
        "title": "Change between first and latest visit",
        "lines": ["Tilbury: Critical and High findings 1 (Mar 2025) to 2 (Mar 2026)."],
    },
]
OBSERVATIONS = [
    {
        "label": "O1",
        "site": "Tilbury",
        "location": "High-bay racking, Aisle 14",
        "severity": "critical",
        "categories": ["Protection"],
        "date": "2026-03-12",
        "text": "In-rack sprinkler valve found closed. John Tan could not say when it was shut.",
    },
    {
        "label": "O2",
        "site": "Leeds",
        "location": None,
        "severity": "high",
        "categories": ["Protection"],
        "date": "2026-05-01",
        "text": "Fire pump weekly test log stops in July.",
    },
]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Northgate Logistics"]},
        {"type": "SITE", "names": ["Tilbury"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}


def say(*statements, missing=None):
    return Summary(
        statements=[Statement(text=text, sources=list(sources)) for text, sources in statements],
        missing=missing,
    )


def summarise(monkeypatch, answer, **body):
    """Posts a summary request; returns the response and the prompts the model got."""
    prompts = []

    def complete(system, user, schema, effort, feature="draft-section", model=None):
        prompts.append({"system": system, "user": user, "feature": feature})
        return answer, "claude-test"

    monkeypatch.setattr("app.client_insights.summary.complete", complete)
    request = {
        "client": "Northgate Logistics",
        "figures": FIGURES,
        "observations": OBSERVATIONS,
        **body,
    }
    return client.post("/client-insights/summary", json=request), prompts


def test_keeps_cited_statements_with_their_labels(monkeypatch):
    answer = say(
        ("Protection accounts for 3 of 6 observations across 2 sites.", ["F1"]),
        ("At Tilbury an in-rack sprinkler valve was found closed.", ["o1", "F1", "F1"]),
        missing="Leeds has no rating yet.",
    )

    response, prompts = summarise(monkeypatch, answer)

    assert response.status_code == 200
    body = response.json()
    assert body["statements"] == [
        {
            "text": "Protection accounts for 3 of 6 observations across 2 sites.",
            "citations": ["F1"],
        },
        # Labels are read whatever their case, each once.
        {
            "text": "At Tilbury an in-rack sprinkler valve was found closed.",
            "citations": ["O1", "F1"],
        },
    ]
    assert body["missing"] == "Leeds has no rating yet."
    # Something is missing, so not High.
    assert body["confidence"] == "medium"
    assert body["dropped"] == 0
    assert body["provenance"] == {
        "provider": "anthropic",
        "model": "claude-test",
        "effort": "medium",
        "prompt_version": "cp29-v1",
        "privacy": {"enabled": False, "masked_count": 0},
    }
    assert prompts[0]["feature"] == "client-insights"
    assert "F1 Observations by category" in prompts[0]["user"]
    assert (
        "O1 (High-bay racking, Aisle 14, Tilbury; critical; Protection, 2026-03-12)"
        in (prompts[0]["user"])
    )


def test_high_confidence_when_nothing_is_dropped_or_missing(monkeypatch):
    answer = say(("At Tilbury an in-rack sprinkler valve was found closed.", ["O1"]))

    response, _ = summarise(monkeypatch, answer)

    assert response.json()["confidence"] == "high"


def test_a_statement_resting_only_on_figures_is_medium(monkeypatch):
    answer = say(("Protection accounts for 3 of 6 observations.", ["F1"]))

    response, _ = summarise(monkeypatch, answer)

    assert response.json()["confidence"] == "medium"


def test_drops_statements_that_break_the_rules(monkeypatch):
    answer = say(
        ("At Tilbury an in-rack sprinkler valve was found closed.", ["O1"]),
        ("Protection is a concern at every site.", ["O9"]),  # cites nothing it was given
        ("The site should reopen the valve at once.", ["O1"]),  # advice
        ("We found the valve closed.", ["O1"]),  # first person
        ("Tilbury has 14 Protection findings.", ["F1"]),  # a number its source lacks
        ("", ["O1"]),
    )

    response, _ = summarise(monkeypatch, answer)

    body = response.json()
    assert [s["text"] for s in body["statements"]] == [
        "At Tilbury an in-rack sprinkler valve was found closed."
    ]
    assert body["dropped"] == 5
    assert body["dropped_reasons"] == [
        "uncited",
        "recommendation",
        "first_person",
        "number",
        "empty",
    ]
    # A statement was left out, so the summary is Low confidence.
    assert body["confidence"] == "low"


def test_a_number_is_checked_against_the_cited_sources_only(monkeypatch):
    # F1 gives 6 and 3; F3 gives neither, and its own label's 3 does not count.
    answer = say(
        ("Tilbury has 6 observations.", ["F3"]),
        ("Tilbury has 3 observations.", ["F3"]),
        ("Tilbury has 3 observations.", ["F1"]),
    )

    response, _ = summarise(monkeypatch, answer)

    body = response.json()
    assert [s["citations"] for s in body["statements"]] == [["F1"]]
    assert body["dropped_reasons"] == ["number", "number"]


def test_shows_at_most_five_statements(monkeypatch):
    answer = say(*[("At Tilbury an in-rack sprinkler valve was found closed.", ["O1"])] * 7)

    response, _ = summarise(monkeypatch, answer)

    assert len(response.json()["statements"]) == 5


def test_fails_when_no_statement_passes(monkeypatch):
    answer = say(("The client should improve housekeeping.", ["O1"]))

    response, _ = summarise(monkeypatch, answer)

    assert response.status_code == 502
    assert response.json()["detail"] == NOTHING_CHECKED


def test_masks_client_details_before_the_model_and_restores_them_after(monkeypatch, fake_privacy):
    answer = say(
        ("At [SITE_1] an in-rack sprinkler valve was found closed; [PERSON_1] was on site.", ["O1"])
    )

    response, prompts = summarise(monkeypatch, answer, privacy=PRIVACY)

    assert response.status_code == 200
    sent = prompts[0]["user"]
    for name in ("Northgate Logistics", "Tilbury", "John Tan"):
        assert name not in sent
    assert "Client: [CLIENT_1]" in sent
    assert "[PERSON_1] could not say when it was shut" in sent
    # One /mask call covers the client, the figures and the observations.
    assert len(fake_privacy.requests) == 1
    body = response.json()
    assert body["statements"][0]["text"] == (
        "At Tilbury an in-rack sprinkler valve was found closed; John Tan was on site."
    )
    assert body["provenance"]["privacy"] == {"enabled": True, "masked_count": 3}


def test_drops_a_statement_with_a_placeholder_it_cannot_restore(monkeypatch, fake_privacy):
    answer = say(
        ("At [SITE_1] an in-rack sprinkler valve was found closed.", ["O1"]),
        ("[PERSON_9] reported the fire pump log stops in July.", ["O2"]),
    )

    response, _ = summarise(monkeypatch, answer, privacy=PRIVACY)

    body = response.json()
    assert [s["text"] for s in body["statements"]] == [
        "At Tilbury an in-rack sprinkler valve was found closed."
    ]
    assert body["dropped_reasons"] == ["placeholder"]


def test_sends_nothing_when_masking_fails(monkeypatch, fake_privacy):
    fake_privacy.failure = httpx.ConnectError("down")
    answer = say(("At Tilbury an in-rack sprinkler valve was found closed.", ["O1"]))

    response, prompts = summarise(monkeypatch, answer, privacy=PRIVACY)

    assert response.status_code == 503
    assert "nothing was sent to the AI model" in response.json()["detail"]
    assert prompts == []


def test_refuses_a_request_with_no_observations():
    response = client.post(
        "/client-insights/summary",
        json={"client": "Northgate Logistics", "figures": FIGURES, "observations": []},
    )

    assert response.status_code == 422

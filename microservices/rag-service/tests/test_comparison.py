"""RV-13: POST /comparison/compare. The model (`complete`) is mocked; privacy-service's /mask
is faked in-process (conftest `fake_privacy`)."""

import httpx
from fastapi.testclient import TestClient

from app.comparison import compare
from app.comparison.compare import Comparison, Figure, ItemOutcome
from app.main import app

client = TestClient(app)

PREVIOUS = [
    {
        "label": "P1",
        "kind": "finding",
        "section": "9. Fire Protection",
        "title": "Water Supply Test Comments",
        "text": "The fire pump churn pressure was 7.5 bar. John Tan keeps the weekly test log.",
        "severity": "high",
        "categories": ["Protection"],
    },
    {
        "label": "P2",
        "kind": "recommendation",
        "section": "3. Opportunities for Improvement",
        "title": "Lock Sprinkler Control Valves Open",
        "text": "Lock every sprinkler control valve open.",
        "priority": "Priority 2",
    },
]
CURRENT = [
    {
        "label": "O1",
        "kind": "observation",
        "section": "Observations",
        "title": "Pump room, B1",
        "location": "Pump room, B1",
        "text": "Fire pump churn pressure 6.9 bar; weekly test log complete.",
        "severity": "moderate",
        "categories": ["Protection"],
    },
    {
        "label": "F1",
        "kind": "finding",
        "section": "9. Fire Protection",
        "text": "Sprinkler control valves at Tilbury were found locked open.",
        "severity": "low",
        "categories": ["Protection"],
    },
]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "SITE", "names": ["Tilbury"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}


def entry(label, outcome="unchanged", sources=(), **fields):
    return ItemOutcome(
        previous=label,
        outcome=outcome,
        sources=list(sources),
        match=fields.get("match", "clear"),
        disagree=list(fields.get("disagree", [])),
        possible=list(fields.get("possible", [])),
        reason=fields.get("reason"),
        missing=fields.get("missing"),
        figures=list(fields.get("figures", [])),
    )


def run(monkeypatch, *answers, **body):
    """Posts a comparison; returns the response and the prompts the model got, one per call."""
    prompts = []
    queue = list(answers)

    def complete(system, user, schema, effort, feature="draft-section", model=None):
        prompts.append({"system": system, "user": user, "feature": feature})
        return queue.pop(0), "claude-test"

    monkeypatch.setattr("app.comparison.compare.complete", complete)
    request = {"previous": PREVIOUS, "current": CURRENT, **body}
    return client.post("/comparison/compare", json=request), prompts


def test_returns_one_entry_per_previous_item_with_its_labels(monkeypatch):
    answer = Comparison(
        items=[
            entry(
                "p1",
                "improved",
                ["o1", "O1"],
                reason="The churn pressure was 6.9 bar and the log was complete.",
                figures=[
                    Figure(
                        name="Churn pressure", previous="7.5 bar", current="6.9 bar", source="O1"
                    )
                ],
            ),
            entry("P2", "fixed", ["F1"], reason="Control valves were found locked open."),
        ]
    )

    response, prompts = run(monkeypatch, answer)

    assert response.status_code == 200
    body = response.json()
    first, second = body["items"]
    assert first["previous"] == "P1"
    assert first["outcome"] == "improved"
    # Labels are read whatever their case, each once.
    assert first["sources"] == ["O1"]
    assert first["figures"] == [
        {"name": "Churn pressure", "previous": "7.5 bar", "current": "6.9 bar", "source": "O1"}
    ]
    assert second["outcome"] == "fixed" and second["sources"] == ["F1"]
    assert body["dropped"] == 0
    assert body["provenance"] == {
        "provider": "anthropic",
        "model": "claude-test",
        "effort": "medium",
        "prompt_version": "rv13-v1",
        "privacy": {"enabled": False, "masked_count": 0},
    }
    assert prompts[0]["feature"] == "report-comparison"
    user = prompts[0]["user"]
    assert "P1 (finding, 9. Fire Protection; Water Supply Test Comments; severity high" in user
    assert "P2 (recommendation, 3. Opportunities for Improvement" in user and "Priority 2" in user
    assert "O1 (observation, Observations; Pump room, B1; Pump room, B1; severity moderate" in user


def test_an_item_the_model_left_out_is_not_checked_and_a_repeat_is_ignored(monkeypatch):
    answer = Comparison(
        items=[
            entry("P1", "unchanged", ["O1"]),
            entry("P1", "fixed", ["F1"]),
            entry("P9", "fixed", ["F1"]),
        ]
    )

    response, _ = run(monkeypatch, answer)

    body = response.json()
    assert [i["outcome"] for i in body["items"]] == ["unchanged", "not_checked"]
    assert body["items"][1]["omitted"] is True
    assert body["items"][1]["sources"] == []
    assert sorted(body["dropped_reasons"]) == ["omitted", "repeated_item", "unknown_item"]


def test_keeps_only_labels_it_was_given(monkeypatch):
    answer = Comparison(
        items=[
            entry("P1", "unchanged", ["O9", "O1"], possible=["F1", "O1", "X2"]),
            entry("P2", "not_checked", [], missing="No observation records the valves."),
        ]
    )

    response, _ = run(monkeypatch, answer)

    first, second = response.json()["items"]
    assert first["sources"] == ["O1"]
    # A possible match already among the sources is not listed twice.
    assert first["possible"] == ["F1"]
    assert second["missing"] == "No observation records the valves."


def test_sources_that_disagree_are_shown_as_sources(monkeypatch):
    answer = Comparison(
        items=[
            entry("P1", "fixed", ["O1"], disagree=["O1", "F1"]),
            # One label alone is not a disagreement.
            entry("P2", "fixed", ["F1"], disagree=["F1"]),
        ]
    )

    response, _ = run(monkeypatch, answer)

    first, second = response.json()["items"]
    assert first["sources"] == ["O1", "F1"]
    assert first["disagree"] == ["O1", "F1"]
    assert second["disagree"] == []


def test_leaves_out_a_reason_that_breaks_the_rules_and_a_figure_from_no_source(monkeypatch):
    answer = Comparison(
        items=[
            entry(
                "P1",
                "worse",
                ["O1"],
                reason="The site should repair the pump.",
                missing="We could not find the log.",
                figures=[
                    Figure(
                        name="Churn pressure", previous="7.5 bar", current="6.9 bar", source="F1"
                    )
                ],
            ),
            entry("P2", "fixed", ["F1"], reason="Valves were found locked open."),
        ]
    )

    response, _ = run(monkeypatch, answer)

    body = response.json()
    first = body["items"][0]
    assert first["reason"] is None and first["missing"] is None
    assert first["figures"] == []
    assert sorted(body["dropped_reasons"]) == ["figure", "first_person", "recommendation"]


def test_compares_a_long_report_in_parts_with_all_the_evidence_each_time(monkeypatch):
    monkeypatch.setattr(compare, "BATCH", 1)
    first = Comparison(items=[entry("P1", "unchanged", ["O1"])])
    second = Comparison(items=[entry("P2", "fixed", ["F1"])])

    response, prompts = run(monkeypatch, first, second)

    assert [i["previous"] for i in response.json()["items"]] == ["P1", "P2"]
    assert len(prompts) == 2
    assert "P1 " in prompts[0]["user"] and "P2 " not in prompts[0]["user"]
    assert "P2 " in prompts[1]["user"] and "P1 " not in prompts[1]["user"]
    for prompt in prompts:
        assert "O1 " in prompt["user"] and "F1 " in prompt["user"]


def test_masks_client_details_before_the_model_and_restores_them_after(monkeypatch, fake_privacy):
    answer = Comparison(
        items=[
            entry("P1", "improved", ["O1"], reason="[PERSON_1]'s weekly test log was complete."),
            entry("P2", "fixed", ["F1"], reason="At [SITE_1] the valves were locked open."),
        ]
    )

    response, prompts = run(monkeypatch, answer, privacy=PRIVACY)

    assert response.status_code == 200
    sent = prompts[0]["user"]
    for name in ("Tilbury", "John Tan"):
        assert name not in sent
    # One /mask call covers both reports.
    assert len(fake_privacy.requests) == 1
    first, second = response.json()["items"]
    assert first["reason"] == "John Tan's weekly test log was complete."
    assert second["reason"] == "At Tilbury the valves were locked open."
    assert response.json()["provenance"]["privacy"]["enabled"] is True


def test_drops_a_reason_with_a_placeholder_it_cannot_restore(monkeypatch, fake_privacy):
    answer = Comparison(
        items=[
            entry("P1", "unchanged", ["O1"], reason="[PERSON_9] showed the log."),
            entry("P2", "fixed", ["F1"]),
        ]
    )

    response, _ = run(monkeypatch, answer, privacy=PRIVACY)

    assert response.json()["items"][0]["reason"] is None
    assert response.json()["dropped_reasons"] == ["placeholder"]


def test_sends_nothing_when_masking_fails(monkeypatch, fake_privacy):
    fake_privacy.failure = httpx.ConnectError("down")

    response, prompts = run(monkeypatch, Comparison(items=[]), privacy=PRIVACY)

    assert response.status_code == 503
    assert "nothing was sent to the AI model" in response.json()["detail"]
    assert prompts == []


def test_refuses_a_request_with_no_current_evidence():
    response = client.post("/comparison/compare", json={"previous": PREVIOUS, "current": []})

    assert response.status_code == 422

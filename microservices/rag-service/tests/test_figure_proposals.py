"""Proposed figures for Sections 4 and 5 (GN-03 addendum, AC12 and AC15). The LLM is mocked."""

from fastapi.testclient import TestClient

from app.generation.proposals import (
    CATEGORIES,
    DamageProposal,
    LevelProposal,
    LossProposal,
    ScoreProposal,
    ScoresProposal,
    TeProposal,
)
from app.main import app

client = TestClient(app)

REQUEST = {
    "assessment": {"reference": "RPT-1", "jurisdiction": "SG", "facility_type": "Office"},
    "observations": [
        {"id": "obs-a", "COPE_dimension": "Protection", "note": "wet spk throughout, OH1"},
        {"id": "obs-b", "COPE_dimension": "Occupancy", "note": "no hot work permit seen"},
    ],
    "sections": [{"id": "9", "title": "Fire Protection", "text": "Sprinklers throughout."}],
}


def propose(monkeypatch, section_id, answer, **extra):
    prompts = []

    def complete(system, user, schema, effort):
        prompts.append((system, user, schema))
        return answer, "claude-test"

    monkeypatch.setattr("app.generation.proposals.complete", complete)
    body = {**REQUEST, "section_id": section_id, **extra}
    return client.post("/figures/propose", json=body), prompts


def score(category, current, potential, citations=("O1",)):
    return ScoreProposal(
        category=category,
        current=current,
        potential=potential,
        reason="r",
        citations=list(citations),
    )


def test_section_4_proposes_each_category_with_its_sources(monkeypatch):
    answer = ScoresProposal(categories=[score(c, 8, 9) for c in CATEGORIES])
    response, prompts = propose(monkeypatch, "4", answer)

    assert response.status_code == 200
    body = response.json()
    # The observations and drafted sections reach the model under short labels.
    _, user, _ = prompts[0]
    assert "[O1]" in user and "wet spk throughout" in user and "[S9] Fire Protection" in user
    first = body["proposal"]["categories"][0]
    assert first == {
        "category": "External Exposure",
        "current": 8,
        "potential": 9,
        "reason": "r",
        "citations": ["O:obs-a"],
    }
    assert [c["category"] for c in body["proposal"]["categories"]] == CATEGORIES
    assert body["provenance"]["prompt_version"].startswith("gn03-prop")
    assert body["provenance"]["model"] == "claude-test"


def test_out_of_range_scores_are_left_blank(monkeypatch):
    answer = ScoresProposal(
        categories=[
            score(CATEGORIES[0], 11, 12),  # above 10
            score(CATEGORIES[1], 9, 7),  # potential below current
            *[score(c, 7.25, 8) for c in CATEGORIES[2:]],  # to one decimal
        ]
    )
    body = propose(monkeypatch, "4", answer)[0].json()["proposal"]["categories"]
    assert (body[0]["current"], body[0]["potential"]) == (None, None)
    assert (body[1]["current"], body[1]["potential"]) == (9, None)
    assert (body[2]["current"], body[2]["potential"]) == (7.3, 8)


def test_section_5_proposes_each_level_but_no_money(monkeypatch):
    level = LevelProposal(
        level="II",
        damage=[
            DamageProposal(item="L27 to L29", percent=100, reason="r", citations=["O1"]),
            DamageProposal(item="L22 to L26", percent=140, reason="r", citations=["S9"]),
        ],
        te=[
            TeProposal(
                item="Business Interruption (Gross Revenue)",
                months=8,
                percent=11,
                reason="r",
                citations=["O2"],
            )
        ],
    )
    answer = LossProposal(levels=[level])
    response, prompts = propose(
        monkeypatch, "5", answer, te_items=["Business Interruption (Gross Revenue)"]
    )

    assert response.status_code == 200
    system, user, schema = prompts[0]
    # It gets the level definitions but not the drafting rule against writing figures,
    # which made it propose none (found in the click-through, 20 Oct).
    assert "Level II, Probable Maximum Loss" in system
    assert "Write no figure of your own" not in system
    # % damage and months are estimates by nature: never held back for want of a stated
    # figure, which is why v2 still proposed none (eval, 20 Oct).
    assert "rather than a guess" not in system
    # The model is told which BI items to estimate, and never asked for values.
    assert "Business Interruption (Gross Revenue)" in user
    assert "value" not in schema.model_json_schema()["$defs"]["DamageProposal"]["properties"]
    damage = response.json()["proposal"]["levels"][0]["damage"]
    assert damage[0]["percent"] == 100 and damage[0]["citations"] == ["O:obs-a"]
    assert damage[1]["percent"] is None and damage[1]["citations"] == ["S:9"]


def test_an_unknown_section_is_refused(monkeypatch):
    response, prompts = propose(monkeypatch, "7", ScoresProposal(categories=[]))
    assert response.status_code == 422
    assert prompts == []


def test_scores_come_back_as_the_seven_categories_in_order(monkeypatch):
    answer = ScoresProposal(
        categories=[
            score("Fire protection", 8, 9),  # case differs: matched
            score("Fire Protection", 7, 9),  # a duplicate: the first one stands
            score("Basement", 5, 6),  # not a category: dropped
        ]
    )
    body = propose(monkeypatch, "4", answer)[0].json()["proposal"]["categories"]
    assert [c["category"] for c in body] == CATEGORIES
    fire = body[CATEGORIES.index("Fire Protection")]
    assert (fire["current"], fire["potential"]) == (8, 9)
    # A category the model skipped is blank, for the engineer to enter.
    assert body[0] == {
        "category": "External Exposure",
        "current": None,
        "potential": None,
        "reason": "",
        "citations": [],
    }

"""The eval judge's scores come from its findings (rubric-v2), not from the model."""

from eval.judge_sections import Issue, scores_from


def issue(criterion, severity):
    return Issue(criterion=criterion, severity=severity, quote="q", problem="p")


def test_scores_start_at_5_and_lose_points_per_issue_down_to_1():
    scores = scores_from(
        [issue("groundedness", "major"), issue("groundedness", "minor")]
        + [issue("conventions", "major")] * 6
    )
    assert scores == {
        "groundedness": 3.5,
        "coverage": 5,
        "structure": 5,
        "conventions": 1,
        "no_invention": 5,
    }


def test_the_judge_sees_each_statements_citations_and_the_questions():
    from eval.judge_sections import _draft_text, _labels

    case = {"section_id": "7", "observations": [{"id": "a"}, {"id": "b"}]}
    draft = {
        "subsections": [
            {
                "heading": "Construction Narrative",
                "kind": "narrative",
                "statements": [{"text": "Risers unsealed.", "citations": ["O:b", "C:fm:4"]}],
            },
            {"heading": "Construction Table", "kind": "table", "statements": []},
            {
                "heading": "Details on Combustible Construction",
                "kind": "narrative",
                "statements": [],
            },
        ],
        "questions": ["Is there a riser survey?"],
    }
    text = _draft_text(draft, _labels(case, {"C:fm:4": {}}))
    assert "- Risers unsealed. [cites O2, C1]" in text
    assert "Construction Table" not in text
    assert "Details on Combustible Construction\n[this subsection has no statements]" in text
    assert text.endswith("Questions for the engineer:\n- Is there a riser survey?")


def test_ac13_pass_mark_needs_the_floors_and_the_mean():
    from eval.judge_sections import passes

    good = {
        "groundedness": 4.0,
        "no_invention": 4.0,
        "structure": 4.0,
        "coverage": 4.0,
        "conventions": 4.0,
    }
    assert passes(good)
    # Groundedness and no invention have the highest floors.
    assert not passes({**good, "groundedness": 3.5})
    assert not passes({**good, "no_invention": 3.5})
    # Conventions may be lower...
    assert passes({**good, "conventions": 3.0, "structure": 5, "coverage": 5})
    # ...but every floor holds, and the mean must reach 4.0.
    assert not passes({**good, "conventions": 2.5, "structure": 5, "coverage": 5})
    assert not passes({**good, "structure": 3.5, "coverage": 3.5, "conventions": 3.5})


def test_the_judge_is_told_which_observations_are_backup():
    from eval.judge_sections import _evidence_text

    case = {
        "section_id": "9",
        "observations": [
            {"id": "a", "COPE_dimension": "Protection", "location": "B1", "note": "spk CV shut"},
            {"id": "b", "COPE_dimension": "Occupancy", "location": "L5", "note": "UPS next door"},
        ],
    }
    text = _evidence_text(case, {})
    assert "- O1 (main observation, Protection, B1): spk CV shut" in text
    assert "- O2 (backup observation, Occupancy, L5): UPS next door" in text

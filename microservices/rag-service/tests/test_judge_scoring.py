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


# GN-03 addendum: Sections 4 and 5 are drafted from the engineer's figures (`facts`).
def test_the_judge_sees_the_engineers_figures_and_none_when_there_are_none():
    from eval.judge_sections import _evidence_text

    obs = [{"id": "a", "COPE_dimension": "Protection", "location": "B1", "note": "spk ok"}]
    with_facts = {"section_id": "4", "observations": obs, "facts": "Current Rating: B"}
    assert (
        "- F (the engineer's figures, entered and calculated outside the draft): "
        "Current Rating: B" in _evidence_text(with_facts, {})
    )
    assert "- F " not in _evidence_text({"section_id": "9", "observations": obs}, {})


def test_sections_4_and_5_treat_every_observation_as_backup():
    from eval.judge_sections import _evidence_text

    obs = [{"id": "a", "COPE_dimension": "Protection", "location": "B1", "note": "spk ok"}]
    for section in ("4", "5"):
        text = _evidence_text({"section_id": section, "observations": obs}, {})
        assert "- O1 (backup observation, Protection, B1): spk ok" in text


def test_a_case_is_drafted_with_its_facts(monkeypatch, tmp_path):
    import json

    from eval import judge_sections

    seen = {}

    def draft(section_id, assessment, observations, facts=None, privacy=None):
        seen["facts"] = facts
        return {"subsections": [], "sources": {}}

    monkeypatch.setattr(judge_sections.orchestrator, "draft", draft)
    monkeypatch.setattr(judge_sections, "judge_rows", lambda name, case, d: [])
    case = {
        "section_id": "5",
        "assessment": {"reference": "R", "jurisdiction": "SG", "facility_type": "Office"},
        "observations": [],
        "facts": "Level I: total 100.",
    }
    path = tmp_path / "c.json"
    path.write_text(json.dumps(case))
    judge_sections.run_case(path)
    assert seen["facts"] == "Level I: total 100."


def test_only_sections_4_and_5_accept_professional_judgement(monkeypatch):
    from eval import judge_sections

    systems = []
    monkeypatch.setattr(
        judge_sections,
        "ask_judge",
        lambda system, user, schema: systems.append(system) or schema(issues=[]),
    )
    for section in ("4", "5", "7"):
        judge_sections.judge({"section_id": section, "observations": []}, "text", {})
    four, five, seven = systems
    assert judge_sections.JUDGEMENT in four and judge_sections.JUDGEMENT in five
    # Sections 7-12 keep rubric-v2.4 unchanged.
    assert judge_sections.JUDGEMENT not in seven
    # Only Section 5 treats loss-scenario assumptions as judgement (v2.6).
    assert judge_sections.SCENARIO in five
    assert judge_sections.SCENARIO not in four and judge_sections.SCENARIO not in seven
    assert judge_sections.rubric_version("5") == "rubric-v2.6"
    assert judge_sections.rubric_version("4") == "rubric-v2.5"
    assert judge_sections.rubric_version("7") == "rubric-v2.4"


def test_a_privacy_run_drafts_with_protection_on_and_records_it(monkeypatch, tmp_path):
    import json

    from eval import judge_sections

    seen = {}

    def draft(section_id, assessment, observations, facts=None, privacy=None):
        seen["privacy"] = privacy
        return {"subsections": [], "sources": {}}

    monkeypatch.setattr(judge_sections.orchestrator, "draft", draft)
    monkeypatch.setattr(judge_sections, "judge_rows", lambda name, case, d: [])
    case = {
        "section_id": "7",
        "assessment": {"reference": "R", "jurisdiction": "SG", "facility_type": "Office"},
        "observations": [],
        "known_entities": [{"type": "CLIENT", "names": ["Acme"]}],
    }
    path = tmp_path / "c.json"
    path.write_text(json.dumps(case))

    judge_sections.run_case(path, privacy=True)

    assert seen["privacy"] == {
        "enabled": True,
        "known_entities": [{"type": "CLIENT", "names": ["Acme"]}],
    }

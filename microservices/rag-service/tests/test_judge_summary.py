"""The Executive Summary eval (GN-07 AC2): scoring, the judge's input and a run's rows.
Drafting and the judge are monkeypatched, so no paid call is made."""

import json


def issue(criterion, severity="major"):
    from eval.judge_summary import Issue

    return Issue(criterion=criterion, severity=severity, quote="x", problem="y")


def test_the_summary_eval_passes_only_above_its_floors():
    from eval.judge_summary import passes, scores_from

    assert passes(scores_from([issue("conventions", "minor")]))
    # One major grounding problem drops grounding to 4.0, still at its floor; two do not.
    assert passes(scores_from([issue("grounding")]))
    assert not passes(scores_from([issue("grounding"), issue("grounding")]))
    assert not passes(scores_from([issue("no_invention"), issue("no_invention")]))
    # Every criterion floors at 1.
    assert scores_from([issue("coverage")] * 6)["coverage"] == 1


def test_the_judge_sees_each_statements_cited_sections():
    from eval.judge_summary import summary_text

    statements = [
        {"text": "Rated B overall.", "citations": ["S:4"]},
        {"text": "Valves supervised.", "citations": ["S:3", "S:9"]},
        {"text": "Stray.", "citations": []},
    ]
    assert summary_text(statements) == (
        "- Rated B overall. [cites S4]\n"
        "- Valves supervised. [cites S3, S9]\n"
        "- Stray. [cites nothing]"
    )


def test_a_run_judges_the_draft_and_marshs_summary(monkeypatch, tmp_path):
    from eval import judge_summary

    draft = {
        "statements": [{"text": "Rated B overall.", "citations": ["S:4"]}],
        "guardrail": {"passed": True, "unsupported_count": 0},
        "provenance": {"model": "m", "effort": "medium"},
    }
    seen = []
    monkeypatch.setattr(
        judge_summary.orchestrator, "draft_summary_for", lambda a, s, privacy=None: draft
    )
    monkeypatch.setattr(
        judge_summary,
        "ask_judge",
        lambda system, user, schema: seen.append(user) or schema(issues=[issue("coverage")]),
    )
    case = {
        "assessment": {"reference": "R", "jurisdiction": "SG", "facility_type": "Office"},
        "sections": [{"id": "4", "title": "Risk Quality", "text": "Rating B."}],
        "reference": "Marsh's summary.",
    }
    path = tmp_path / "c.json"
    path.write_text(json.dumps(case))

    rows = judge_summary.run_case(path)
    assert [r["subject"] for r in rows] == ["draft", "marsh"]
    assert rows[0]["scores"]["coverage"] == 4.0 and rows[0]["passed"]
    assert rows[0]["unsupported_count"] == 0 and rows[1]["unsupported_count"] is None
    assert rows[0]["prompt_version"] == judge_summary.SUMMARY_PROMPT_VERSION
    # The judge reads each section by its label, then the text to assess.
    assert "[S4] Risk Quality\nRating B." in seen[0]
    assert "- Rated B overall. [cites S4]" in seen[0]
    assert "Marsh's summary." in seen[-1]


def test_rejudge_scores_the_newest_saved_draft_without_drafting(monkeypatch, tmp_path):
    from eval import judge_summary

    case = {
        "assessment": {"reference": "R", "jurisdiction": "SG", "facility_type": "Office"},
        "sections": [{"id": "4", "title": "Risk Quality", "text": "Rating B."}],
        "reference": "Marsh's summary.",
    }
    (tmp_path / "summary_cases").mkdir()
    (tmp_path / "summary_cases" / "c.json").write_text(json.dumps(case))
    (tmp_path / "results").mkdir()

    def saved(text, version):
        draft = {
            "statements": [{"text": text, "citations": ["S:4"]}],
            "guardrail": {"passed": True, "unsupported_count": 0},
            "provenance": {"model": "m", "effort": "medium"},
        }
        return json.dumps({"case": "c", "draft": draft, "prompt_version": version})

    marsh_row = json.dumps({"case": "c", "draft": None, "prompt_version": "old"})
    lines = [saved("Old.", "v1"), marsh_row, saved("Newest.", "v2"), marsh_row]
    (tmp_path / "results" / "summary-2026-10-18.jsonl").write_text("\n".join(lines))
    monkeypatch.setattr(judge_summary, "HERE", tmp_path)
    # Drafting again would be a paid Claude call, so it must not happen.
    monkeypatch.setattr(judge_summary.orchestrator, "draft_summary_for", None)
    seen = []
    monkeypatch.setattr(
        judge_summary,
        "ask_judge",
        lambda system, user, schema: seen.append(user) or schema(issues=[]),
    )

    rows = judge_summary.rejudge([])
    assert [r["subject"] for r in rows] == ["draft", "marsh"]
    assert "- Newest. [cites S4]" in seen[0]
    assert all(r["rejudged"] and r["prompt_version"] == "v2" for r in rows)


def test_a_privacy_run_drafts_with_protection_on_and_records_it(monkeypatch, tmp_path):
    from eval import judge_summary

    seen = {}

    def draft(assessment, sections, privacy=None):
        seen["privacy"] = privacy
        return {
            "statements": [],
            "guardrail": {"passed": True, "unsupported_count": 0},
            "provenance": {
                "model": "m",
                "effort": "e",
                "privacy": {"enabled": True, "masked_count": 2},
            },
        }

    monkeypatch.setattr(judge_summary.orchestrator, "draft_summary_for", draft)
    monkeypatch.setattr(judge_summary, "judge", lambda case, text, finished: [])
    case = {
        "assessment": {"reference": "R", "jurisdiction": "SG", "facility_type": "Office"},
        "sections": [{"id": "4", "title": "Risk Quality", "text": "Rating B."}],
        "reference": "Marsh's summary.",
    }
    path = tmp_path / "c.json"
    path.write_text(json.dumps(case))

    rows = judge_summary.run_case(path, privacy=True)

    assert seen["privacy"] == {"enabled": True, "known_entities": []}
    assert rows[0]["privacy"] == {"enabled": True, "masked_count": 2}

"""Model-free check of scoring.py with fake answers (IN-05, AC11).

Run from microservices/ingestion-service: uv run --extra dev python -m pytest eval/labelling -q
"""

from eval.labelling import scoring as s

CASE = {
    "id": "c1", "split": "tune", "kind": "fm",
    "expected": {"source_type": "fm_standard", "title": "Data Sheet 2-0", "edition": None,
                 "effective_date": None, "jurisdiction": "all", "facility_type": "all"},
    "evidence": {},
}  # fmt: skip
TEXT = "FM Global Data Sheet 2-0 installation"


def ok(value, conf=0.9):
    return {"value": value, "confidence": conf, "page": 1, "quote": "q"}


def raw(answers, status="ok"):
    return {"status": status, "answers": answers, "usage": {}}


def test_classifier_scored_by_cutoff_and_failure_is_all_null():
    answers = {
        "source_type": ok("fm_standard", 0.95),
        "jurisdiction": ok("SG", 0.6),
        "facility_type": ok("all", 0.9),
    }
    hi = s.metrics(s.score_case(CASE, "jev", {"jev": raw(answers)}, TEXT, 0.5))
    lo = s.metrics(s.score_case(CASE, "jev", {"jev": raw(answers)}, TEXT, 0.8))
    # at 0.5 jurisdiction SG is auto-filled and wrong; at 0.8 it is dropped, then defaults to "all"
    assert hi["n_auto"] == 3 and hi["cwaf"] == 2 / 3
    assert lo["cwaf"] == 1.0
    failed = s.score_case(
        CASE, "jev", {"jev": raw(None, "error"), "haiku": raw(answers)}, TEXT, 0.5
    )
    assert all(r["got"] is None for r in failed)
    assert s.score_case(CASE, "jev", {"jev": raw(None, "na")}, TEXT, 0.5) == []


def test_llm_free_text_grounded_and_edition_skipped_for_reports():
    answers = {"title": ok("Data Sheet 2-0"), "effective_date": ok("2026-04-01")}
    rows = s.score_case(CASE, "haiku", {"haiku": raw(answers)}, TEXT, 0.8)
    free = {r["detail"]: r for r in rows if r["group"] == "free"}
    assert free["title"]["ok"] and free["effective_date"]["got"] is None  # date not in text
    report = {**CASE, "expected": {**CASE["expected"], "source_type": "marsh_report"}}
    rows = s.score_case(report, "haiku", {"haiku": raw({})}, TEXT, 0.8)
    assert "edition" not in {r["detail"] for r in rows}


def test_sweep_and_winners():
    by = {
        0.5: {"cwaf": 0.8, "auto": 1.0},
        0.6: {"cwaf": 0.9, "auto": 1.0},
        0.7: {"cwaf": 1.0, "auto": 1.0},  # same auto-fill, more accurate: wins
        0.8: {"cwaf": 1.0, "auto": 0.9},
    }
    assert s.best_cutoff(by) == 0.7
    assert s.best_cutoff({0.5: {"cwaf": None, "auto": 0}, 0.6: {"cwaf": 0.5, "auto": 1}}) is None
    fixed = {
        "jev": {"cutoff": 0.7, "auto": 0.8, "cwaf": 0.95, "cost": 0.1},
        "haiku": {"cutoff": 0.6, "auto": 0.8, "cwaf": 0.95, "cost": 0.5},
        "dec": {"cutoff": 0.6, "auto": 0.8, "cwaf": 0.9, "cost": 0.0},
        "luna": {"cutoff": None, "auto": 1.0, "cwaf": 0.5, "cost": 0.0},
    }
    # luna never reaches 90%; jev ties haiku on auto-fill and accuracy, and is cheaper.
    assert s.pick_fixed_winner(fixed) == "jev"
    free = {
        "haiku": {"cwaf": 0.9, "auto": 0.5, "cost": 1},
        "luna": {"cwaf": 0.9, "auto": 0.6, "cost": 2},
    }
    assert s.pick_free_winner(free) == "luna"
    assert s.pick_fixed_winner({"jev": {"cutoff": None, "auto": 1, "cwaf": 1, "cost": 0}}) is None


def test_final_rows_combine_classifier_and_llm():
    classifier = {
        "source_type": ok("fm_standard"),
        "jurisdiction": ok("all"),
        "facility_type": ok("all"),
    }
    llm = {"title": ok("Data Sheet 2-0")}
    rows = s.final_rows(CASE, "jev", "luna", {"jev": raw(classifier), "luna": raw(llm)}, TEXT, 0.8)
    assert {r["detail"]: r["ok"] for r in rows}["title"] and s.metrics(rows)["correct"] == 1.0

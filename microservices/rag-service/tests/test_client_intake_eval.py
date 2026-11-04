"""Client intake eval scoring (CP-23): counted in code against a key, checked here with
hand-made responses. No model is called."""

import json
from pathlib import Path

from eval.client_intake.scoring import score_case, summarise

EVAL = Path(__file__).parents[1] / "eval" / "client_intake"

KEY = {
    "id": "k1",
    "client": {"name": "Acme Pte Ltd", "division": None, "existing_id": None},
    "sites": [
        {"ref": "site-1", "name": "Acme Tower", "address": "1 Shenton Link, Singapore 068801",
         "jurisdiction": "SG", "facility_type": None, "existing_site_id": None},
        {"ref": "site-2", "name": "Acme Hub", "address": "5 Science Park Drive, Singapore 118228",
         "jurisdiction": "SG", "facility_type": "Office", "existing_site_id": "s-9"},
    ],
    "assessments": [
        {"ref": "a-1", "site_ref": "site-1", "visit_type": "First survey",
         "site_visit_date": "2027-02-02", "site_visit_end_date": None, "report_due_date": None,
         "site_contacts": [{"name": "Lim Wei", "role": "Property Manager"}]},
        {"ref": "a-2", "site_ref": "site-2", "visit_type": "Resurvey",
         "site_visit_date": None, "site_visit_end_date": None, "report_due_date": "2027-04-01",
         "site_contacts": []},
    ],
    "documents": [
        {"id": "f1", "placement": {"kind": "client"}},
        {"id": "f2", "placement": {"kind": "site", "ref": "site-1"}},
        {"id": "f3", "placement": {"kind": "assessment", "ref": "a-2"}},
    ],
}  # fmt: skip


def f(value):
    return {"value": value, "source": None}


def good_response():
    return {
        "client": {"name": f("ACME Pte. Ltd."), "division": f(None), "existing_id": None,
                   "match_not_sure": False},
        "sites": [
            {"ref": "s1", "existing_id": None, "match_not_sure": False, "name": f("Acme Tower"),
             "address": f("1 Shenton Link Singapore 068801"), "jurisdiction": f("SG"),
             "facility_type": f(None)},
            {"ref": "s2", "existing_id": "s-9", "match_not_sure": False, "name": f("Acme Hub"),
             "address": f("5 Science Park Drive, Singapore 118228"), "jurisdiction": f("SG"),
             "facility_type": f("Office")},
        ],
        "assessments": [
            {"ref": "x1", "site_ref": "s1", "visit_type": f("First survey"),
             "site_visit_date": f("2027-02-02"), "site_visit_end_date": f(None),
             "report_due_date": f(None),
             "site_contacts": [{"name": "Mr Lim Wei", "role": "Property Manager", "source": None}]},
            {"ref": "x2", "site_ref": "s2", "visit_type": f("Resurvey"),
             "site_visit_date": f(None), "site_visit_end_date": f(None),
             "report_due_date": f("2027-04-01"), "site_contacts": []},
        ],
        "documents": [
            {"id": "f1", "placement": {"kind": "client"}, "not_sure": False},
            {"id": "f2", "placement": {"kind": "site", "ref": "s1"}, "not_sure": False},
            {"id": "f3", "placement": {"kind": "assessment", "ref": "x2"}, "not_sure": False},
        ],
    }  # fmt: skip


def test_a_perfect_response_scores_everything_right():
    summary = summarise([score_case(KEY, good_response())])

    assert summary["accuracy"] == 1.0
    assert summary["empty_when_absent"] == 1.0
    assert summary["client_match"]["correct"] == summary["site_match"]["correct"] == 1.0
    assert summary["placement"] == 1.0
    assert summary["contacts_found"] == summary["contact_roles"] == 1.0
    assert summary["counts_exact"] == 1.0


def test_a_filled_absent_value_and_a_wrong_value_are_counted_apart_from_not_sure():
    r = good_response()
    r["sites"][0]["facility_type"] = f("Office")  # the key says off-list, so empty is right
    r["assessments"][0]["site_visit_date"] = f("2027-02-03")  # wrong
    r["assessments"][1]["report_due_date"] = f(None)  # present in the key: Not sure
    row = score_case(KEY, r)

    assert row["site_facility_type.filled_when_absent"] == 1
    assert row["site_visit_date.wrong"] == 1
    assert row["report_due_date.not_sure"] == 1
    summary = summarise([row])
    assert summary["fields"]["site_facility_type"]["empty_when_absent"] == 0.0
    assert summary["fields"]["site_visit_date"]["wrong"] == 1.0
    assert summary["fields"]["report_due_date"]["not_sure"] == 1.0


def test_matching_a_recorded_site_proposed_as_new_is_wrong_unless_marked_not_sure():
    r = good_response()
    r["sites"][1]["existing_id"] = None
    assert score_case(KEY, r)["site_match.wrong"] == 1
    r["sites"][1]["match_not_sure"] = True
    assert score_case(KEY, r)["site_match.not_sure"] == 1


def test_a_site_proposed_twice_is_extra_and_its_assessments_are_extra():
    r = good_response()
    r["sites"].append({**r["sites"][0], "ref": "s3"})
    r["assessments"].append({**r["assessments"][0], "ref": "x3", "site_ref": "s3"})
    row = score_case(KEY, r)

    assert row["sites.extra"] == 1 and row["assessments.extra"] == 1
    assert row["counts_exact"] == 0


def test_a_missing_site_leaves_its_values_as_not_sure_and_its_documents_misplaced():
    r = good_response()
    r["sites"].pop(0)
    r["assessments"].pop(0)
    row = score_case(KEY, r)

    assert row["sites.found"] == 1 and row["assessments.found"] == 1
    assert row["visit_type.not_sure"] == 1
    assert row["contacts.found"] == 0
    assert row["placement.correct"] == 2  # the site document pointed at a site that is gone


def test_a_document_that_fell_back_to_the_client_is_wrong_but_counted_as_not_sure():
    r = good_response()
    r["documents"][2] = {"id": "f3", "placement": {"kind": "client"}, "not_sure": True}
    row = score_case(KEY, r)

    assert row["placement.correct"] == 2 and row["placement.not_sure"] == 1


def test_every_golden_case_has_a_plan_and_valid_placements():
    plans = {p["id"]: p for p in json.loads((EVAL / "plans.json").read_text())}
    assert len(plans) == 24
    assert sum(p["split"] == "tuning" for p in plans.values()) == 12
    for case in json.loads((EVAL / "golden.json").read_text())["cases"]:
        key = case["key"]
        assert key == plans[case["id"]]
        ids = {d["id"] for d in case["request"]["documents"]}
        refs = {s["ref"] for s in key["sites"]} | {a["ref"] for a in key["assessments"]}
        assert ids == {d["id"] for d in key["documents"]}, case["id"]
        assert all(d["placement"].get("ref", next(iter(refs))) in refs for d in key["documents"])
        assert all(a["site_ref"] in refs for a in key["assessments"])
        # A recorded client or site in the key must be one the request lists.
        listed = {c["id"] for c in case["request"]["clients"]}
        assert key["client"]["existing_id"] in listed | {None}, case["id"]


# ---- run_eval.py and sweep.py: the cutoff sweep and the llm pick adapter (no model called) ----

from eval.client_intake import run_eval, sweep  # noqa: E402


def _pick(decision, probability, right):
    return {"decision": decision, "probability": probability, "right": right}


def test_the_sweep_picks_the_lowest_cutoff_whose_kept_picks_meet_the_target():
    # Wrong picks sit at 0.3 and 0.6; at 0.65 only right ones are kept.
    rows = [(0.3, False), (0.6, False), (0.7, True), (0.8, True), (0.9, True), (0.95, True)]
    picks = [_pick("placement", p, r) for p, r in rows]

    assert sweep.lowest_cutoff(picks, 0.95) == 0.65
    accuracy, emptied = sweep.at_cutoff(picks, 0.65)
    assert accuracy == 1.0 and round(emptied, 2) == 0.33
    assert sweep.lowest_cutoff([_pick("placement", 0.9, False)], 0.95) is None


def test_the_sweep_leaves_out_picks_the_key_cannot_grade():
    runs = [{"picks": [_pick("visit_type", 0.9, None), _pick("visit_type", 0.9, True)]}]

    assert len(sweep.picks_of(runs, "visit_type")) == 1


def test_the_match_sweep_takes_the_lowest_threshold_with_no_false_match():
    items = [
        {"similarity": 0.95, "best_id": "c1", "key_id": "c1"},
        {"similarity": 0.75, "best_id": "c2", "key_id": None},  # a similar-name trap
        {"similarity": 0.70, "best_id": "c3", "key_id": "c3"},  # a typo, still the same client
    ]

    assert sweep.choose_match(items) == (0.8, 0.7)
    assert sweep.tally(items, 0.8, 0.7) == {
        "correct": 2, "false_match": 0, "not_sure": 1, "missed": 0,
    }  # fmt: skip


def test_applying_cutoffs_empties_picks_below_them_and_sends_a_document_to_the_client():
    response = {
        "sites": [{"facility_type": {"value": "Office", "source": None},
                   "jurisdiction": {"value": "SG", "source": None}}],
        "assessments": [{"visit_type": {"value": "Resurvey", "source": None}}],
        "documents": [{"id": "f1", "placement": {"kind": "site", "ref": "site-1"}}],
    }  # fmt: skip
    calls = [("facility_1", "type_7", 0.4), ("jurisdiction_1", "SG", 0.9),
             ("visit_1", "resurvey", 0.2), ("placement_1", "site_1", 0.3)]  # fmt: skip
    cutoffs = {"facility_type": 0.5, "jurisdiction": 0.5, "visit_type": 0.5, "placement": 0.5}

    out = run_eval.apply_cutoffs(response, calls, cutoffs)

    assert out["sites"][0]["facility_type"]["value"] is None
    assert out["sites"][0]["jurisdiction"]["value"] == "SG"
    assert out["assessments"][0]["visit_type"]["value"] is None
    assert out["documents"][0] == {"id": "f1", "placement": {"kind": "client"}, "not_sure": True}
    assert response["sites"][0]["facility_type"]["value"] == "Office"  # the raw response is kept


def test_the_llm_adapter_answers_a_batch_in_one_call_with_probability_one(monkeypatch):
    seen = []

    def fake_complete(system, user, schema, effort, feature, model):
        seen.append(schema)
        return schema(facility_1="type_2", jurisdiction_1="other"), model

    monkeypatch.setattr(run_eval, "complete", fake_complete)
    questions = {
        "facility_1": ("Which type?", {"type_1": "Office", "type_2": "Cold store"}),
        "jurisdiction_1": ("Which country?", {"SG": "Singapore", "other": "Another"}),
    }

    answers = run_eval.make_llm_choose()("Site 1: Frosty", questions)

    assert answers == {"facility_1": ("type_2", 1.0), "jurisdiction_1": ("other", 1.0)}
    assert len(seen) == 1


def test_grade_picks_marks_each_pick_right_or_wrong_against_the_key():
    key = {
        "sites": [{"ref": "site-1", "name": "Frosty", "address": "1 Cold Way, Singapore 111111",
                   "jurisdiction": "SG", "facility_type": "Cold store",
                   "existing_site_id": None}],
        "assessments": [],
        "documents": [{"id": "f1", "placement": {"kind": "client"}}],
    }  # fmt: skip
    response = {
        "sites": [{"ref": "site-1", "existing_id": None,
                   "name": {"value": "Frosty"},
                   "address": {"value": "1 Cold Way, Singapore 111111"}}],
        "assessments": [],
    }  # fmt: skip
    request = {"facility_types": ["Office", "Cold store"], "documents": [{"id": "f1"}]}
    calls = [("facility_1", "type_2", 0.9), ("jurisdiction_1", "MY", 0.6),
             ("placement_1", "client", 0.8)]  # fmt: skip

    picks = run_eval.grade_picks(calls, request, key, response)

    assert [p["right"] for p in picks] == [True, False, True]
    assert picks[0]["field"] == "site-1.facility_type" and picks[2]["field"] == "f1.placement"

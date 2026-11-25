"""CP-24 rating eval: the scoring arithmetic and finding-matching, with fake rows. No model."""

from eval.site_walk.rate_eval import findings, score, sweep


def row(p_cat, cat_right, p_sev, sev_right):
    return {"probabilities": {"category": p_cat, "severity": p_sev},
            "category_right": cat_right, "severity_right": sev_right}  # fmt: skip


ROWS = [
    row(0.95, True, 0.90, True),
    row(0.80, True, 0.60, False),  # severity marked at 0.70
    row(0.60, False, 0.75, True),  # category marked at 0.70
    row(0.99, True, 0.99, False),
]


def test_agreement_marked_share_and_accuracy_when_not_marked():
    s = score(ROWS, 0.70)

    assert s["n"] == 4
    assert s["category"] == {"agreement": 0.75, "marked": 0.25, "right_when_not_marked": 1.0}
    assert s["severity"] == {"agreement": 0.5, "marked": 0.25, "right_when_not_marked": 2 / 3}


def test_a_probability_equal_to_the_cutoff_is_not_marked():
    assert score([row(0.70, True, 0.70, True)], 0.70)["category"]["marked"] == 0.0


def test_the_sweep_runs_from_050_to_095_and_marking_only_grows():
    s = sweep(ROWS)

    assert [x["cutoff"] for x in s] == [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95]
    marked = [x["category"]["marked"] for x in s]
    assert marked == sorted(marked)
    assert s[-1]["category"]["right_when_not_marked"] == 1.0  # only 0.99 stays unmarked


def test_nothing_unmarked_gives_no_accuracy_not_zero():
    assert score([row(0.1, False, 0.1, False)], 0.70)["category"]["right_when_not_marked"] is None


def test_a_finding_with_no_saved_note_is_skipped_and_counted():
    cases = [
        {"id": "a", "expected": {"observations": [{"keywords": ["pump"]}, {"keywords": ["door"]}]}},
        {"id": "b", "expected": {"observations": [{"keywords": ["valve"]}]}},  # not saved
    ]
    saved = [{"case": "a", "proposal": {"observations": [{"note": "Fire pump on manual."}]}}]

    found, skipped = findings(cases, saved)

    assert [(c, e["keywords"], n) for c, e, n in found] == [("a", ["pump"], "Fire pump on manual.")]
    assert skipped == 2

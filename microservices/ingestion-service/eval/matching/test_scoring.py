"""Model-free check of scoring.py with fixed numbers (IN-07, AC16).

Run from microservices/ingestion-service: uv run pytest -q eval/matching
"""

from eval.matching import scoring as s

FLAG = {"copy": True, "other": False}


def test_share_is_the_larger_side():
    counts = {"newMatched": 3, "newTotal": 10, "storedMatched": 9, "storedTotal": 10}
    assert s.share(counts) == 0.9


def test_share_with_empty_side_is_zero():
    counts = {"newMatched": 0, "newTotal": 0, "storedMatched": 0, "storedTotal": 0}
    assert s.share(counts) == 0.0


def test_margin_is_gap_between_copies_and_non_copies():
    margin, low, high = s.margin_at({"copy": 0.9, "other": 0.3}, FLAG)
    assert (round(margin, 2), low, high) == (0.6, 0.9, 0.3)


def test_pick_takes_widest_margin_and_midpoint():
    by_t = {0.80: {"copy": 0.9, "other": 0.6}, 0.90: {"copy": 0.9, "other": 0.2}}
    got = s.pick(by_t, FLAG)
    assert got["T"] == 0.90
    assert round(got["S"], 2) == 0.55
    assert round(got["margin"], 2) == 0.7


def test_pick_tie_goes_to_t_nearest_default():
    by_t = {0.80: {"copy": 0.9, "other": 0.2}, 0.85: {"copy": 0.9, "other": 0.2}}
    assert s.pick(by_t, FLAG)["T"] == 0.85


def test_pick_reports_negative_margin_when_unseparable():
    got = s.pick({0.90: {"copy": 0.4, "other": 0.5}}, FLAG)
    assert got["margin"] < 0

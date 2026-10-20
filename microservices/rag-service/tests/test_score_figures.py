"""Proposed-figure eval scoring (GN-03 addendum AC16): counted in code against Marsh's
real figures in a case's `facts`, no judge."""

from eval.score_figures import expected_levels, expected_scores, score_levels, score_scores

S4_FACTS = """Current Location Risk Quality Score: 83.9
Current Location Risk Quality Rating: B
External Exposure: current 9, potential 10
Fire Protection: current 8.1, potential 10"""

S5_FACTS = """Values in SGD as at 2026-01-01; indemnity period 46 months.
Buildings: 1200000000
Level II: L27 to L29 100% damage, loss 73469388; value 73469388; L30 to L31 30% damage, \
loss 14693877.6; value 48979592; Business Interruption (Gross Revenue) 8 months at 11% \
impacted, loss 7652173.91; total 114182786.51."""


def test_reads_marshs_scores_from_the_facts():
    assert expected_scores(S4_FACTS) == {
        "External Exposure": (9, 10),
        "Fire Protection": (8.1, 10),
    }


def test_counts_scores_within_one_point_their_bias_and_the_always_8_baseline():
    proposed = [
        {"category": "External Exposure", "current": 8, "potential": 10},
        {"category": "Fire Protection", "current": None, "potential": 8.5},
    ]
    result = score_scores(expected_scores(S4_FACTS), proposed)
    # 4 figures: 9 vs 8 (off by 1), 10 vs 10, 8.1 left blank, 10 vs 8.5 (off by 1.5).
    assert result["figures"] == 4
    assert result["blank"] == 1
    assert result["exact"] == 1
    assert result["within_one"] == 2
    # Every miss was low: the proposals under-score, as Section 6's ranks did.
    assert result["mean_signed_error"] == round((-1 + 0 - 1.5) / 3, 2)
    # "Every score 8" is within one of 9 and 8.1 only.
    assert result["baseline_8_within_one"] == 2


def test_reads_each_levels_areas_and_bi_items():
    assert expected_levels(S5_FACTS) == {
        "II": {
            "damage": {"l27 to l29": 100, "l30 to l31": 30},
            "te": {"business interruption (gross revenue)": (8, 11)},
        }
    }


def test_counts_level_figures_within_tolerance_matched_by_area():
    proposed = [
        {
            "level": "II",
            "damage": [
                {"item": "L27 to L29", "percent": 95},
                {"item": "L22 to L26", "percent": 15},  # an area Marsh did not name
            ],
            "te": [{"item": "Business Interruption (Gross Revenue)", "months": 12, "percent": 11}],
        }
    ]
    result = score_levels(expected_levels(S5_FACTS), proposed)
    assert result["areas_expected"] == 2
    assert result["areas_matched"] == 1
    assert result["damage_within_10"] == 1
    assert result["unmatched_proposed"] == 1
    # 12 months against Marsh's 8 is outside 3; 11% is exact.
    assert result["months_within_3"] == 0
    assert result["bi_percent_within_10"] == 1


def test_an_area_named_with_a_description_still_matches_marshs():
    # The model adds how an area is damaged; the floors are what match (eval, 20 Oct).
    proposed = [
        {
            "level": "II",
            "damage": [{"item": "L27 to L29 (floors linked by internal stair)", "percent": 95}],
            "te": [],
        }
    ]
    result = score_levels(expected_levels(S5_FACTS), proposed)
    assert result["areas_matched"] == 1 and result["damage_within_10"] == 1

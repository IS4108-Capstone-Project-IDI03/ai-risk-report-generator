"""Section 6 rank eval scoring (GN-11 AC6): counted in code from Marsh's ranks, no judge."""

from eval.score_ranks import score

EXPECTED = {
    "Building Maintenance": {"rank": "Embedded", "evidence": ["o1"]},
    "Housekeeping": {"rank": "Embedded", "evidence": ["o2"]},
    "Hot Work Permit System": {"rank": "Formalized", "evidence": ["o3"]},
    "Smoking Controls": {"rank": "Optimized", "evidence": ["o4"]},
    # No observation covers these: the model should leave them unrated.
    "Contractor Management": {"rank": "Embedded", "evidence": []},
    "Management of Change": {"rank": "Embedded", "evidence": []},
    # Unreadable in the stored report: scored nowhere.
    "Emergency Response Planning": {"rank": None, "evidence": []},
}


def draft(*rows):
    return {
        "subsections": [
            {
                "heading": "Management Programs",
                "kind": "fields",
                "statements": [{"text": t, "citations": [], "supported": True} for t in rows],
            }
        ]
    }


def test_counts_exact_within_one_baseline_and_unrated_rows():
    result = score(
        EXPECTED,
        draft(
            "Building Maintenance: Embedded. Checks every 5 years.",  # exact
            "Housekeeping: Established. Generally good.",  # one below
            "Hot Work Permit System: Optimized. Permits issued.",  # two above
            # Smoking Controls left out although evidenced: not rated.
            "Contractor Management: Embedded. Inductions.",  # rated with no evidence
            "Emergency Response Planning: Embedded. ERT exists.",  # unscored row
        ),
    )

    assert result == {
        "evidenced_rows": 4,
        "rated": 3,
        "exact": 1,
        "within_one": 2,
        # "Always Embedded" over the same evidenced rows: 2 of the 4 are Embedded.
        "baseline_always_embedded": 2,
        "evidenced_but_unrated": 1,
        "rated_without_evidence": 1,
    }


def test_a_rank_outside_the_five_counts_as_rated_but_never_matches():
    result = score(EXPECTED, draft("Building Maintenance: Excellent. Tidy."))
    assert result["rated"] == 1 and result["exact"] == 0 and result["within_one"] == 0

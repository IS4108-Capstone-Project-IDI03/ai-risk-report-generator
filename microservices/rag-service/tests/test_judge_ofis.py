"""The OFI eval's scoring (GN-05 AC7), worked out in code. No judge call is made."""


# AC7: the eval's pass mark, worked out in code from the judge's issues.
def test_the_ofi_eval_passes_only_above_its_floors():
    from eval.judge_ofis import Issue, passes, scores_from

    def issue(criterion, severity="major"):
        return Issue(criterion=criterion, severity=severity, quote="x", problem="y")

    assert passes(scores_from([issue("field_fit", "minor")]))
    # One major grounding problem drops grounding to 4.0, still at its floor; two do not.
    assert passes(scores_from([issue("grounding")]))
    assert not passes(scores_from([issue("grounding"), issue("grounding")]))
    assert not passes(scores_from([issue("restraint"), issue("restraint")]))


# The eval also reports how often drafted priorities match Marsh's (not part of the pass mark).
def test_priority_agreement_counts_exact_and_one_step_matches():
    from eval.judge_ofis import priority_agreement

    marsh = {"o1": "Priority 2", "o2": "Priority 1", "o3": "Priority 3"}
    ofis = [
        {"observations": ["o1"], "priority": "Priority 2"},  # exact
        {"observations": ["o2"], "priority": "Priority 2"},  # one step out
        {"observations": ["o3"], "priority": "Priority 1"},  # two steps out
        {"observations": ["other"], "priority": "Priority 1"},  # no Marsh OFI: not counted
    ]
    assert priority_agreement(ofis, marsh) == {"compared": 3, "exact": 1, "within_one": 2}

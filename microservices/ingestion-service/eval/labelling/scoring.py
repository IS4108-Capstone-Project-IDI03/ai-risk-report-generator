"""Pure scoring, cutoff-sweep and winner functions for the labelling evaluation (IN-05, AC11).

Called by run_eval.py and test_scoring.py. Calls app/labelling/decide.py exactly as
production does. No network, no files, so it can be checked with fake answers.
"""

import os

from app.labelling import config, decide

CLASSIFIERS = ("jev", "openai-decisions")
LLMS = ("haiku", "luna")
FREE = ("title", "edition", "effective_date")
GROUP_CANDS = {"fixed": CLASSIFIERS + LLMS, "free": LLMS}
GROUP_DETAILS = {"fixed": config.FIXED_LIST, "free": FREE}
CUTOFFS = [0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95, 0.99]
TARGET = 0.90


def subset_of(case: dict) -> str:
    """Return 'reports' for report-like cases (by expected source type), else 'standards'."""
    kind, source = case["kind"], case["expected"]["source_type"]
    return "reports" if kind in ("report", "template") or source == "marsh_report" else "standards"


def same(detail: str, got, expected) -> bool:
    """Return True if got equals expected (titles are compared after normalising)."""
    if detail == "title" and got and expected:
        return decide.normalise(got) == decide.normalise(expected)
    return got == expected


def _answers(raw_case: dict, cand: str) -> dict:
    entry = raw_case.get(cand) or {}
    return entry.get("answers") or {} if entry.get("status") == "ok" else {}


def decided(cand: str, raw_case: dict, page_text: str, cutoff: float) -> dict:
    """Return decide.decide() output for one candidate, as production would compute it."""
    os.environ["LABEL_MIN_CONFIDENCE"] = str(cutoff)
    names = {"fixed": cand, "free": cand}
    own = _answers(raw_case, cand)
    if cand in CLASSIFIERS:
        # A failed classifier must score all-null. Without `or None`, decide() would fall
        # back to the LLM's fixed-list answers and credit the classifier for them.
        return decide.decide(
            own or None, {} if not own else _answers(raw_case, "haiku"), page_text, names
        )
    return decide.decide(None, own, page_text, names)


def _row(case: dict, cand: str, group: str, detail: str, out: dict, raw_ans: dict) -> dict:
    got = out[detail]["value"]
    expected = case["expected"][detail]
    return {
        "case": case["id"], "cand": cand, "group": group, "detail": detail,
        "expected": expected, "got": got, "raw": raw_ans.get("value"),
        "conf": raw_ans.get("confidence"), "ok": same(detail, got, expected),
        "quote": ((case["evidence"] or {}).get(detail) or {}).get("quote", ""),
        "subset": subset_of(case), "split": case["split"],
    }  # fmt: skip


def _skipped(case: dict, detail: str) -> bool:
    # Reports never have an edition; scoring it would inflate every score.
    return detail == "edition" and case["expected"]["source_type"] == "marsh_report"


def score_case(case: dict, cand: str, raw_case: dict, page_text: str, cutoff: float) -> list[dict]:
    """Return one row per scored detail for a candidate on a case ([] if n/a)."""
    if (raw_case.get(cand) or {}).get("status") == "na":
        return []
    out = decided(cand, raw_case, page_text, cutoff)
    own = _answers(raw_case, cand)
    return [
        _row(case, cand, g, d, out, own.get(d) or {})
        for g in ("fixed", "free")
        if cand in GROUP_CANDS[g]
        for d in GROUP_DETAILS[g]
        if not _skipped(case, d)
    ]


def final_rows(
    case: dict, fixed: str, free: str, raw_case: dict, page_text: str, cutoff: float
) -> list[dict]:
    """Return rows for all six details using the winning fixed-list and free-text models."""
    if fixed in CLASSIFIERS:
        # Production: the classifier decides the fixed list, the free-text LLM the rest.
        out = decide_with(fixed, free, raw_case, page_text, cutoff)
    else:
        out = decided(fixed, raw_case, page_text, cutoff)
        if free != fixed:
            other = decided(free, raw_case, page_text, cutoff)
            out = {**out, **{d: other[d] for d in FREE}}
    model = {d: fixed if d in config.FIXED_LIST else free for d in out}
    sources = {d: _answers(raw_case, model[d]) for d in out}
    return [
        _row(case, model[d], "final", d, out, sources[d].get(d) or {})
        for d in config.DETAILS
        if not _skipped(case, d)
    ]  # fmt: skip


def decide_with(classifier: str, llm: str, raw_case: dict, page_text: str, cutoff: float) -> dict:
    """Return decide.decide() with a classifier for the fixed list and an LLM for the rest."""
    os.environ["LABEL_MIN_CONFIDENCE"] = str(cutoff)
    own = _answers(raw_case, classifier)
    extracted = _answers(raw_case, llm) if own else {}
    return decide.decide(own or None, extracted, page_text, {"fixed": classifier, "free": llm})


def metrics(rows: list[dict]) -> dict:
    """Return details scored, correct (all), auto-filled share and correct-when-auto-filled."""
    n = len(rows)
    auto = [r for r in rows if r["got"] is not None]
    return {
        "n": n,
        "n_auto": len(auto),
        "correct": sum(r["ok"] for r in rows) / n if n else None,
        "auto": len(auto) / n if n else None,
        "cwaf": sum(r["ok"] for r in auto) / len(auto) if auto else None,
    }


def best_cutoff(by_cutoff: dict[float, dict], target: float = TARGET) -> float | None:
    """Return the cutoff reaching the target that auto-fills most; ties: more accurate, then lower.

    Plain "lowest cutoff reaching 90%" can pick a less accurate cutoff that fills
    no more details (a raised cutoff can turn a wrong guess into the right "all"
    default for a standard).
    """
    passing = [c for c, m in by_cutoff.items() if m["cwaf"] is not None and m["cwaf"] >= target]
    return min(
        passing, key=lambda c: (-by_cutoff[c]["auto"], -by_cutoff[c]["cwaf"], c), default=None
    )


def pick_fixed_winner(stats: dict[str, dict]) -> str | None:
    """Return the candidate reaching 90% on tune with the most auto-fill; ties: accuracy, cost.

    stats: {candidate: {"cutoff": float | None, "auto": float, "cwaf": float, "cost": float}}.
    """
    eligible = {c: s for c, s in stats.items() if s["cutoff"] is not None}
    return min(
        eligible,
        key=lambda c: (-eligible[c]["auto"], -eligible[c]["cwaf"], eligible[c]["cost"]),
        default=None,
    )


def pick_free_winner(stats: dict[str, dict]) -> str | None:
    """Return the LLM with the best tune correct-when-auto-filled; ties: auto-fill, then cheaper.

    stats: {candidate: {"cwaf": float | None, "auto": float, "cost": float}}.
    """

    def key(c: str):
        s = stats[c]
        return (-(s["cwaf"] if s["cwaf"] is not None else -1), -s["auto"], s["cost"])

    return min(stats, key=key, default=None)

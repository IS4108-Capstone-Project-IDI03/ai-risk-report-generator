"""Pure picking of the duplicate-detection settings T and S (IN-07, AC16).

Called by run_eval.py and test_scoring.py. No network, no files.
A pair's "share" is max(newShare, storedShare), the number matching.py compares with S.
"""

THRESHOLDS = (0.80, 0.85, 0.90, 0.95)


def share(counts: dict) -> float:
    """Return the larger of the new-side and stored-side matched shares (0 if a side is empty)."""
    new = counts["newMatched"] / counts["newTotal"] if counts["newTotal"] else 0.0
    stored = counts["storedMatched"] / counts["storedTotal"] if counts["storedTotal"] else 0.0
    return max(new, stored)


def margin_at(shares: dict[str, float], must_flag: dict[str, bool]) -> tuple[float, float, float]:
    """Return (margin, lowest copy share, highest non-copy share) for one T.

    Margin is the gap between them: any S inside it classifies every pair right.
    Negative means no S can.
    """
    low = min(s for p, s in shares.items() if must_flag[p])
    high = max(s for p, s in shares.items() if not must_flag[p])
    return low - high, low, high


def pick(by_t: dict[float, dict[str, float]], must_flag: dict[str, bool], default_t: float = 0.90):
    """Return {T, S, margin, low, high, per_t} for the T with the widest margin.

    S is the middle of the gap. Ties go to the T closest to default_t.
    """
    per_t = {t: margin_at(by_t[t], must_flag) for t in by_t}
    best = max(per_t, key=lambda t: (round(per_t[t][0], 6), -abs(t - default_t)))
    margin, low, high = per_t[best]
    return {
        "T": best,
        "S": (low + high) / 2,
        "margin": margin,
        "low": low,
        "high": high,
        "per_t": per_t,
    }

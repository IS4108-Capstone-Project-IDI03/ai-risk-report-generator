"""Chooses the CP-23 confidence cutoffs from saved tuning runs (run_eval.py), no model calls.

    uv run python -m eval.client_intake.sweep eval/results/<tuning>.json [more.json]
        [--target 0.95] [--apply eval/results/<held-out>.json]
Per decision type it prints cutoff / kept accuracy / share emptied for 0.00-0.95, and the lowest
cutoff whose kept picks are right at least --target of the time. It does the same for
CLIENT_INTAKE_MATCH / MATCH_MAYBE. --apply then reports held-out results at the chosen values.
Reads run_eval.py's results. Pick cutoffs on tuning only; held-out is the result (LABELS.md).
"""

import argparse
import json
from pathlib import Path

DECISIONS = ["facility_type", "jurisdiction", "visit_type", "placement"]
GRID = [round(i * 0.05, 2) for i in range(20)]
MATCH_GRID = [round(0.5 + i * 0.05, 2) for i in range(11)]


def load_runs(paths) -> list[dict]:
    """Return every pack run in the saved result files."""
    return [r for p in paths for r in json.loads(Path(p).read_text())["runs"]]


def picks_of(runs: list[dict], decision: str) -> list[dict]:
    """Return the graded picks of one decision type (picks the key can't grade are left out)."""
    return [
        p for r in runs for p in r["picks"] if p["decision"] == decision and p["right"] is not None
    ]


def at_cutoff(picks: list[dict], cutoff: float) -> tuple[float | None, float | None]:
    """Return (kept accuracy, share emptied) when picks below `cutoff` are emptied."""
    kept = [p for p in picks if p["probability"] >= cutoff]
    accuracy = sum(p["right"] for p in kept) / len(kept) if kept else None
    return accuracy, (1 - len(kept) / len(picks)) if picks else None


def lowest_cutoff(picks: list[dict], target: float) -> float | None:
    """Return the lowest grid cutoff whose kept picks are right at least `target`, or None."""
    for c in GRID:
        accuracy, _ = at_cutoff(picks, c)
        if accuracy is not None and accuracy >= target:
            return c
    return None


def match_items(runs: list[dict]) -> list[dict]:
    """Return every client and site similarity the runs recorded."""
    return [i for r in runs for i in r["match"]["items"]]


def match_outcome(item: dict, match: float, maybe: float) -> str:
    """Return correct, false_match, not_sure or missed for one item at these thresholds."""
    if item["similarity"] >= match:
        return "correct" if item["best_id"] == item["key_id"] else "false_match"
    if item["key_id"] is None:
        return "correct"
    return "not_sure" if item["similarity"] >= maybe else "missed"


def choose_match(items: list[dict]) -> tuple[float | None, float | None]:
    """Return (MATCH, MATCH_MAYBE): the lowest MATCH with no false match, and the highest
    MAYBE that still flags every recorded item left below MATCH."""
    match = next(
        (m for m in MATCH_GRID if not any(match_outcome(i, m, m) == "false_match" for i in items)),
        None,
    )
    if match is None:
        return None, None
    below = [i["similarity"] for i in items if i["key_id"] and i["similarity"] < match]
    maybe = min([match] + [int(round(s / 0.05, 6)) * 0.05 for s in below])
    return match, round(maybe, 2)


def tally(items: list[dict], match: float, maybe: float) -> dict:
    """Return {outcome: count} over the items."""
    out = dict.fromkeys(["correct", "false_match", "not_sure", "missed"], 0)
    for i in items:
        out[match_outcome(i, match, maybe)] += 1
    return out


def pct(x) -> str:
    return "-" if x is None else f"{x * 100:.0f}%"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("tuning", nargs="+", help="saved tuning result files")
    parser.add_argument("--target", type=float, default=0.95)
    parser.add_argument("--apply", nargs="*", help="saved held-out result files")
    args = parser.parse_args()
    tuning = load_runs(args.tuning)
    held = load_runs(args.apply) if args.apply else None
    chosen = {}
    for d in DECISIONS:
        picks = picks_of(tuning, d)
        chosen[d] = lowest_cutoff(picks, args.target)
        print(f"\n{d} ({len(picks)} graded picks)\n  cutoff  kept accuracy  emptied")
        for c in GRID:
            accuracy, emptied = at_cutoff(picks, c)
            print(f"  {c:>6.2f}  {pct(accuracy):>13}  {pct(emptied):>7}")
        accuracy, emptied = at_cutoff(picks, chosen[d]) if chosen[d] is not None else (None, None)
        print(
            f"  -> lowest cutoff with kept accuracy >= {args.target}: {chosen[d]}"
            f" (accuracy {pct(accuracy)}, empties {pct(emptied)})"
        )
    items = match_items(tuning)
    match, maybe = choose_match(items)
    print(f"\nmatch similarity ({len(items)} items)\n  MATCH  correct false not-sure missed")
    for m in MATCH_GRID:
        t = tally(items, m, m)
        print(
            f"  {m:>5.2f}  {t['correct']:>7} {t['false_match']:>5} "
            f"{t['not_sure']:>8} {t['missed']:>6}"
        )
    print(f"  -> CLIENT_INTAKE_MATCH {match}, CLIENT_INTAKE_MATCH_MAYBE {maybe}")
    if held is None:
        return
    print("\nHeld-out at the chosen values:")
    for d in DECISIONS:
        if chosen[d] is None:
            print(f"  {d}: no cutoff met the target on tuning")
            continue
        picks = picks_of(held, d)
        accuracy, emptied = at_cutoff(picks, chosen[d])
        print(
            f"  {d} @ {chosen[d]}: kept accuracy {pct(accuracy)}, emptied {pct(emptied)}"
            f" of {len(picks)}"
        )
    if match is not None:
        print(f"  match @ {match}/{maybe}: {tally(match_items(held), match, maybe)}")


if __name__ == "__main__":
    main()

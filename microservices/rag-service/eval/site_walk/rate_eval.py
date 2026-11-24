"""Rating-only evaluation for CP-24: does the site walk's rating step work as well on one
observation at a time? Each golden finding's note comes from a saved site walk result (so no
model reading is paid for again), is rated alone as /observations/rate does with privacy
off, and is scored against the sample reports' category and severity.

Run by hand from microservices/rag-service. Paid (one Jev call per finding), needs
TYPESAFE_API_KEY in the root .env, so it is not in CI.
    uv run python -m eval.site_walk.rate_eval --split held-out
    uv run python -m eval.site_walk.rate_eval --split tuning --sweep
Calls app/site_walk/observation_rate.py; matching is scoring.match_observations.
Results are saved to eval/results/<date>-observation-rate[-split].json.
"""

import argparse
import json
from datetime import date

from app import config
from app.site_walk.observation_rate import rate_observation
from eval.site_walk import scoring
from eval.site_walk.run_eval import HERE, RESULTS, pct

# Saved site walk runs whose notes are rated: the latest tuned run of each split.
SAVED = {
    "held-out": "2026-10-31-site-walk-held-out-sonnet-tuned.json",
    "tuning": "2026-10-31-site-walk-tuning-climb-3.json",
}
CUTOFFS = [0.50 + 0.05 * i for i in range(10)]  # 0.50 to 0.95


def findings(cases: list[dict], saved_runs: list[dict]) -> tuple[list[tuple], int]:
    """Return ([(case id, expected observation, saved note)], skipped count).

    A finding with no saved note (its case was not in the saved run, or no note held its
    keywords) is skipped and counted.
    """
    proposals = {r["case"]: r["proposal"]["observations"] for r in saved_runs}
    found, skipped = [], 0
    for case in cases:
        expected = case["expected"]["observations"]
        pairs = scoring.match_observations(expected, proposals.get(case["id"], []))
        found += [(case["id"], e, o["note"]) for e, o in pairs]
        skipped += len(expected) - len(pairs)
    return found, skipped


def score(rows: list[dict], cutoff: float) -> dict:
    """Return agreement, share marked not sure and accuracy when not marked, per field.

    A value is marked when its probability is under `cutoff`, as the route does.
    """
    out = {"n": len(rows)}
    for field in ("category", "severity"):
        right = [r[f"{field}_right"] for r in rows]
        unmarked = [r[f"{field}_right"] for r in rows if r["probabilities"][field] >= cutoff]
        out[field] = {
            "agreement": sum(right) / len(rows) if rows else None,
            "marked": 1 - len(unmarked) / len(rows) if rows else None,
            "right_when_not_marked": sum(unmarked) / len(unmarked) if unmarked else None,
        }
    return out


def sweep(rows: list[dict]) -> list[dict]:
    """Return {cutoff, category, severity} for each cutoff in CUTOFFS."""
    return [{"cutoff": round(c, 2), **score(rows, c)} for c in CUTOFFS]


def rate_all(found: list[tuple]) -> tuple[list[dict], list[dict]]:
    """Rate each finding on its own; return (rows, the calls' usage)."""
    rows, usage = [], []
    for case_id, expected, note in found:
        rated = rate_observation(note, None)
        usage += rated["usage"]
        rows.append(
            {
                "case": case_id,
                "keywords": expected["keywords"],
                "note": note,
                "expected": {"category": expected["category"], "severity": expected["severity"]},
                "got": {"category": rated["category"], "severity": rated["severity"]},
                "probabilities": rated["probabilities"],
                "category_right": expected["category"] == rated["category"],
                "severity_right": expected["severity"] == rated["severity"],
            }
        )
    return rows, usage


def show(summary: dict) -> str:
    """Return the run's summary as readable lines."""
    lines = [f"Rated: {summary['n']}"]
    for field in ("category", "severity"):
        s = summary[field]
        lines.append(
            f"{field.capitalize():9} agreement {pct(s['agreement'])}, marked not sure "
            f"{pct(s['marked'])}, right when not marked {pct(s['right_when_not_marked'])}"
        )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", help="tuning or held-out (default: every golden case)")
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--results", help="saved site walk result file name in eval/results")
    parser.add_argument("--sweep", action="store_true", help="also try cutoffs 0.50 to 0.95")
    args = parser.parse_args()
    cases = json.loads((HERE / "golden.json").read_text())["cases"]
    if args.split:
        cases = [c for c in cases if c.get("split") == args.split]
    if args.only:
        cases = [c for c in cases if c["id"] in args.only.split(",")]
    saved_name = args.results or SAVED[args.split]
    saved = json.loads((RESULTS / saved_name).read_text())["runs"]
    found, skipped = findings(cases, saved)
    rows, usage = rate_all(found)
    summary = score(rows, config.SITE_WALK_CHECK_BELOW) | {"skipped": skipped}
    cost = sum(u.get("cost_usd") or 0 for u in usage)
    print(show(summary))
    print(f"Skipped (no saved note): {skipped}\nCost: ${cost:.4f} over {len(usage)} calls")
    result = {
        "summary": summary,
        "cutoff": config.SITE_WALK_CHECK_BELOW,
        "saved_results": saved_name,
        "cost": {"jev_usd": cost, "calls": len(usage)},
        "rows": rows,
    }
    if args.sweep:
        result["sweep"] = sweep(rows)
        for s in result["sweep"]:
            print(
                f"cutoff {s['cutoff']:.2f}: category marked {pct(s['category']['marked'])}"
                f" right-when-not-marked {pct(s['category']['right_when_not_marked'])};"
                f" severity marked {pct(s['severity']['marked'])}"
                f" right-when-not-marked {pct(s['severity']['right_when_not_marked'])}"
            )
    RESULTS.mkdir(exist_ok=True)
    name = "-".join(x for x in [str(date.today()), "observation-rate", args.split] if x)
    out = RESULTS / f"{name}.json"
    out.write_text(json.dumps(result, indent=2))
    print(f"Saved {out}")


if __name__ == "__main__":
    main()

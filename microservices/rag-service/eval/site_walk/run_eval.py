"""Site walk evaluation (CP-22): runs the proposal step on golden.json's scripted walks.

Run by hand from microservices/rag-service. It is paid (one LLM call plus a few Jev calls
per walk) and needs ANTHROPIC_API_KEY and TYPESAFE_API_KEY in the root .env, so it is not
in CI. Tell Jesper the cost it prints.
    uv run python -m eval.site_walk.run_eval [--split held-out] [--only case-id,case-id]
        [--provider openai --model gpt-6.1-sol] [--tag sol]
Splits are in LABELS.md: judge prompt changes on held-out only, never on tuning.
Calls app/site_walk/propose.py directly, privacy off (the walks hold no client details).
Scoring lives in scoring.py. Results are saved to eval/results/<date>-site-walk.json.
"""

import argparse
import json
from datetime import date
from pathlib import Path

from app import config
from app.api.routes import ProposeSiteWalkRequest
from app.site_walk.propose import propose_site_walk
from eval.site_walk import scoring

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "results"
# USD per 1M tokens (in, out); must match server/src/services/ai-pricing.service.ts.
PRICES = {
    "claude-opus-5-5": (4, 20),
    "claude-sonnet-5-5": (2, 10),
    "gpt-6.1-sol": (2, 10),
}


def pct(x) -> str:
    return "-" if x is None else f"{x * 100:.0f}%"


def run_case(case: dict) -> dict:
    """Return the step's proposal for one golden walk, validated as the route would."""
    request = ProposeSiteWalkRequest(
        report_id=f"EVAL-{case['id']}",
        transcript=case["transcript"],
        existing_locations=case["existing_locations"],
        photos=case.get("photos", []),
        site_name=case.get("site_name"),
    )
    return propose_site_walk(
        request.transcript,
        request.existing_locations,
        request.photos,
        privacy=None,
        site_name=request.site_name,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="comma-separated case ids")
    parser.add_argument("--split", help="tuning, held-out, long or mixed (see LABELS.md)")
    parser.add_argument("--provider", help="LLM_PROVIDER for this run")
    parser.add_argument("--model", help="SITE_WALK_MODEL for this run")
    parser.add_argument("--tag", default="", help="added to the results file name")
    args = parser.parse_args()
    config.LLM_PROVIDER = args.provider or config.LLM_PROVIDER
    config.SITE_WALK_MODEL = args.model or config.SITE_WALK_MODEL
    cases = json.loads((HERE / "golden.json").read_text())["cases"]
    if args.split:
        cases = [c for c in cases if c.get("split") == args.split]
    if args.only:
        cases = [c for c in cases if c["id"] in args.only.split(",")]
    rows, runs = [], []
    for case in cases:
        proposal = run_case(case)
        rows.append(scoring.score_case(case, proposal))
        runs.append({"case": case["id"], "proposal": proposal, "score": rows[-1]})
        print(json.dumps(rows[-1]))
    summary = scoring.summarise(rows)
    usage = [u for r in runs for u in r["proposal"]["usage"]]
    jev_cost = sum(u.get("cost_usd") or 0 for u in usage)
    tokens = [
        (u["model"], u["input_tokens"], u["output_tokens"])
        for u in usage
        if u["billed_service"] != "typesafe-jev"
    ]
    # An unpriced model counts as 0 here; the token list below still shows its use.
    llm_cost = sum(
        (i * PRICES.get(m, (0, 0))[0] + o * PRICES.get(m, (0, 0))[1]) / 1e6 for m, i, o in tokens
    )
    print(
        "\n".join(
            [
                f"Location matching:   {pct(summary['location_matching'])}"
                f" ({summary['locations_extra']} extra)",
                f"Observation recall:  {pct(summary['observation_recall'])}",
                f"Location agreement:  {pct(summary['location_agreement'])}",
                f"Category agreement:  {pct(summary['category_agreement'])}",
                f"Severity agreement:  {pct(summary['severity_agreement'])}",
                f"Jev cost: ${jev_cost:.4f} over {len(usage) - len(tokens)} calls",
                f"LLM cost: ${llm_cost:.4f} over {len(tokens)} calls ({config.SITE_WALK_MODEL})",
                f"Run cost: ${jev_cost + llm_cost:.4f}",
            ]
        )
    )
    RESULTS.mkdir(exist_ok=True)
    name = "-".join(x for x in [str(date.today()), "site-walk", args.split, args.tag] if x)
    out = RESULTS / f"{name}.json"
    cost = {"jev_usd": jev_cost, "llm_usd": llm_cost, "model": config.SITE_WALK_MODEL}
    out.write_text(json.dumps({"summary": summary, "cost": cost, "runs": runs}, indent=2))
    print(f"Saved {out}")


if __name__ == "__main__":
    main()

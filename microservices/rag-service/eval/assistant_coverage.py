"""AS-06 coverage eval: does MarshBot's coverage check find what the checklist is missing?

Runs eval/coverage_cases/*.json through app.assistant.coverage.check_coverage (the real
route function, so LLM_PROVIDER and ASSISTANT_COVERAGE_MODEL apply) and scores the answer
in code. No AI judge. Not run in CI: every real run is paid. Ask before running.

Cases (60 files; built by eval/assistant_coverage_build.py, which has the details)
- 45 "coverage" cases. The checklist is the real one the app writes (template items plus
  the facility type's hazard items). The notes are real field notes from five Marsh sample
  reports (Office Sample 5, Shopping Mall Sample 2, Mixed Use Development Sample 1, and
  two Section 6 note sets). Which items each note covers is hand-labelled ("links"). A case
  REMOVES the notes that cover some items; the items left with no note are the gold
  "uncovered" set. 5 cases remove nothing (gold empty): they only test for false flags.
  The links come from the existing eval cases, not from the live database, which holds no
  checklist-linked notes yet. The notes are real; the links, the removal and the case mix
  are generated in code, deterministically. Links are a first pass: read the per-case
  misses before blaming the model.
- 15 "thin" cases. 5 real specific notes each, plus 1-2 hand-written thin notes ("pump ok",
  "some issues near the stairs": 20 in all) and, in 8 cases, one short but specific note
  that must NOT be flagged. These notes are hand-written, not from a report.
- Splits are by source report so no note is shared across splits (claude-api hill-climb):
  tune = Office 5 (14 coverage) + 5 thin; check = Mall 2 (14) + 5 thin; test = Mixed Use 1 (9),
  the mixed-use Section 6 notes (2) and the office Section 6 notes (6), 17 in all, + 5 thin.
  Tune while climbing, look at check each round, and run test once at the end.

Scores (from the route's answer and the links)
- recall: gold uncovered items that were flagged / all gold items. Target 90%, floor 80%.
- false-flag rate: flagged items that are actually covered / all flagged items. Target at
  most 10%.
- thin precision and recall: flagged notes that are thin / all flagged; thin notes found /
  all thin notes. Counted on the thin cases only. (Thin flags on the coverage cases are
  counted but not scored: their notes are real and specific.)
- median and p90 latency of one check, and cost from the usage records.
- Cost uses a local copy of the gateway's list prices (server/src/services/
  ai-pricing.service.ts). gpt-6.1-terra is not in that file; it is priced like gpt-6.1-sol
  here, an assumption, so fix PRICES when the real price is known.

Run from microservices/rag-service (a real run needs the provider's key in the environment):
    uv run --extra dev python -m eval.assistant_coverage --selfcheck      # free, no network
    uv run --extra dev python -m eval.assistant_coverage --estimate       # free cost estimate
    uv run --extra dev python -m eval.assistant_coverage --model claude-sonnet-5-5 --split tune
    uv run --extra dev python -m eval.assistant_coverage --provider openai --model gpt-6.1-sol
Options: --split tune|check|test|all  --cases name,name  --privacy (masks through
privacy-service, which must be running)  --effort low|medium|high  --workers N (default 1,
so latency is honest). Results go to eval/results/assistant_coverage-<model>-<date>.json.
"""

import argparse
import json
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from unittest import mock

from app import config, usage
from app.api.routes import AssistantCoverageRequest
from app.assistant import coverage
from app.assistant.coverage import CoverageResult, ThinFlag
from app.assistant.prompts import COVERAGE_SYSTEM

HERE = Path(__file__).parent
CASES = HERE / "coverage_cases"
TARGET_RECALL, FLOOR_RECALL, MAX_FALSE_FLAGS = 0.90, 0.80, 0.10

# USD per 1M tokens (in, out, cache read), copied from the gateway's ai-pricing.service.ts.
# gpt-6.1-terra is not there: priced like sol until its price is known (assumption).
PRICES = {
    "claude-opus-5-5": (4.0, 20.0, 0.2),
    "claude-sonnet-5-5": (2.0, 10.0, 0.1),
    "gpt-6.1-sol": (2.0, 10.0, 2.0),
    "gpt-6.1-terra": (2.0, 10.0, 2.0),
}


def load_cases(split: str, names: list[str]) -> list[dict]:
    """Return the case files for a split (or the named ones), in file order."""
    cases = [json.loads(p.read_text()) for p in sorted(CASES.glob("*.json"))]
    if names:
        return [c for c in cases if c["id"] in names]
    return [c for c in cases if split == "all" or c["split"] == split]


def build_request(case: dict, privacy: bool) -> AssistantCoverageRequest:
    """The request the gateway would send for this case."""
    return AssistantCoverageRequest(
        assessment=case["assessment"],
        checklist=[{k: i[k] for k in ("id", "area", "text")} for i in case["checklist"]],
        observations=case["observations"],
        sections=case["sections"],
        # The same shape judge_sections.case_privacy sends.
        privacy={"enabled": True, "known_entities": case.get("known_entities", [])}
        if privacy
        else None,
    )


def cost_of(items: list[dict]) -> float | None:
    """Dollars for a call's usage records, or None when the model has no price here."""
    total = 0.0
    for item in items:
        model = item["model"]
        key = max((k for k in PRICES if model.startswith(k)), key=len, default=None)
        if key is None:
            return None
        rate_in, rate_out, rate_cache = PRICES[key]
        cached = item.get("cache_read_tokens") or 0
        fresh = item.get("input_tokens") or 0
        # OpenAI counts cached tokens inside input_tokens; Anthropic counts them apart.
        if item["billed_service"] == "openai":
            fresh -= cached
        total += (fresh * rate_in + (item.get("output_tokens") or 0) * rate_out) / 1e6
        total += cached * rate_cache / 1e6
    return total


def run_case(case: dict, privacy: bool) -> dict:
    """Run one case through the route function; return its answer, time and cost (or error)."""
    request = build_request(case, privacy)
    row = {"id": case["id"], "split": case["split"], "kind": case["kind"], "error": None}
    started = time.perf_counter()
    try:
        privacy_field = request.privacy.model_dump() if request.privacy else None
        answer = coverage.check_coverage(request, privacy=privacy_field)
    except Exception as error:  # a failed call is a result, not a crash
        row.update(error=f"{type(error).__name__}: {error}", seconds=time.perf_counter() - started)
        return {**row, "uncovered": [], "thin": [], "cost": None, "model": None}
    row.update(
        seconds=time.perf_counter() - started,
        uncovered=answer["uncovered"],
        thin=answer["thin"],
        cost=cost_of(answer["usage"]),
        model=answer["provenance"]["model"],
        tokens=[
            (u.get("input_tokens"), u.get("output_tokens"), u.get("cache_read_tokens"))
            for u in answer["usage"]
        ],
    )
    return row


def score_row(case: dict, row: dict) -> dict:
    """Add true/false positives and misses for one case, from the gold sets."""
    gold, flagged = set(case["gold"]["uncovered"]), set(row["uncovered"])
    thin_gold, thin_flagged = set(case["gold"]["thin"]), {t["observation_id"] for t in row["thin"]}
    # A case that errored found nothing: its gold counts as missed.
    return {
        **row,
        "gold_uncovered": sorted(gold),
        "missed": sorted(gold - flagged),
        "false_flags": sorted(flagged - gold),
        "thin_gold": sorted(thin_gold),
        "thin_missed": sorted(thin_gold - thin_flagged),
        "thin_false": sorted(thin_flagged - thin_gold),
    }


def _ratio(num: int, den: int) -> float | None:
    return num / den if den else None


def summarise(rows: list[dict]) -> dict:
    """Recall, false-flag rate, thin precision/recall, latency and cost over scored rows."""
    cov = [r for r in rows if r["kind"] == "coverage"]
    thin = [r for r in rows if r["kind"] == "thin"]
    tp = sum(len(r["gold_uncovered"]) - len(r["missed"]) for r in cov)
    fn = sum(len(r["missed"]) for r in cov)
    fp = sum(len(r["false_flags"]) for r in cov)
    ttp = sum(len(r["thin_gold"]) - len(r["thin_missed"]) for r in thin)
    tfp = sum(len(r["thin_false"]) for r in thin)
    tfn = sum(len(r["thin_missed"]) for r in thin)
    seconds = [r["seconds"] for r in rows if not r["error"]]
    costs = [r["cost"] for r in rows if r["cost"] is not None]
    return {
        "cases": len(rows),
        "errors": sum(1 for r in rows if r["error"]),
        "recall": _ratio(tp, tp + fn),
        "false_flag_rate": _ratio(fp, tp + fp),
        "uncovered_gold": tp + fn,
        "uncovered_flagged": tp + fp,
        "false_flags_on_clean_cases": sum(
            len(r["false_flags"]) for r in cov if not r["gold_uncovered"]
        ),
        "thin_precision": _ratio(ttp, ttp + tfp),
        "thin_recall": _ratio(ttp, ttp + tfn),
        "thin_flags_on_coverage_cases": sum(len(r["thin"]) for r in cov),
        "median_seconds": statistics.median(seconds) if seconds else None,
        "p90_seconds": sorted(seconds)[int(0.9 * (len(seconds) - 1))] if seconds else None,
        "cost_usd": sum(costs) if costs else None,
    }


def _pct(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1%}"


def verdict(s: dict) -> str:
    """Say whether recall and false flags meet the AS-06 targets."""
    if s["recall"] is None:
        return "no gold items scored"
    recall = (
        "target met"
        if s["recall"] >= TARGET_RECALL
        else ("above floor" if s["recall"] >= FLOOR_RECALL else "BELOW FLOOR")
    )
    flags = "ok" if (s["false_flag_rate"] or 0) <= MAX_FALSE_FLAGS else "TOO MANY FALSE FLAGS"
    return f"recall {recall}; false flags {flags}"


def print_summary(label: str, s: dict) -> None:
    cost = "n/a" if s["cost_usd"] is None else f"${s['cost_usd']:.3f}"
    print(
        f"{label:6} cases={s['cases']:3} errors={s['errors']} recall={_pct(s['recall'])} "
        f"false_flags={_pct(s['false_flag_rate'])} thin_P={_pct(s['thin_precision'])} "
        f"thin_R={_pct(s['thin_recall'])} median={s['median_seconds'] or 0:.1f}s cost={cost}"
    )


def evaluate(cases: list[dict], privacy: bool, workers: int) -> list[dict]:
    """Run and score every case; `workers` > 1 runs them side by side (latency then reads high)."""
    with ThreadPoolExecutor(workers) as pool:
        rows = list(pool.map(lambda c: run_case(c, privacy), cases))
    return [score_row(c, r) for c, r in zip(cases, rows, strict=True)]


# ---- Self-check: a perfect, an empty and a flag-everything answerer, no network -------------


def _fake_complete(answerer):
    """A stand-in for llm.complete that answers from the case's gold, like `answerer` says."""

    def complete(system, user, schema, effort, feature="", model=None):
        usage.record(feature, "selfcheck", "selfcheck-model", time.perf_counter(), input_tokens=1)
        return answerer(_current["case"], _current["request"]), "selfcheck-model"

    return complete


_current: dict = {}


def _oracle(case, request) -> CoverageResult:
    filed = {o.id: coverage._sections_of(o, request.sections) for o in request.observations}
    return CoverageResult(
        uncovered=case["gold"]["uncovered"],
        thin=[
            ThinFlag(observation_id=i, section_id=filed[i][0].section_id, reason="Too vague.")
            for i in case["gold"]["thin"]
        ],
    )


def _null(case, request) -> CoverageResult:
    return CoverageResult(uncovered=[], thin=[])


def _flag_all(case, request) -> CoverageResult:
    # Every item flagged, plus an id the model made up (code must drop it).
    return CoverageResult(uncovered=[i["id"] for i in case["checklist"]] + ["made-up"], thin=[])


def selfcheck() -> bool:
    """Prove the scorer can tell right from wrong; return True when every check holds."""
    cases = load_cases("all", [])
    results, flag_all_rows = {}, []
    for name, answerer in (("oracle", _oracle), ("null", _null), ("flag-all", _flag_all)):
        rows = []
        for case in cases:
            _current.update(case=case, request=build_request(case, False))
            with mock.patch.object(coverage, "complete", _fake_complete(answerer)):
                rows.append(run_case(case, False))
        scored = [score_row(c, r) for c, r in zip(cases, rows, strict=True)]
        results[name] = summarise(scored)
        if name == "flag-all":
            flag_all_rows = scored
        print_summary(name, results[name])
    o, n, f = results["oracle"], results["null"], results["flag-all"]
    checks = {
        "oracle recall 100%": o["recall"] == 1.0,
        "oracle false flags 0%": o["false_flag_rate"] == 0.0,
        "oracle thin precision and recall 100%": o["thin_precision"] == o["thin_recall"] == 1.0,
        "oracle ran every case": o["errors"] == 0 and o["cases"] == len(cases),
        "null recall 0%": n["recall"] == 0.0,
        "null thin recall 0%": n["thin_recall"] == 0.0,
        "flag-all recall 100%": f["recall"] == 1.0,
        "flag-all is caught by false-flag rate (> 10%)": f["false_flag_rate"] > MAX_FALSE_FLAGS,
        "made-up id dropped by the route": all(
            "made-up" not in r["uncovered"] for r in flag_all_rows
        ),
    }
    for label, ok in checks.items():
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
    return all(checks.values())


# ---- Cost estimate: from the prompts' sizes, no calls ----------------------------------------


def estimate() -> None:
    """Print the cost of one full run per model, from prompt size and assumed output."""
    cases = load_cases("all", [])
    chars = 0
    for case in cases:
        request = build_request(case, False)
        chars += len(COVERAGE_SYSTEM) + len(
            coverage._user_prompt(request.checklist, request.observations, request.sections)
        )
    # About 3.5 characters a token on this English-and-numbers text (a bit high on purpose).
    tokens_in = chars / 3.5
    print(
        f"{len(cases)} cases, {tokens_in / len(cases):.0f} input tokens a call, "
        f"{tokens_in:,.0f} in total (estimate)"
    )
    # Output = the answer (~150 tokens) + reasoning at the chosen effort (a guess, not measured).
    for label, reasoning in (("light", 1000), ("typical", 3000), ("heavy", 6000)):
        out = len(cases) * (150 + reasoning)
        row = ", ".join(
            f"{m} ${(tokens_in * p[0] + out * p[1]) / 1e6:.2f}" for m, p in PRICES.items()
        )
        print(f"reasoning {label:7} ({reasoning} tokens a call): {row}")
    cap = ", ".join(
        f"{m} ${(tokens_in * p[0] + len(cases) * 16000 * p[1]) / 1e6:.2f}"
        for m, p in PRICES.items()
    )
    print(f"worst case (every call hits the 16000-token output cap): {cap}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--model")
    parser.add_argument("--provider")
    parser.add_argument("--effort")
    parser.add_argument("--split", default="all", choices=["tune", "check", "test", "all"])
    parser.add_argument("--cases", default="")
    parser.add_argument("--privacy", action="store_true")
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--selfcheck", action="store_true")
    parser.add_argument("--estimate", action="store_true")
    args = parser.parse_args()

    if args.selfcheck:
        sys.exit(0 if selfcheck() else 1)
    if args.estimate:
        return estimate()

    # The route reads these when it runs, so setting them here is what the env vars do.
    if args.provider:
        config.LLM_PROVIDER = args.provider
    if args.model:
        config.ASSISTANT_COVERAGE_MODEL = args.model
    if args.effort:
        config.ASSISTANT_COVERAGE_EFFORT = args.effort
    names = [n for n in args.cases.split(",") if n]
    cases = load_cases(args.split, names)
    if not cases:
        sys.exit("No cases match.")

    rows = evaluate(cases, args.privacy, args.workers)
    summary = {"all": summarise(rows)}
    for split in ("tune", "check", "test"):
        part = [r for r in rows if r["split"] == split]
        if part:
            summary[split] = summarise(part)
    for label, s in summary.items():
        print_summary(label, s)
    print(verdict(summary["all"]))

    model = args.model or config.ASSISTANT_COVERAGE_MODEL
    base = f"assistant_coverage-{model}-{datetime.now(UTC):%Y-%m-%d}"
    out = HERE / "results" / f"{base}.json"
    out.parent.mkdir(exist_ok=True)
    n = 1
    while out.exists():  # never overwrite an earlier run of the same day
        n += 1
        out = out.with_name(f"{base}-{n}.json")
    out.write_text(
        json.dumps(
            {
                "model": model,
                "provider": config.LLM_PROVIDER,
                "effort": config.ASSISTANT_COVERAGE_EFFORT,
                "split": args.split,
                "privacy": args.privacy,
                "prompt_version": coverage.COVERAGE_PROMPT_VERSION,
                "summary": summary,
                "rows": rows,
            },
            indent=1,
        )
        + "\n"
    )
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()

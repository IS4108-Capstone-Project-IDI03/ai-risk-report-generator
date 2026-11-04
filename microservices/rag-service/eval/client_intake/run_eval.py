"""Client intake evaluation (CP-23): runs the reading step on golden.json's packs and records
every classifier pick, so sweep.py can choose the confidence cutoffs.

Run by hand from microservices/rag-service. It is PAID (one LLM call plus a few Jev calls per
pack) and needs the provider keys and TYPESAFE_API_KEY in the root .env; not in CI.
    uv run python -m eval.client_intake.run_eval --split tuning [--only p01,p02]
        [--provider openai --model gpt-6.1-sol] [--picks jev|llm] [--privacy off|on] [--tag x]
--privacy on masks through a running privacy-service (PRIVACY_SERVICE_URL in the environment).
Every cutoff is forced to 0 for the run so every pick is kept; the app's own cutoffs are then
applied to the saved response here. Results: eval/results/<date>-client-intake-<tag>.json.
Calls app/client_intake/read.py. Scoring is scoring.py; cutoffs are chosen by sweep.py.
"""

import argparse
import copy
import json
import time
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from typing import Literal

from pydantic import ConfigDict, create_model

from app import config
from app.api.routes import ReadClientIntakeRequest
from app.client_intake import read
from app.generation.llm import complete
from app.site_walk import jev
from eval.client_intake import scoring

HERE = Path(__file__).resolve().parent
RESULTS = HERE.parent / "results"
# USD per 1M tokens (in, out); must match eval/site_walk/run_eval.py. Jev is priced by jev.py.
PRICES = {"claude-opus-5-5": (4, 20), "claude-sonnet-5-5": (2, 10), "gpt-6.1-sol": (2, 10)}
# The question-name prefix in read.py is the decision type.
DECISIONS = {
    "facility": "facility_type",
    "jurisdiction": "jurisdiction",
    "visit": "visit_type",
    "placement": "placement",
}


def pct(x) -> str:
    return "-" if x is None else f"{x * 100:.0f}%"


def make_llm_choose():
    """Return a stand-in for jev.choose where one complete() call answers a batch of questions
    as {name: choice}. Probability is always 1.0, so cutoffs do not apply to it."""

    def llm_choose(state, questions, classifier=None, feature="client-intake"):
        fields = {n: (Literal[tuple(criteria)], ...) for n, (_, criteria) in questions.items()}
        answers_model = create_model("Answers", __config__=ConfigDict(extra="forbid"), **fields)
        asked = "\n\n".join(
            f"{n}: {instructions}\n" + "\n".join(f"  - {k}: {v}" for k, v in criteria.items())
            for n, (instructions, criteria) in questions.items()
        )
        answer, _ = complete(
            "Answer each question by picking exactly one of its options, using only the text "
            "given.",
            f"{state}\n\nQuestions:\n{asked}",
            answers_model,
            config.CLIENT_INTAKE_EFFORT,
            feature=feature,
            model=config.CLIENT_INTAKE_MODEL,
        )
        return {n: (getattr(answer, n), 1.0) for n in questions}

    return llm_choose


def recording(choose_fn, calls: list):
    """Return `choose_fn` wrapped so every answer is appended to `calls` as (name, choice, p)."""

    def wrapper(state, questions, classifier=None, feature="client-intake"):
        answers = choose_fn(state, questions, classifier=classifier, feature=feature)
        calls.extend((n, c, p) for n, (c, p) in answers.items())
        return answers

    return wrapper


def privacy_for(request: dict) -> dict:
    """Return the privacy dict the gateway would send: the recorded names as known entities."""
    entities = []
    for c in request["clients"]:
        entities.append({"type": "CLIENT", "names": [c["name"]]})
        for s in c["sites"]:
            entities.append({"type": "SITE", "names": [s["name"]]})
            if s.get("address"):
                entities.append({"type": "ADDRESS", "names": [s["address"]]})
    return {"enabled": True, "known_entities": entities, "detect": ["CLIENT", "SITE"]}


def key_maps(key: dict, response: dict) -> tuple[dict, dict]:
    """Return ({response site ref: key site ref}, {response visit ref: key visit ref})."""
    site_pairs = scoring.pair_sites(key["sites"], response["sites"])
    site_map = {g["ref"]: ref for ref, g in site_pairs.items()}
    got_by_site: dict[str, list] = {}
    for a in response["assessments"]:
        got_by_site.setdefault(a["site_ref"], []).append(a)
    visit_map = {}
    for k_site in key["sites"]:
        got_site = site_pairs.get(k_site["ref"])
        if not got_site:
            continue
        key_list = [a for a in key["assessments"] if a["site_ref"] == k_site["ref"]]
        pairs = scoring.pair_assessments(key_list, got_by_site.get(got_site["ref"], []))
        visit_map |= {g["ref"]: ref for ref, g in pairs.items()}
    return site_map, visit_map


def grade_picks(calls: list, request: dict, key: dict, response: dict) -> list[dict]:
    """Return one record per classifier pick: its decision type, the field it fills, the choice,
    its probability and whether it matches the key (None when the key has no counterpart)."""
    site_map, visit_map = key_maps(key, response)
    key_sites = {s["ref"]: s for s in key["sites"]}
    key_visits = {a["ref"]: a for a in key["assessments"]}
    key_docs = {d["id"]: d for d in key["documents"]}
    picks = []
    for name, choice, probability in calls:
        prefix, _, n = name.rpartition("_")
        n = int(n)
        decision = DECISIONS[prefix]
        right, field = None, name
        if decision in ("facility_type", "jurisdiction"):
            field = f"site-{n}.{decision}"
            ks = key_sites.get(site_map.get(f"site-{n}"))
            got = None if choice == read.OTHER else choice
            if decision == "facility_type" and got:
                got = request["facility_types"][int(choice.removeprefix("type_")) - 1]
            right = None if ks is None else ks[decision] == got
        elif decision == "visit_type":
            field = f"a-{n}.visit_type"
            ka = key_visits.get(visit_map.get(f"a-{n}"))
            right = (
                None if ka is None else ka["visit_type"] == read.REPEAT_VISITS[choice].split(":")[0]
            )
        else:
            doc_id = request["documents"][n - 1]["id"]
            field = f"{doc_id}.placement"
            if choice.startswith("site_"):
                got = {"kind": "site", "ref": f"site-{choice.removeprefix('site_')}"}
            elif choice.startswith("visit_"):
                got = {"kind": "assessment", "ref": f"a-{choice.removeprefix('visit_')}"}
            else:
                got = {"kind": "client"}
            right = scoring.placement_ok(key_docs[doc_id]["placement"], got, site_map, visit_map)
        picks.append(
            {
                "name": name,
                "decision": decision,
                "field": field,
                "choice": choice,
                "probability": probability,
                "right": right,
            }
        )
    return picks


def apply_cutoffs(response: dict, calls: list, cutoffs: dict) -> dict:
    """Return a copy of the response with each pick below its decision's cutoff emptied, the
    way read.py does it (a placement falls back to the client and is flagged Not sure)."""
    out = copy.deepcopy(response)
    empty = {"value": None, "source": None}
    for name, _, probability in calls:
        prefix, _, n = name.rpartition("_")
        n = int(n)
        decision = DECISIONS[prefix]
        if probability >= cutoffs[decision]:
            continue
        if decision in ("facility_type", "jurisdiction"):
            out["sites"][n - 1][decision] = dict(empty)
        elif decision == "visit_type":
            out["assessments"][n - 1]["visit_type"] = dict(empty)
        else:
            out["documents"][n - 1] = {
                "id": out["documents"][n - 1]["id"],
                "placement": {"kind": "client"},
                "not_sure": True,
            }
    return out


def match_scores(request: dict, key: dict, response: dict) -> dict:
    """Return how alike each read client and site is to its closest recorded one, with the key's
    answer, so sweep.py can choose CLIENT_INTAKE_MATCH / MATCH_MAYBE. read.py does not expose
    these, so they are computed here with its own similarity functions. Sites are compared
    against the key client's recorded sites."""
    name = response["client"]["name"]["value"]
    best = max(request["clients"], key=lambda c: read._like(name, c["name"]), default=None)
    items = [
        {
            "kind": "client",
            "similarity": read._like(name, best["name"]) if best else 0.0,
            "best_id": best["id"] if best else None,
            "key_id": key["client"]["existing_id"],
        }
    ]
    recorded = next((c["sites"] for c in request["clients"] if c["id"] == items[0]["key_id"]), [])
    for k_ref, got in scoring.pair_sites(key["sites"], response["sites"]).items():
        k = next(s for s in key["sites"] if s["ref"] == k_ref)
        n, a = got["name"]["value"], got["address"]["value"]

        def score(r, n=n, a=a):
            # The step's own site score, read with a dict instead of a request model.
            return read._like_site(n, a, SimpleNamespace(name=r["name"], address=r.get("address")))

        top = max(recorded, key=score, default=None)
        items.append(
            {
                "kind": "site",
                "similarity": score(top) if top else 0.0,
                "best_id": top["id"] if top else None,
                "key_id": k["existing_site_id"],
            }
        )
    return {"items": items}


def cost_of(usage: list[dict]) -> dict:
    """Return {jev_usd, llm_usd} for a pack's usage items. An unpriced model counts as 0."""
    jev_usd = llm_usd = 0.0
    for u in usage:
        if u["billed_service"] == "typesafe-jev":
            jev_usd += u.get("cost_usd") or (u.get("input_tokens") or 0) * jev.PRICE_IN / 1e6
        else:
            pin, pout = PRICES.get(u["model"], (0, 0))
            llm_usd += (
                (u.get("input_tokens") or 0) * pin + (u.get("output_tokens") or 0) * pout
            ) / 1e6
    return {"jev_usd": jev_usd, "llm_usd": llm_usd}


def run_case(case: dict, picks_mode: str, privacy_on: bool, app_cutoffs: dict) -> dict:
    """Run the step on one pack and return its raw response, graded picks, match scores,
    seconds and cost."""
    request = ReadClientIntakeRequest(**case["request"])
    calls: list = []
    base = make_llm_choose() if picks_mode == "llm" else jev.choose
    read.choose = recording(base, calls)
    started = time.perf_counter()
    response = read.read_client_intake(
        request.documents,
        request.clients,
        request.facility_types,
        request.jurisdictions,
        privacy_for(case["request"]) if privacy_on else None,
    )
    seconds = time.perf_counter() - started
    key = case["key"]
    return {
        "case": case["id"],
        "response": response,
        "picks": grade_picks(calls, case["request"], key, response),
        "match": match_scores(case["request"], key, response),
        "seconds": seconds,
        "cost": cost_of(response["usage"]),
        "score": scoring.score_case(key, apply_cutoffs(response, calls, app_cutoffs)),
    }


def report(runs: list[dict]) -> None:
    """Print the run's rates (cutoffs applied), pick accuracy, time and cost."""
    s = scoring.summarise([r["score"] for r in runs])
    print("\nField accuracy / empty-when-absent:")
    for f, v in s["fields"].items():
        print(f"  {f:22} {pct(v['accuracy']):>5} / {pct(v['empty_when_absent']):>5}")
    print(f"Empty when absent: {pct(s['empty_when_absent'])}  Overall: {pct(s['accuracy'])}")
    print(
        f"Client match: {pct(s['client_match']['correct'])}  "
        f"Site match: {pct(s['site_match']['correct'])}  Placement: {pct(s['placement'])}"
    )
    for d in DECISIONS.values():
        rights = [
            p["right"]
            for r in runs
            for p in r["picks"]
            if p["decision"] == d and p["right"] is not None
        ]
        print(
            f"Pick accuracy {d}: "
            f"{pct(sum(rights) / len(rights) if rights else None)} of {len(rights)}"
        )
    secs = [r["seconds"] for r in runs]
    jev_usd = sum(r["cost"]["jev_usd"] for r in runs)
    llm_usd = sum(r["cost"]["llm_usd"] for r in runs)
    print(f"Seconds: mean {sum(secs) / len(secs):.1f}, max {max(secs):.1f}")
    print(f"Jev ${jev_usd:.4f} + LLM ${llm_usd:.4f} = run cost ${jev_usd + llm_usd:.4f}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--split", help="tuning or held-out (see LABELS.md)")
    parser.add_argument("--only", help="comma-separated pack ids")
    parser.add_argument("--provider", help="LLM_PROVIDER for this run")
    parser.add_argument("--model", help="CLIENT_INTAKE_MODEL for this run")
    parser.add_argument("--picks", choices=["jev", "llm"], default="jev")
    parser.add_argument("--privacy", choices=["off", "on"], default="off")
    parser.add_argument("--tag", default="", help="added to the results file name")
    args = parser.parse_args()
    config.LLM_PROVIDER = args.provider or config.LLM_PROVIDER
    config.CLIENT_INTAKE_MODEL = args.model or config.CLIENT_INTAKE_MODEL
    app_cutoffs = dict(config.CLIENT_INTAKE_CUTOFFS)
    # Forced to 0 so every pick is kept and recorded; app_cutoffs are applied afterwards.
    config.CLIENT_INTAKE_CUTOFFS = dict.fromkeys(app_cutoffs, 0)
    cases = json.loads((HERE / "golden.json").read_text())["cases"]
    if args.split:
        cases = [c for c in cases if c.get("split") == args.split]
    if args.only:
        cases = [c for c in cases if c["id"] in args.only.split(",")]
    runs = []
    for case in cases:
        runs.append(run_case(case, args.picks, args.privacy == "on", app_cutoffs))
        print(case["id"], f"{runs[-1]['seconds']:.1f}s", json.dumps(runs[-1]["cost"]))
    report(runs)
    RESULTS.mkdir(exist_ok=True)
    name = "-".join(x for x in [str(date.today()), "client-intake", args.tag] if x)
    out = RESULTS / f"{name}.json"
    meta = {
        "split": args.split,
        "provider": config.LLM_PROVIDER,
        "model": config.CLIENT_INTAKE_MODEL,
        "picks": args.picks,
        "privacy": args.privacy,
        "app_cutoffs": app_cutoffs,
        "match": [config.CLIENT_INTAKE_MATCH, config.CLIENT_INTAKE_MATCH_MAYBE],
    }
    out.write_text(json.dumps({"meta": meta, "runs": runs}, indent=2))
    print(f"Saved {out}")


if __name__ == "__main__":
    main()

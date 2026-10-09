"""Draft each OFI case and have an LLM judge score the OFIs (GN-05 AC7).

Each case in eval/ofi_cases holds site-note observations written from one Marsh sample
report's Section 3: one per OFI Marsh raised, plus a few moderate observations Marsh
did not raise an OFI for, which test restraint. The case is drafted with the live
pipeline (`orchestrator.draft_ofis_for`, its own report kept out of retrieval), then
the judge scores the OFIs and, as a reference point, Marsh's own OFIs, with the same
rubric. Same judge setup as judge_sections.py (JUDGE_MODEL, two runs each).

Run from microservices/rag-service (costs one drafting call per case, plus judge calls):
    uv run --extra dev python -m eval.judge_ofis [case ...]
Results are appended to eval/results/ofis-<date>.jsonl.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config
from app.api.routes import Assessment, Observation
from app.generation.generator import OFI_CONFIG, OFI_GUIDE, OFI_PROMPT_VERSION
from app.orchestrator import orchestrator
from eval.judge_sections import (
    DEDUCTION,
    JUDGE_MODEL,
    JUDGE_REASONING,
    JUDGE_RUNS,
    _without_own_report,
    ask_judge,
)

HERE = Path(__file__).parent
RUBRIC_VERSION = "ofi-rubric-v1"
CRITERIA = ["grounding", "technical_basis", "field_fit", "coverage", "restraint"]
# The AC7 pass mark, on the scores averaged over JUDGE_RUNS runs. Grounding matters most:
# an OFI resting on something not seen at this site misleads the client. Confirm the
# marks after the first run, as AC13's were.
PASS_FLOORS = {"grounding": 4.0} | {c: 3.5 for c in CRITERIA if c != "grounding"}
PASS_MEAN = 4.0

RUBRIC = """List every problem in the OFIs, one per issue, under one criterion:

- grounding: an OFI, or a fact in its observation, that the site observations do not
  support, including a site fact (location, quantity, name, date) carried over from a
  past report's OFI.
- technical_basis: a description that does not say what to do and why, or that names
  a standard wrongly. Not citing a standard is fine where none applies.
- field_fit: a category, type, effort, likelihood or consequence that does not fit the
  OFI (e.g. a procedure change marked Capital, a permit OFI under Physical Protection,
  a minor housekeeping gap rated Catastrophic).
- coverage: an observation that clearly calls for an OFI but has none. Quote it.
- restraint: an OFI for something the observations show is adequate, or two OFIs for
  one issue.

Rate each issue major (changes what the client or an insurer would do) or minor. Quote
the exact words. Read every OFI. If you find nothing for a criterion, list nothing."""


class Issue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    criterion: Literal["grounding", "technical_basis", "field_fit", "coverage", "restraint"]
    severity: Literal["minor", "major"]
    quote: str
    problem: str


class Findings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issues: list[Issue]


def scores_from(issues: list[Issue]) -> dict[str, float]:
    """Each criterion starts at 5 and loses 0.5 per minor issue, 1 per major, to 1."""
    return {
        c: max(1.0, 5 - sum(DEDUCTION[i.severity] for i in issues if i.criterion == c))
        for c in CRITERIA
    }


def passes(scores: dict[str, float]) -> bool:
    """Whether a case's averaged scores meet the AC7 pass mark."""
    floors = all(scores[c] >= floor for c, floor in PASS_FLOORS.items())
    return floors and sum(scores.values()) / len(scores) >= PASS_MEAN


def priority_agreement(ofis: list[dict], marsh: dict[str, str]) -> dict[str, int]:
    """How many drafted priorities match the priority Marsh gave the OFI behind the same
    observation (`marsh` maps observation id to it): exactly, or within one step. Reported
    alongside the scores, not part of the AC7 pass mark."""
    level = {f"Priority {n}": n for n in range(1, 5)}
    pairs = [
        (level[o["priority"]], level[marsh[o["observations"][0]]])
        for o in ofis
        if o["observations"] and o["observations"][0] in marsh
    ]
    return {
        "compared": len(pairs),
        "exact": sum(a == b for a, b in pairs),
        "within_one": sum(abs(a - b) <= 1 for a, b in pairs),
    }


def ofis_text(ofis: list[dict]) -> str:
    """The drafted OFIs as the judge reads them: every field, observations by id."""
    if not ofis:
        return "(no OFIs were drafted)"
    return "\n\n".join(
        f"{o['title']}. {o['category']}. Type: {o['type']}. {o['priority']} "
        f"({o['likelihood']} x {o['consequence']}). Effort: {o['effort']}.\n"
        f"Description: {o['description']}\nObservation: {o['observation']}\n"
        f"Rests on observations: {', '.join(o['observations'])}"
        for o in ofis
    )


def judge(case: dict, text: str, finished: bool) -> list[Issue]:
    """List the problems in a set of OFIs. `finished` marks Marsh's published OFIs."""
    evidence = "\n".join(
        f"- {o['id']} ({o['severity']}, {o['location']}): {o['note']}" for o in case["observations"]
    )
    user = "\n\n".join(
        [
            f"Site: {case['assessment']['facility_type']} in {case['assessment']['jurisdiction']}.",
            "The drafting guide the writer was given:\n" + OFI_GUIDE,
            "Value lists: " + json.dumps({k: OFI_CONFIG[k] for k in ("categories", "effort")}),
            "Site observations the writer was given:\n" + evidence,
            ("Marsh's published OFIs" if finished else "Drafted OFIs") + " to assess:\n" + text,
        ]
    )
    system = (
        "You assess Opportunities for Improvement (OFIs) for Section 3 of a Marsh Property "
        "Risk Evaluation report, for a risk engineering team.\n\n" + RUBRIC
    )
    return ask_judge(system, user, Findings).issues


def run_case(path: Path) -> list[dict]:
    case = json.loads(path.read_text())
    search = orchestrator.search
    orchestrator.search = _without_own_report(search, case.get("exclude_doc_id"))
    try:
        draft = orchestrator.draft_ofis_for(
            Assessment(**case["assessment"]),
            [Observation(**o) for o in case["observations"]],
            [],
        )
    finally:
        orchestrator.search = search

    rows = []
    for subject, text in (("draft", ofis_text(draft["ofis"])), ("marsh", case["reference"])):
        runs = [judge(case, text, finished=subject == "marsh") for _ in range(JUDGE_RUNS)]
        per_run = [scores_from(issues) for issues in runs]
        scores = {c: round(sum(r[c] for r in per_run) / len(per_run), 2) for c in CRITERIA}
        rows.append(
            {
                "case": path.stem,
                "subject": subject,
                "scores": scores,
                "mean": round(sum(scores.values()) / len(scores), 2),
                "passed": passes(scores),
                "priorities": priority_agreement(draft["ofis"], case.get("marsh_priorities", {}))
                if subject == "draft"
                else None,
                "issues": [[i.model_dump() for i in issues] for issues in runs],
                "draft_model": draft["provenance"]["model"],
                "draft_effort": draft["provenance"]["effort"],
                "prompt_version": OFI_PROMPT_VERSION,
                "config_version": OFI_CONFIG["version"],
                "judge_model": JUDGE_MODEL,
                "judge_reasoning": JUDGE_REASONING,
                "rubric_version": RUBRIC_VERSION,
                "text": text,
                "draft": draft if subject == "draft" else None,
                "at": datetime.now(UTC).isoformat(),
            }
        )
    return rows


def main(names: list[str]) -> None:
    paths = sorted((HERE / "ofi_cases").glob("*.json"))
    if names:
        paths = [p for p in paths if p.stem in names]
    rows = [row for path in paths for row in run_case(path)]

    out = HERE / "results" / f"ofis-{datetime.now(UTC):%Y-%m-%d}.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("a") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)

    print(
        f"drafter {config.LLM_MODEL} ({config.LLM_EFFORT}), prompt {OFI_PROMPT_VERSION}; "
        f"judge {JUDGE_MODEL} ({JUDGE_REASONING}), {RUBRIC_VERSION}\n"
    )
    print(f"{'case':16} {'text':6} " + " ".join(f"{c[:12]:>12}" for c in CRITERIA) + "  mean pass")
    for r in rows:
        print(
            f"{r['case']:16} {r['subject']:6} "
            + " ".join(f"{r['scores'][c]:>12}" for c in CRITERIA)
            + f" {r['mean']:>5} {'yes' if r['passed'] else 'no'}"
        )
    for r in rows:
        if r["priorities"]:
            p = r["priorities"]
            print(
                f"{r['case']}: priority matches Marsh {p['exact']}/{p['compared']}, "
                f"within one step {p['within_one']}/{p['compared']}"
            )
    print(f"\nSaved to {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main(sys.argv[1:])

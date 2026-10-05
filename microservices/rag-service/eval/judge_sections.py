"""Draft each reference case and have an LLM judge score it (GN-01 AC11).

Each case in eval/cases holds the observations an engineer would have captured,
taken from a real Marsh report section, and that section's actual text. The
case is drafted with the live pipeline (retrieval and LLM as configured), then a
GPT model scores the draft against RUBRIC: OpenAI's open-weight gpt-oss, hosted
on Groq, so no model grades its own writing. The judge also scores Marsh's own
text with the same rubric, as a reference point: if the real report scores
badly, the rubric needs fixing, not the draft.

Run from microservices/rag-service. It reads the root .env: the drafting settings,
and OPENAI_API_KEY and OPENAI_BASE_URL, which point at Groq (the speech service
uses the same key for Whisper). JUDGE_MODEL picks another model on that endpoint:
    uv run --extra dev python -m eval.judge_sections [case ...]

Each run drafts every case once (one LLM call each) and judges twice per case.
--rejudge judges the newest saved drafts again, without drafting (no Claude calls).
Results are appended to eval/results/<date>.jsonl.
"""

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel, ConfigDict

from app import config
from app.api.routes import Assessment, Observation
from app.generation.generator import DRAFTING_GUIDE, PROMPT_VERSION, TEMPLATE
from app.orchestrator import orchestrator

HERE = Path(__file__).parent
# v2.1: conventions are checked against the drafting guide, not sections.json's list.
# v2.2: the AC13 pass mark (PASS_FLOORS, PASS_MEAN), averaged over two judge runs.
# v2.3: backup observations are optional for coverage; clear expansions of short dates
# and abbreviations are not invention; empty subsections are marked as such.
RUBRIC_VERSION = "rubric-v2.3"
JUDGE_MODEL = os.getenv("JUDGE_MODEL", "openai/gpt-oss-120b")
# gpt-oss on Groq reads more carefully at high reasoning effort, at little extra cost.
JUDGE_REASONING = os.getenv("JUDGE_REASONING", "high")
# The AC13 pass mark, per draft, on the scores averaged over JUDGE_RUNS runs.
# Groundedness and no invention matter most to an insurer, so they have the
# highest floors; conventions is the noisiest criterion and costs least to fix.
PASS_FLOORS = {
    "groundedness": 4.0,
    "no_invention": 4.0,
    "structure": 3.5,
    "coverage": 3.5,
    "conventions": 3.0,
}
PASS_MEAN = 4.0
# The same draft varies by about +/-0.5 between judge runs, so each is judged twice.
JUDGE_RUNS = 2


def passes(scores: dict[str, float]) -> bool:
    """Whether a draft's averaged scores meet the AC13 pass mark."""
    floors = all(scores[c] >= floor for c, floor in PASS_FLOORS.items())
    return floors and sum(scores.values()) / len(scores) >= PASS_MEAN


# rubric-v2: the judge only finds problems; the scores come from them in code. Asked
# for a 1-5 score directly (rubric-v1), the judge skimmed and gave 5s to drafts that
# Claude marked down for real flaws.
RUBRIC = """List every problem in the text, one per issue, under one criterion:

- groundedness: a statement the evidence does not support, or attributes wrongly
  (e.g. presents something seen on site as "reported", or the reverse).
- coverage: a main observation the text leaves out. Quote the observation. Backup
  observations (filed under other categories) are optional: leaving one out is not
  an issue.
- structure: a point under the wrong subsection, a subsection out of order, or a
  missing subsection the evidence covers.
- conventions: wording that breaks a writing convention given (spelling, units, fire
  ratings, tense, observed-versus-reported framing, naming, recommendations).
- no_invention: a value, name, date, rating or detail not in the evidence. Spelling
  out an abbreviation ("spk" for sprinkler) is not invention, and nor is a short date:
  site notes write a month and a two-digit year, so "Apr 26" means April 2026 and
  "Mar 26" means March 2026.

Rate each issue major (changes what an insurer would understand, or invents or misstates
a fact) or minor (style or a small omission). Quote the exact words from the text.
"[this subsection has no statements]" marks an empty subsection in the draft; it is not
text the writer wrote. Read every sentence. If you find nothing for a criterion, list
nothing for it; do not invent issues."""

DEDUCTION = {"minor": 0.5, "major": 1.0}


class Issue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    criterion: Literal["groundedness", "coverage", "structure", "conventions", "no_invention"]
    severity: Literal["minor", "major"]
    quote: str
    problem: str


class Findings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    issues: list[Issue]


CRITERIA = ["groundedness", "coverage", "structure", "conventions", "no_invention"]


def scores_from(issues: list[Issue]) -> dict[str, float]:
    """Each criterion starts at 5 and loses 0.5 per minor issue, 1 per major, to 1."""
    return {
        c: max(1.0, 5 - sum(DEDUCTION[i.severity] for i in issues if i.criterion == c))
        for c in CRITERIA
    }


def _without_own_report(search, own_doc_id: str | None):
    """Wrap search so a case cannot use its own report's passages as precedent."""

    def wrapped(requests):
        return [
            [h for h in hits if (h["metadata"] or {}).get("doc_id") != own_doc_id]
            for hits in search(requests)
        ]

    return wrapped


def _labels(case: dict, sources: dict) -> dict[str, str]:
    """Full citation ID -> the short label the judge sees (O1, C1), in evidence order."""
    labels = {f"O:{o['id']}": f"O{n}" for n, o in enumerate(case["observations"], 1)}
    labels |= {cid: f"C{n}" for n, cid in enumerate(sources, 1)}
    return labels


def _evidence_text(case: dict, sources: dict) -> str:
    # Observations under other COPE categories are backup the draft may use, not
    # evidence it must cover (rubric-v2.3).
    own = TEMPLATE["sections"][case["section_id"]]["cope_dimensions"]
    lines = [
        f"- O{n} ({'main' if o['COPE_dimension'] in own else 'backup'} observation, "
        f"{o['COPE_dimension']}, {o.get('location')}): {o['note']}"
        for n, o in enumerate(case["observations"], 1)
    ]
    lines += [
        f"- C{n} (standard passage, {' > '.join((s.get('headings') or [])[-2:])}, "
        f"p. {s.get('page_start')}): {s['text'][:1500]}"
        for n, s in enumerate(sources.values(), 1)
    ]
    return "\n".join(lines)


def _draft_text(draft: dict, labels: dict[str, str]) -> str:
    """The draft as the engineer would review it: each statement with what it cites."""
    parts = []
    for sub in draft["subsections"]:
        if sub["kind"] == "table":
            continue
        cites = [", ".join(labels.get(c, c) for c in s["citations"]) for s in sub["statements"]]
        body = "\n".join(
            f"- {s['text']} [cites {c or 'nothing'}]" for s, c in zip(sub["statements"], cites)
        )
        parts.append(f"{sub['heading']}\n{body or '[this subsection has no statements]'}")
    questions = "\n".join(f"- {q}" for q in draft.get("questions", [])) or "(none)"
    return "\n\n".join(parts) + f"\n\nQuestions for the engineer:\n{questions}"


def judge(case: dict, text: str, sources: dict, finished: bool = False) -> list[Issue]:
    """List the problems in `text`. `finished` marks Marsh's published section, which
    has no citation labels or questions to check."""
    section = TEMPLATE["sections"][case["section_id"]]
    headings = [s["heading"] for s in section["subsections"] if s["kind"] != "table"]
    system = (
        "You assess drafts of one section of a Marsh Property Risk Evaluation report "
        "for a risk engineering team.\n\n" + RUBRIC
    )
    user = "\n\n".join(
        [
            f"Section {case['section_id']}: {section['title']}. Template subsections, in "
            f"order: {'; '.join(headings)}. Tables are filled separately; ignore them.",
            "The drafting guide the writer was given (its conventions are the ones to check):\n"
            + DRAFTING_GUIDE,
            "Evidence the writer was given:\n" + _evidence_text(case, sources),
            "Text to assess"
            + (
                " (a finished report section: it has no citation labels or questions "
                "for the engineer, so do not count their absence):\n"
                if finished
                else " (each statement ends with the labels it cites):\n"
            )
            + text,
        ]
    )
    # Groq's free tier limits requests a minute, so a rate limit is retried with the
    # SDK's backoff rather than failing the run.
    client = OpenAI(max_retries=8)
    response = client.chat.completions.parse(
        model=JUDGE_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format=Findings,
        reasoning_effort=JUDGE_REASONING,
        # At high effort gpt-oss can reason for over 15k tokens before writing its
        # findings; this is near its output limit and costs about 2 cents on Groq.
        max_completion_tokens=32000,
    )
    findings = response.choices[0].message.parsed
    if findings is None:
        raise RuntimeError(f"The judge gave no findings: {response.choices[0].message.refusal}")
    return findings.issues


def run_case(path: Path) -> list[dict]:
    case = json.loads(path.read_text())
    assessment = Assessment(**case["assessment"])
    observations = [Observation(**o) for o in case["observations"]]
    search = orchestrator.search
    orchestrator.search = _without_own_report(search, case.get("exclude_doc_id"))
    try:
        draft = orchestrator.draft(case["section_id"], assessment, observations)
    finally:
        orchestrator.search = search

    return judge_rows(path.stem, case, draft)


def judge_rows(name: str, case: dict, draft: dict) -> list[dict]:
    """Judge a draft and Marsh's own text, as result rows. Each draft row keeps the
    whole draft, so a run can be judged again without drafting (--rejudge)."""
    rows = []
    labels = _labels(case, draft["sources"])
    for subject, text in (("draft", _draft_text(draft, labels)), ("marsh", case["reference"])):
        runs = [
            judge(case, text, draft["sources"], finished=subject == "marsh")
            for _ in range(JUDGE_RUNS)
        ]
        per_run = [scores_from(issues) for issues in runs]
        scores = {c: round(sum(r[c] for r in per_run) / len(per_run), 2) for c in CRITERIA}
        rows.append(
            {
                "case": name,
                "subject": subject,
                "scores": scores,
                "issues": [[i.model_dump() for i in issues] for issues in runs],
                "scores_per_run": per_run,
                "mean": round(sum(scores.values()) / len(scores), 2),
                "passed": passes(scores),
                "unsupported_count": draft["guardrail"]["unsupported_count"]
                if subject == "draft"
                else None,
                "draft_model": draft["provenance"]["model"],
                "draft_effort": draft["provenance"]["effort"],
                "prompt_version": PROMPT_VERSION,
                "template_version": TEMPLATE["version"],
                "judge_model": JUDGE_MODEL,
                "judge_reasoning": JUDGE_REASONING,
                "rubric_version": RUBRIC_VERSION,
                "text": text,
                "draft": draft if subject == "draft" else None,
                "at": datetime.now(UTC).isoformat(),
            }
        )
    return rows


def rejudge(names: list[str]) -> list[dict]:
    """Judge again the newest saved draft of each case, with no drafting (no Claude)."""
    latest = {}
    for path in sorted((HERE / "results").glob("*.jsonl")):
        for line in path.read_text().splitlines():
            row = json.loads(line)
            if row.get("draft") and (not names or row["case"] in names):
                latest[row["case"]] = row
    rows = []
    for name, row in latest.items():
        case = json.loads((HERE / "cases" / f"{name}.json").read_text())
        rows += [
            {**r, "prompt_version": row["prompt_version"], "rejudged": True}
            for r in judge_rows(name, case, row["draft"])
        ]
    return rows


def main(args: list[str]) -> None:
    names = [a for a in args if not a.startswith("--")]
    if "--rejudge" in args:
        rows = rejudge(names)
    else:
        paths = sorted((HERE / "cases").glob("*.json"))
        if names:
            paths = [p for p in paths if p.stem in names]
        rows = [row for path in paths for row in run_case(path)]

    out = HERE / "results" / f"{datetime.now(UTC):%Y-%m-%d}.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("a") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)

    print(
        f"drafter {config.LLM_MODEL} ({config.LLM_EFFORT}), prompt {PROMPT_VERSION}; "
        f"judge {JUDGE_MODEL} ({JUDGE_REASONING}), {RUBRIC_VERSION}\n"
    )
    header = f"{'case':32} {'text':6} " + " ".join(f"{c[:12]:>12}" for c in CRITERIA)
    print(header + f" {'mean':>5} pass")
    for r in rows:
        print(
            f"{r['case']:32} {r['subject']:6} "
            + " ".join(f"{r['scores'][c]:>12}" for c in CRITERIA)
            + f" {r['mean']:>5} {'yes' if r['passed'] else 'no'}"
        )
    print(f"\nSaved to {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main(sys.argv[1:])

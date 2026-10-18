"""Draft each Executive Summary case and have an LLM judge score it (GN-07 AC2).

Each case in eval/summary_cases holds one Marsh sample report's Sections 3-12 as text and
that report's own Executive Summary. The case is drafted with the live pipeline
(`orchestrator.draft_summary_for`; nothing is retrieved), then the judge scores the
summary and, as a reference point, Marsh's own, with the same rubric. Same judge setup
as judge_sections.py (JUDGE_MODEL, two runs each).

Run from microservices/rag-service (costs one drafting call per case, plus judge calls):
    uv run --extra dev python -m eval.judge_summary [case ...]
--rejudge judges the newest saved drafts again, without drafting (no Claude calls).
Results are appended to eval/results/summary-<date>.jsonl.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config
from app.api.routes import Assessment, ReportSectionText
from app.generation.generator import DRAFTING_GUIDE, SUMMARY_PROMPT_VERSION
from app.orchestrator import orchestrator
from eval.judge_sections import DEDUCTION, JUDGE_MODEL, JUDGE_REASONING, JUDGE_RUNS, ask_judge

HERE = Path(__file__).parent
# v2: coverage asks only for the headline findings, and Marsh's site background is not
# invention. On v1 Marsh's own summary scored 1.0 on coverage: a summary leaves detail out.
# v3: professional judgement that follows from the sections is not invention (Miya, 18 Oct),
# and a redacted figure ($[VALUE]) cannot be left out.
RUBRIC_VERSION = "summary-rubric-v3"
CRITERIA = ["grounding", "no_invention", "coverage", "conventions"]
# Grounding and no invention matter most: the summary is what a client reads first, and
# AC2 says it holds only what the sections say. Confirm the marks after the first run.
PASS_FLOORS = {"grounding": 4.0, "no_invention": 4.0, "coverage": 3.5, "conventions": 3.0}
PASS_MEAN = 4.0

RUBRIC = """List every problem in the Executive Summary, one per issue, under one criterion:

- grounding: a statement the sections it cites do not support, or that cites the wrong
  section.
- no_invention: a fact, figure, standard or rating no section states. A professional
  judgement that follows from the sections (e.g. "above average risk of its class" for a
  B rating) is not invention; one that overreaches or contradicts them is a grounding
  issue.
- coverage: a headline finding the summary leaves out: the overall risk quality rating
  (S4), the loss estimate figures (S5), or a Priority 1 Opportunity for Improvement (S3).
  Quote it from the section. A summary is short on purpose: leaving out any other
  detail, however relevant, is not an issue. A figure the sections show only as a
  placeholder such as "$[VALUE]" cannot be stated, so leaving it out is not an issue.
- conventions: wording that breaks a writing convention in the drafting guide.

Rate each issue major (changes what a client or an insurer would understand, or invents
or misstates a fact) or minor (style or a small omission). Quote the exact words. Read
every sentence. If you find nothing for a criterion, list nothing for it."""


class Issue(BaseModel):
    model_config = ConfigDict(extra="forbid")
    criterion: Literal["grounding", "no_invention", "coverage", "conventions"]
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
    """Whether a case's averaged scores meet the pass mark."""
    floors = all(scores[c] >= floor for c, floor in PASS_FLOORS.items())
    return floors and sum(scores.values()) / len(scores) >= PASS_MEAN


def summary_text(statements: list[dict]) -> str:
    """The summary as the engineer reviews it: each statement with the sections it cites
    (`S:4` shown as S4, the label the judge sees on each section)."""
    lines = []
    for s in statements:
        cites = ", ".join(c.replace(":", "") for c in s["citations"]) or "nothing"
        lines.append(f"- {s['text']} [cites {cites}]")
    return "\n".join(lines)


def judge(case: dict, text: str, finished: bool) -> list[Issue]:
    """List the problems in a summary. `finished` marks Marsh's published one, which has
    no section labels to check."""
    # The same [S<id>] blocks the drafter reads (generator.draft_summary).
    sections = "\n\n".join(f"[S{s['id']}] {s['title']}\n{s['text']}" for s in case["sections"])
    user = "\n\n".join(
        [
            f"Site: {case['assessment']['facility_type']} in {case['assessment']['jurisdiction']}.",
            "The drafting guide the writer was given:\n" + DRAFTING_GUIDE,
            "The report's sections the writer was given:\n" + sections,
            (
                "Marsh's published Executive Summary to assess (it has no section labels, "
                "so do not count their absence). Its site background (ownership, lease, "
                "history, changes since the last survey) comes from the engineer's own "
                "records, not the sections, so it is not invention:\n"
                if finished
                else "Drafted Executive Summary to assess (each statement ends with the "
                "sections it cites):\n"
            )
            + text,
        ]
    )
    system = (
        "You assess the Executive Summary in Section 2 of a Marsh Property Risk Evaluation "
        "report, for a risk engineering team.\n\n" + RUBRIC
    )
    return ask_judge(system, user, Findings).issues


def run_case(path: Path) -> list[dict]:
    case = json.loads(path.read_text())
    draft = orchestrator.draft_summary_for(
        Assessment(**case["assessment"]), [ReportSectionText(**s) for s in case["sections"]]
    )
    return judge_rows(path.stem, case, draft)


def judge_rows(name: str, case: dict, draft: dict) -> list[dict]:
    """Judge a draft and Marsh's own summary, as result rows. The draft row keeps the
    whole draft, so it can be judged again without drafting (--rejudge)."""
    rows = []
    for subject, text in (
        ("draft", summary_text(draft["statements"])),
        ("marsh", case["reference"]),
    ):
        runs = [judge(case, text, finished=subject == "marsh") for _ in range(JUDGE_RUNS)]
        per_run = [scores_from(issues) for issues in runs]
        scores = {c: round(sum(r[c] for r in per_run) / len(per_run), 2) for c in CRITERIA}
        rows.append(
            {
                "case": name,
                "subject": subject,
                "scores": scores,
                "mean": round(sum(scores.values()) / len(scores), 2),
                "passed": passes(scores),
                # The production citation check: statements citing no section given.
                "unsupported_count": draft["guardrail"]["unsupported_count"]
                if subject == "draft"
                else None,
                "issues": [[i.model_dump() for i in issues] for issues in runs],
                "draft_model": draft["provenance"]["model"],
                "draft_effort": draft["provenance"]["effort"],
                "prompt_version": SUMMARY_PROMPT_VERSION,
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
    for path in sorted((HERE / "results").glob("summary-*.jsonl")):
        for line in path.read_text().splitlines():
            row = json.loads(line)
            if row.get("draft") and (not names or row["case"] in names):
                latest[row["case"]] = row
    rows = []
    for name, row in latest.items():
        case = json.loads((HERE / "summary_cases" / f"{name}.json").read_text())
        # Keep the prompt version the draft was written with, not today's.
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
        paths = sorted((HERE / "summary_cases").glob("*.json"))
        if names:
            paths = [p for p in paths if p.stem in names]
        rows = [row for path in paths for row in run_case(path)]

    out = HERE / "results" / f"summary-{datetime.now(UTC):%Y-%m-%d}.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("a") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)

    print(
        f"drafter {config.LLM_MODEL} ({config.LLM_EFFORT}), prompt {SUMMARY_PROMPT_VERSION}; "
        f"judge {JUDGE_MODEL} ({JUDGE_REASONING}), {RUBRIC_VERSION}\n"
    )
    print(f"{'case':18} {'text':6} " + " ".join(f"{c[:12]:>12}" for c in CRITERIA) + "  mean pass")
    for r in rows:
        print(
            f"{r['case']:18} {r['subject']:6} "
            + " ".join(f"{r['scores'][c]:>12}" for c in CRITERIA)
            + f" {r['mean']:>5} {'yes' if r['passed'] else 'no'}"
        )
    print(f"\nSaved to {out.relative_to(HERE.parent)}")


if __name__ == "__main__":
    main(sys.argv[1:])

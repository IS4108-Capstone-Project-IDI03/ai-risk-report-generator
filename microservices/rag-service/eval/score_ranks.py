"""Score the model's Section 6 maturity ranks against Marsh's own (GN-11 AC6).

Each case in eval/rank_cases holds observations written from a past report's Section 6
comments, and that report's rank per program. The script drafts Section 6 for each case,
keeping the case's own report out of retrieval, and counts in code (no LLM judge):
- exact and within-one-rank matches, over the rows the case has evidence for;
- what "always Embedded" would score on those rows, since most of Marsh's ranks are
  Embedded: the model's result means something only above it;
- evidenced rows left unrated, and rows rated with no evidence (AC2: should be none).

One paid drafting call per case. Ask before running:
    uv run python -m eval.score_ranks [case ...]
Results are appended to eval/results/<date>-ranks.jsonl.
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from app import config
from app.api.routes import Assessment, Observation
from app.generation.generator import PROMPT_VERSION
from app.orchestrator import orchestrator
from app.orchestrator.orchestrator import _PROGRAM_ROW, MATURITY_RANKS
from eval.judge_sections import _without_own_report

HERE = Path(__file__).parent


def ranks_in(draft: dict) -> dict[str, str]:
    """The rank the draft gives each program, as written (it may not be one of the five)."""
    rows = next(
        (s["statements"] for s in draft["subsections"] if s["heading"] == "Management Programs"),
        [],
    )
    found = {}
    for statement in rows:
        row = _PROGRAM_ROW.match(statement["text"])
        if row:
            found[row["program"].strip()] = row["rank"]
    return found


def score(expected: dict, draft: dict) -> dict:
    """Counts for one case. A row Marsh's report doesn't show legibly (rank None) is not scored."""
    given = ranks_in(draft)
    scored = {p: e for p, e in expected.items() if e["rank"]}
    evidenced = {p: e for p, e in scored.items() if e["evidence"]}

    def distance(program: str) -> int | None:
        rank = given.get(program)
        if rank not in MATURITY_RANKS:
            return None
        return abs(MATURITY_RANKS.index(rank) - MATURITY_RANKS.index(evidenced[program]["rank"]))

    rated = [p for p in evidenced if p in given]
    distances = [distance(p) for p in rated]
    return {
        "evidenced_rows": len(evidenced),
        "rated": len(rated),
        "exact": sum(d == 0 for d in distances),
        "within_one": sum(d is not None and d <= 1 for d in distances),
        "baseline_always_embedded": sum(e["rank"] == "Embedded" for e in evidenced.values()),
        "evidenced_but_unrated": len(evidenced) - len(rated),
        "rated_without_evidence": sum(
            1 for p, e in scored.items() if not e["evidence"] and p in given
        ),
    }


def run_case(path: Path) -> dict:
    case = json.loads(path.read_text())
    search = orchestrator.search
    orchestrator.search = _without_own_report(search, case.get("exclude_doc_id"))
    try:
        draft = orchestrator.draft(
            "6",
            Assessment(**case["assessment"]),
            [Observation(**o) for o in case["observations"]],
        )
    finally:
        orchestrator.search = search
    return {
        "case": path.stem,
        **score(case["expected"], draft),
        "ranks": ranks_in(draft),
        "model": draft["provenance"]["model"],
        "effort": config.LLM_EFFORT,
        "prompt_version": PROMPT_VERSION,
        "at": datetime.now(UTC).isoformat(),
    }


def main(names: list[str]) -> None:
    paths = sorted((HERE / "rank_cases").glob("*.json"))
    rows = [run_case(p) for p in paths if not names or p.stem in names]
    out = HERE / "results" / f"{datetime.now(UTC):%Y-%m-%d}-ranks.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("a") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)
    for r in rows:
        n = r["evidenced_rows"]
        print(
            f"{r['case']:28} exact {r['exact']}/{n}  within one {r['within_one']}/{n}  "
            f"always-Embedded {r['baseline_always_embedded']}/{n}  "
            f"unrated {r['evidenced_but_unrated']}  "
            f"rated without evidence {r['rated_without_evidence']}"
        )


if __name__ == "__main__":
    main(sys.argv[1:])

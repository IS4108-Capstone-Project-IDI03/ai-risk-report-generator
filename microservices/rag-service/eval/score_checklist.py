"""Score pre-survey checklists for every configured facility type (CP-30 AC12).

For each facility type, the script generates a checklist from the standards the knowledge
base applies to it, read from eval/checklist_cases.json, and counts in code (no LLM judge):
- template coverage: every template subsection of Sections 6-12 has its item;
- hazard coverage: every configured hazard has an item; how many rest on a passage, and
  how many on one of the standards the hazard names (AC7);
- citations: each resolves to a passage of a standard in scope, and its quote is found;
- AI items written, items left uncited, and the paid calls with their time.

The cases file comes from the gateway, which knows each standard's number (the passages in
Chroma do not), so the eval sees the same standards the Checklist tab offers. From server/:
    npm run export:checklist-cases -- ../microservices/rag-service/eval/checklist_cases.json
It holds the ids of one database's documents, so it is not committed.

One paid call per facility type (plus Cohere searches). Ask before running:
    uv run python -m eval.score_checklist [facility type ...]
Results are appended to eval/results/<date>-checklist.jsonl.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.api.routes import ScopeStandard
from app.generation.checklist import (
    CHECKLIST,
    CHECKLIST_PROMPT_VERSION,
    named_standard,
    template_items,
)
from app.orchestrator import orchestrator

HERE = Path(__file__).parent
CASES = HERE / "checklist_cases.json"


def load_cases(path: Path = CASES) -> tuple[str, dict[str, list[ScopeStandard]]]:
    """The country and, per facility type, the standards in scope, as the gateway lists them."""
    if not path.exists():
        sys.exit(f"{path} is missing. Export it from the gateway first; see this script's notes.")
    cases = json.loads(path.read_text(encoding="utf-8"))
    return cases["country"], {
        facility_type: [
            ScopeStandard(
                id=s["id"], source_type=s["source_type"], standard_number=s["standard_number"]
            )
            for s in standards
        ]
        for facility_type, standards in cases["standards"].items()
    }


def score(checklist: dict, standards: list[ScopeStandard]) -> dict:
    items = checklist["items"]
    expected = {(t["area"], t["subsection"]) for t in template_items()}
    templates = {(i["area"], i["subsection"]) for i in items if i["origin"] == "template"}
    hazards = [h["id"] for h in checklist["hazards"]]
    covered = {i["hazard"] for i in items if i["area"] == "hazards"}
    cited = {i["hazard"] for i in items if i["area"] == "hazards" and i["citations"]}
    # Hazards with an item citing one of the standards they are checked against (AC7).
    numbers = {s.id: (s.source_type, (s.standard_number or "").strip().lower()) for s in standards}
    named = {h["id"]: {named_standard(n) for n in h["standards"]} for h in checklist["hazards"]}
    own = {
        i["hazard"]
        for i in items
        if i["area"] == "hazards"
        and any(
            numbers.get(checklist["sources"].get(c["ref"], {}).get("doc_id")) in named[i["hazard"]]
            for c in i["citations"]
        )
    }
    citations = [c for i in items for c in i["citations"]]
    in_scope = {s.id for s in standards}
    resolves = [
        c["ref"] in checklist["sources"]
        and checklist["sources"][c["ref"]].get("doc_id") in in_scope
        for c in citations
    ]
    return {
        "standards_in_scope": len(standards),
        "template_items": f"{len(templates & expected)}/{len(expected)}",
        "hazards_covered": f"{len(covered & set(hazards))}/{len(hazards)}",
        "hazards_cited": f"{len(cited & set(hazards))}/{len(hazards)}",
        "hazards_cited_by_own_standard": f"{len(own & set(hazards))}/{len(hazards)}",
        "citations": len(citations),
        "citations_resolving": sum(resolves),
        "quotes_found": sum(c["quote_found"] for c in citations),
        # The model's own items; the hazard list's defaults are the team's.
        "written_items": sum(i["origin"] in ("standard", "hazard") for i in items),
        "areas_with_written_items": len({i["area"] for i in items if i["origin"] == "standard"}),
        "uncited_items": sum("uncited" in i["flags"] for i in items),
        "paid_calls": len(checklist["usage"]),
        "seconds": round(sum(u["duration_ms"] or 0 for u in checklist["usage"]) / 1000, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("facility_types", nargs="*")
    args = parser.parse_args()
    country, cases = load_cases()
    rows = []
    for facility_type in args.facility_types or list(CHECKLIST["hazards"]):
        standards = cases.get(facility_type, [])
        checklist = orchestrator.draft_checklist_for(facility_type, country, standards)
        rows.append(
            {
                "facility_type": facility_type,
                "country": country,
                **score(checklist, standards),
                "model": checklist["provenance"]["model"],
                "effort": checklist["provenance"]["effort"],
                "prompt_version": CHECKLIST_PROMPT_VERSION,
                "checklist_version": CHECKLIST["version"],
                "at": datetime.now(UTC).isoformat(),
            }
        )
    out = HERE / "results" / f"{datetime.now(UTC):%Y-%m-%d}-checklist.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("a") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)
    for r in rows:
        print(
            f"{r['facility_type']:24} standards {r['standards_in_scope']:>2}  "
            f"template {r['template_items']}  hazards {r['hazards_covered']} "
            f"(cited {r['hazards_cited']}, by own standard {r['hazards_cited_by_own_standard']})  "
            f"citations {r['citations_resolving']}/{r['citations']} "
            f"resolve, quotes {r['quotes_found']}/{r['citations']}  "
            f"uncited {r['uncited_items']}  {r['seconds']}s"
        )


if __name__ == "__main__":
    main()

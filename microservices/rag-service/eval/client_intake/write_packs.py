"""Writes the documents for the packs GPT-6.1 Sol writes (CP-23 evaluation) into golden.json.

Run by hand from microservices/rag-service. It is PAID (one call per pack, 12 packs) and
needs OPENAI_CHAT_API_KEY in the root .env, so it is not in CI. It prints its estimate first.
    uv run python -m eval.client_intake.write_packs [--only p07,p08]
Reads plans.json (the answer keys), appends cases to golden.json, skips packs already in it.
Calls app/generation/llm.py complete_json. Claude wrote the other half by hand (LABELS.md).
"""

import argparse
import json
from pathlib import Path

from pydantic import BaseModel

from app.generation.llm import complete_json

HERE = Path(__file__).resolve().parent
PROVIDER, MODEL, EFFORT = "openai", "gpt-6.1-sol", "medium"
PRICE_IN, PRICE_OUT = 2, 10  # USD per 1M tokens; must match eval/site_walk/run_eval.py PRICES
# Must match server/src/services/knowledge-document.service.ts FACILITY_TYPES and
# client/src/features/assessments/demo-data.ts JURISDICTIONS.
FACILITY_TYPES = [
    "Distribution warehouse", "Cold store", "Chemical plant", "Paper mill", "Port terminal",
    "Data centre", "Office", "Shopping mall", "Mixed-use development",
]  # fmt: skip
JURISDICTIONS = {
    "SG": "Singapore", "MY": "Malaysia", "ID": "Indonesia", "TH": "Thailand",
    "PH": "Philippines", "VN": "Vietnam", "HK": "Hong Kong", "UK": "United Kingdom",
}  # fmt: skip
# Recorded clients every request lists besides the pack's own, so matching has distractors.
DISTRACTORS = [
    {"id": "c-90", "name": "Banyan Cold Chain Pte Ltd", "division": None,
     "sites": [{"id": "s-9001", "name": "Banyan Cold Store 2",
                "address": "11 Kranji Way, Singapore 739432", "has_assessments": True}]},
    {"id": "c-91", "name": "Orrin Foods Sdn Bhd", "division": None,
     "sites": [{"id": "s-9101", "name": "Orrin Foods Plant",
                "address": "Lot 77, Jalan Industri 5, 75250 Melaka, Malaysia",
                "has_assessments": False}]},
    {"id": "c-92", "name": "Pelham Gardens Pte Ltd", "division": "Retail",
     "sites": [{"id": "s-9201", "name": "Pelham Mall",
                "address": "60 Pelham Road, Singapore 297010", "has_assessments": True}]},
]  # fmt: skip

SYSTEM = """You write the documents of an invented client pack for a test. A client of Marsh, a
commercial property insurance broker in Singapore, sent these documents to start property risk
surveys. Write each document as the PLAIN TEXT a text extractor would return from the file:
- email: From, To, optional Cc, Date, Subject header lines, a blank line, then the body;
- letter: letterhead, date, salutation, body, sign-off (a PDF or Word letter);
- sheet: a site information sheet as "Field: value" lines or short paragraphs;
- pasted: an email or note pasted as text, with or without headers.
Rules:
- Singapore English, natural and varied in length and tone. Names, companies and addresses are
  invented; use only the ones given.
- State every given value exactly: client name (as the brief spells it), division, each site's
  name and address, each visit's type in words (a first survey, a periodic re-survey, a short
  follow-up visit to check recommendations), dates, report due dates, and each contact's
  name and role. Write dates in full, e.g. "23 March 2027".
- Where a value is given as null/not stated, do not state it. A null visit date means the visit
  is still to be arranged; never imply a date. A null facility type means the property is not
  one of the usual kinds; just describe it. Do not add other visit or due dates.
- Where the brief says a later email changes a date, the earlier email gives the old date and
  the later one clearly replaces it.
- Spread facts across the documents the way a real client would; a document need not hold
  everything. Never mention a different recorded client except as the brief says.
- Email Date headers (when sent) fall in November or December 2026.
Return one entry per document, with the id you were given."""


class Doc(BaseModel):
    id: str
    text: str


class Pack(BaseModel):
    documents: list[Doc]


def brief_for(plan: dict) -> str:
    """Return the plan as the writer's brief: the values to state and what each document is."""
    key = {k: plan[k] for k in ("client", "sites", "assessments")}
    docs = [{k: d[k] for k in ("id", "name", "kind", "about")} for d in plan["documents"]]
    note = f"\nExtra: {plan['brief']}" if plan.get("brief") else ""
    recorded = [c["name"] for c in plan["recorded_clients"]]
    return (
        f"Facts to state (null = do not state):\n{json.dumps(key, indent=1)}\n\n"
        f"Documents to write:\n{json.dumps(docs, indent=1)}\n\n"
        f"The client's accounts already hold: {recorded}. Do not mention them unless the "
        f"documents are about that client.{note}"
    )


def request_for(plan: dict, index: int, docs: list[dict]) -> dict:
    """Return the step's request for a pack: its documents, the recorded clients (its own plus
    two distractors) and the lists."""
    names = {d["id"]: d["name"] for d in plan["documents"]}
    return {
        "documents": [{"id": d["id"], "name": names[d["id"]], "text": d["text"]} for d in docs],
        "clients": plan["recorded_clients"]
        + [DISTRACTORS[index % 3], DISTRACTORS[(index + 1) % 3]],
        "facility_types": FACILITY_TYPES,
        "jurisdictions": [{"code": c, "name": n} for c, n in JURISDICTIONS.items()],
    }


def check(plan: dict, docs: list[dict]) -> list[str]:
    """Return warnings when the written text drops a name the key needs (a spot-check for
    Jesper; the writer is not trusted to be exact)."""
    text = " ".join(d["text"] for d in docs).lower()
    wanted = [s["name"] for s in plan["sites"]] + [
        c["name"] for a in plan["assessments"] for c in a["site_contacts"]
    ]
    if "typo" not in plan["brief"] and "spells" not in plan["brief"]:
        wanted.append(plan["client"]["name"])
    return [f"{plan['id']}: '{w}' not found" for w in wanted if w.lower() not in text]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="comma-separated pack ids")
    args = parser.parse_args()
    # 1. Which packs still need writing.
    plans = json.loads((HERE / "plans.json").read_text())
    golden = json.loads((HERE / "golden.json").read_text())
    done = {c["id"] for c in golden["cases"]}
    todo = [
        (i, p) for i, p in enumerate(plans)
        if p["written_by"] == MODEL and p["id"] not in done
        and (not args.only or p["id"] in args.only.split(","))
    ]  # fmt: skip
    # 2. Print the estimate before any call: ~4 characters a token; each document is ~600
    # tokens out, plus ~4,000 of reasoning per pack.
    tokens_in = sum((len(SYSTEM) + len(brief_for(p))) / 4 for _, p in todo)
    tokens_out = sum(600 * len(p["documents"]) + 4000 for _, p in todo)
    cost = (tokens_in * PRICE_IN + tokens_out * PRICE_OUT) / 1e6
    print(
        f"{len(todo)} packs with {MODEL}: about {tokens_in:,.0f} in, "
        f"{tokens_out:,.0f} out, ~${cost:.2f}"
    )
    # 3. Write each pack and append it, saving after each so a failure keeps the earlier ones.
    for index, plan in todo:
        pack = complete_json(
            SYSTEM, brief_for(plan), Pack,
            provider=PROVIDER, model=MODEL, effort=EFFORT, feature="client-intake-eval",
        )  # fmt: skip
        docs = [d.model_dump() for d in pack.documents]
        assert [d["id"] for d in docs] == [d["id"] for d in plan["documents"]], plan["id"]
        golden["cases"].append({
            "id": plan["id"], "split": plan["split"], "written_by": MODEL,
            "request": request_for(plan, index, docs), "key": plan,
        })  # fmt: skip
        (HERE / "golden.json").write_text(json.dumps(golden, indent=1, ensure_ascii=False))
        print(plan["id"], "written", *check(plan, docs), sep="\n  ")


if __name__ == "__main__":
    main()

"""Client intake masking check (CP-23): which client details still show after masking.

Run by hand from microservices/rag-service with a privacy-service running (free, no AI call):
    PRIVACY_SERVICE_URL=http://localhost:8014 uv run python -m eval.client_intake.leaks
Masks each golden pack the way the gateway asks (recorded names known, company and building
detection on), then counts the key's client names, new site names, contact names and street
addresses still readable in the masked text. Prints each leak and the totals per kind.
"""

import json
from pathlib import Path

from app.privacy import session
from eval.client_intake.run_eval import privacy_for

HERE = Path(__file__).resolve().parent


def details(key: dict) -> list[tuple[str, str]]:
    """Return (kind, text) for every client detail the key names."""
    out = [("client", key["client"]["name"])]
    for s in key["sites"]:
        out += [("site", s["name"]), ("address", s["address"])]
    for a in key["assessments"]:
        out += [("contact", c["name"]) for c in a["site_contacts"]]
    return [(kind, text) for kind, text in out if text]


def main() -> None:
    cases = json.loads((HERE / "golden.json").read_text())["cases"]
    totals: dict[str, list[int]] = {}
    for case in cases:
        docs = case["request"]["documents"]
        masked = " ".join(session(privacy_for(case["request"]), 60).mask([d["text"] for d in docs]))
        plain = " ".join(d["text"] for d in docs).casefold()
        for kind, text in details(case["key"]):
            if text.casefold() not in plain:
                continue  # not written as such in the pack, so nothing to leak
            leaked = text.casefold() in masked.casefold()
            totals.setdefault(kind, [0, 0])
            totals[kind][0] += leaked
            totals[kind][1] += 1
            if leaked:
                print(f"{case['id']} {kind}: {text}")
    for kind, (leaked, seen) in totals.items():
        print(f"{kind:8} {leaked} of {seen} still readable")


if __name__ == "__main__":
    main()

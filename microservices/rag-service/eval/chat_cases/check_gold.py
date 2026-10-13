"""Checks each draft case's gold key phrase really is on the page it names (CB-01 eval).

Run: cd microservices/ingestion-service &&
  uv run python ../rag-service/eval/chat_cases/check_gold.py <cases.json>
Prints one line per gold turn: OK, or MISSING with the case id.
"""

import json
import re
import sys
from pathlib import Path

import pymupdf

PDFS = Path(__file__).resolve().parents[4] / ".local-docs" / "golden" / "pdfs"


def _norm(text: str) -> str:
    return " ".join(re.sub(r"[^\w\s]|_", " ", text.lower()).split())


def main(path: str) -> None:
    bad = 0
    for case in json.loads(Path(path).read_text()):
        for n, turn in enumerate(case["turns"]):
            # A comparison or multi-passage answer has a list of gold locations;
            # gold_any lists alternatives (near-identical text in two reports): check each.
            golds = turn.get("gold") or []
            golds = golds if isinstance(golds, list) else [golds]
            for gold in golds + (turn.get("gold_any") or []):
                doc = pymupdf.open(PDFS / gold["document"])
                text = " ".join(doc[p - 1].get_text() for p in gold["pages"] if 0 < p <= len(doc))
                ok = _norm(gold["key_phrase"]) in _norm(text)
                bad += not ok
                print(
                    "OK     " if ok else "MISSING", case["id"], n, gold["document"], gold["pages"]
                )
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main(sys.argv[1])

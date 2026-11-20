#!/usr/bin/env python3
"""DEV SCRIPT, not application code (CP-35, AC14). Asks the Gemini REST API, once, for invented
site-walk shorthand notes and saves them as test fixtures for the note splitter. The app itself
reads LLM_PROVIDER (CLAUDE.md); this script only makes fake data. Standard library only.

Needs GEMINI_API_KEY. Optional: SHORTHAND_NOTES_MODEL. Run: scripts/make-shorthand-notes.py -n 5
"""

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path

DEFAULT_MODEL = "gemini-3.8-flash"
DEFAULT_OUT = "microservices/rag-service/tests/fixtures/shorthand_notes.json"
MAX_OUTPUT_TOKENS = 1500  # caps the cost of the one call


def build_prompt(count: int) -> str:
    """The instruction sent to the model for `count` invented notes."""
    return (
        f"Invent {count} site-walk shorthand notes written by a commercial property risk "
        "engineer surveying a building in Singapore. Each note has 3 to 6 lines. Start some "
        "lines with the codes F: (fact), IR: (information request) or REC: (recommendation) "
        "and leave other lines uncoded. Use Marsh-style abbreviations (spk, bsmt, FA, rm, svc, "
        "elec, flr) and a few made-up shorthand terms nobody could know. Include numbers with "
        "units (mm, m, bar, psi, L/min, kg, %). Use no real people, companies or addresses.\n"
        "Return JSON only: an array of objects {id, note, expected}. `note` is the lines "
        "joined by newlines. `expected` lists each part as {kind, shorthand}, where kind is "
        "fact, info_request or recommendation and shorthand is the exact words from the note."
    )


def parse_notes(response: dict) -> list[dict]:
    """The note list inside a Gemini generateContent response."""
    return json.loads(response["candidates"][0]["content"]["parts"][0]["text"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-n", "--count", type=int, default=5)
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args()
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        print("GEMINI_API_KEY is not set. Set it and run again.", file=sys.stderr)
        return 1
    model = os.environ.get("SHORTHAND_NOTES_MODEL", DEFAULT_MODEL)
    body = {
        "contents": [{"parts": [{"text": build_prompt(args.count)}]}],
        "generationConfig": {
            "maxOutputTokens": MAX_OUTPUT_TOKENS,
            "temperature": 0.9,
            "responseMimeType": "application/json",
        },
    }
    # The one and only API call: no retry, no loop.
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 fixed https URL
        reply = json.load(response)
    notes = parse_notes(reply)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(notes, indent=2) + "\n")
    used = reply.get("usageMetadata", {}).get("candidatesTokenCount", "unknown")
    print(f"Saved {len(notes)} notes to {out}. Output tokens used: {used}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

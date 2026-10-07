"""Settings, allowed values and the price table for automatic labelling (IN-05).

Read by every other file in this package. Settings are read from the environment at
call time, so tests (and the evaluation script) can change them without a reload.
A blank setting (e.g. `LABEL_LLM_MODEL=`) means the default, as .env.example says.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Use the root .env locally (same as app/retrieval_config.py); Compose sets env in containers.
# A relative path, not parents[4]: in the container /app/app/labelling has too few parents,
# and parents[4] would crash the service on start.
load_dotenv(Path(__file__).resolve().parent / "../../../../.env")

DETAILS = ("source_type", "title", "edition", "effective_date", "jurisdiction", "facility_type")
FIXED_LIST = ("source_type", "jurisdiction", "facility_type")
STANDARDS = ("fm_standard", "nfpa_standard")

# Allowed values. Must match server/src/services/knowledge-document.service.ts
# (FACILITY_TYPES) and client/src/features/assessments/demo-data.ts (JURISDICTIONS,
# FACILITY_TYPES). "all" is valid for a standard only.
SOURCE_TYPES = {
    "fm_standard": "FM Global property loss prevention data sheet",
    "nfpa_standard": "NFPA code or standard",
    "marsh_report": "Marsh property risk engineering report",
}
JURISDICTIONS = {
    "SG": "Singapore",
    "MY": "Malaysia",
    "ID": "Indonesia",
    "TH": "Thailand",
    "PH": "Philippines",
    "VN": "Vietnam",
    "HK": "Hong Kong",
    "UK": "United Kingdom",
    "all": "a standard that applies in every country",
}
FACILITY_TYPES = [
    "Distribution warehouse",
    "Cold store",
    "Chemical plant",
    "Paper mill",
    "Port terminal",
    "Data centre",
    "Office",
    "Shopping mall",
    "Mixed-use development",
    "all",
]
# How to tell the closest facility types apart (tuning round 2): a mainly-office
# tower with some shops is an Office, not Mixed-use.
FACILITY_HINTS = {
    "Office": "Office: a building used mainly for offices, even with some retail or amenities",
    "Shopping mall": "Shopping mall: a building used mainly for retail",
    "Mixed-use development": (
        "Mixed-use development: only when the document itself calls the site mixed-use or a "
        "mixed development of several major uses"
    ),
    "all": "a standard covering every facility type",
}
ALLOWED = {
    "source_type": list(SOURCE_TYPES),
    "jurisdiction": list(JURISDICTIONS),
    "facility_type": FACILITY_TYPES,
}

# USD per 1M tokens, dated 2026-10-07. Also used by the evaluation script.
PRICES = {
    "jev": (0.042, 0.0),
    "openai-decisions": (0.10, 0.0),
    "claude-haiku-4-5": (1.0, 5.0),
    "gpt-6-luna": (0.10, 0.50),
}

# Only the first pages are read. Reports state the country (via "Currency: SGD") on
# pages 12-20 and the facility type on page 6, so 20 pages are needed.
DEFAULT_PAGES = 20
# OCR costs ~5 s per page. Scanned documents are old standards whose details are on pp. 1-4.
# ponytail: a flat cap instead of a time budget.
OCR_MAX_PAGES = 5

OPENAI_BASE = "https://api.openai.com/v1"  # never OPENAI_BASE_URL: .env points that at Groq


def classifier() -> str:
    """Return the fixed-list model: jev, openai-decisions or none."""
    return (os.getenv("LABEL_CLASSIFIER") or "jev").strip().lower()


def llm_provider() -> str:
    """Return the free-text model's provider: anthropic or openai."""
    return (os.getenv("LABEL_LLM_PROVIDER") or "openai").strip().lower()


def llm_model() -> str:
    """Return the free-text model's name (per-provider default)."""
    default = "gpt-6-luna" if llm_provider() == "openai" else "claude-haiku-4-5-20251001"
    return (os.getenv("LABEL_LLM_MODEL") or default).strip()


def pages() -> int:
    """Return how many pages from the start of the PDF are read."""
    return int(os.getenv("LABEL_PAGES") or DEFAULT_PAGES)


def min_confidence() -> float:
    """Return the cutoff for fixed-list details (Jev's cutoff from the 2026-10-07 evaluation)."""
    return float(os.getenv("LABEL_MIN_CONFIDENCE") or "0.70")


def api_key(name: str) -> str:
    """Return a required API key, or raise so the caller marks everything Unconfirmed."""
    key = os.getenv(name, "").strip()
    if not key or key == "REPLACE_ME":
        raise RuntimeError(f"Set {name} in the root .env to label documents")
    return key

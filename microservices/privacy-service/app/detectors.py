"""Which kinds of detail privacy-service looks for (PV-04), switched in detectors.json.

Whether to protect at all is the gateway's PII_PROTECTION: with it off, nothing calls this
service. With it on, only the kinds switched on here are looked for. Names the caller lists
(the assessment's client, site, address and people) are always masked, whatever the file says.
"""

import json
import os
from functools import cache
from pathlib import Path

KINDS = ("PERSON", "PHONE", "EMAIL", "NRIC", "UEN", "POSTAL", "ADDRESS", "VEHICLE")

# The service's own folder; PRIVACY_DETECTORS_FILE points elsewhere.
DEFAULT_FILE = Path(__file__).resolve().parent.parent / "detectors.json"


@cache
def enabled() -> frozenset[str]:
    """The kinds switched on. Read once; restart the service after changing the file."""
    path = Path(os.getenv("PRIVACY_DETECTORS_FILE") or DEFAULT_FILE)
    if not path.exists():  # nothing switched off: the safe default
        return frozenset(KINDS)
    settings = json.loads(path.read_text(encoding="utf-8"))
    # A typo stops the service, rather than leave a kind silently off.
    for kind, on in settings.items():
        if kind not in KINDS:
            raise ValueError(f"{path.name}: {kind} is not one of {', '.join(KINDS)}")
        if not isinstance(on, bool):
            raise ValueError(f"{path.name}: {kind} must be true or false")
    return frozenset(kind for kind in KINDS if settings.get(kind, True))

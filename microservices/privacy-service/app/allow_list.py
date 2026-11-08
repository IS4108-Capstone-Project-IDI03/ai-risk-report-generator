"""What privacy-service never masks, read from allow_list.json (PV-01, CP-23, PV-05).

- `never_a_person`: words the name model mistakes for people ("Hosereel", "Equivalencies"). A
  name the model guessed is kept as text when every one of its words is listed here.
- `never_a_person_patterns`: regular expressions for such words, each matched against one whole
  lower-case word ("L23" as `[lb][0-9]{1,3}[a-z]?`).
- `never_masked`: whole names that are never a client detail, such as Marsh and the standards
  bodies the drafts need, whatever found them.

Known names and patterns are never checked against the lists. Each list is grouped under a
heading that says why its entries are there. The file is read when the service starts (app.main),
so a typo stops it; edit it and restart the service, as for detectors.json.
"""

import json
import os
import re
from functools import cache
from pathlib import Path

# The service's own folder; PRIVACY_ALLOW_LIST_FILE points elsewhere.
DEFAULT_FILE = Path(__file__).resolve().parent.parent / "allow_list.json"
LISTS = ("never_a_person", "never_masked")
PATTERNS = "never_a_person_patterns"


@cache
def lists() -> dict:
    """Each list's entries in lower case, and the compiled patterns. Without the file nothing is
    allowed: masking more is the safe side."""
    path = Path(os.getenv("PRIVACY_ALLOW_LIST_FILE") or DEFAULT_FILE)
    settings = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    # A typo stops the service, rather than leave a word masked or unmasked without a sign.
    for key, groups in settings.items():
        if key not in (*LISTS, PATTERNS):
            raise ValueError(f"{path.name}: {key} is not one of {', '.join((*LISTS, PATTERNS))}")
        if not isinstance(groups, dict):
            raise ValueError(f"{path.name}: {key} must group its entries under headings")
        for heading, entries in groups.items():
            if key == PATTERNS:
                _compiled(path, heading, entries)
            elif not (isinstance(entries, list) and all(isinstance(e, str) for e in entries)):
                raise ValueError(f"{path.name}: {heading} must be a list of words")
    found = {
        key: frozenset(
            " ".join(entry.casefold().split())
            for entries in settings.get(key, {}).values()
            for entry in entries
        )
        for key in LISTS
    }
    found[PATTERNS] = [_compiled(path, h, p) for h, p in settings.get(PATTERNS, {}).items()]
    return found


def _compiled(path: Path, heading: str, pattern) -> re.Pattern:
    if not isinstance(pattern, str):
        raise ValueError(f"{path.name}: {heading} must be one regular expression")
    try:
        return re.compile(pattern)
    except re.error as error:
        raise ValueError(f"{path.name}: {heading} is not a valid pattern ({error})") from None


def is_allowed(text: str) -> bool:
    """Whether every word of a guessed name is one the name model mistakes for a person."""
    words = text.casefold().split()
    found = lists()
    return bool(words) and all(
        word in found["never_a_person"] or any(p.fullmatch(word) for p in found[PATTERNS])
        for word in words
    )


# Names whose teams are never masked either ("Marsh Property Risk Engineering"). Short names
# such as "FM" are left out: "FM Logistics" could be a client.
TEAMS_OF = ("marsh", "fm global")


def is_never_masked(text: str) -> bool:
    """Whether `text` is a listed name, or a team of Marsh or FM Global."""
    name = " ".join(text.casefold().split())
    return name in lists()["never_masked"] or any(name.startswith(team + " ") for team in TEAMS_OF)

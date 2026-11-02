"""Location spelling rules for the site walk step (CP-22), ported from the gateway.

Called by app/site_walk/propose.py and eval/site_walk/scoring.py. Must match standardLevel
and locationKey in server/src/services/location.service.ts, so a place matched here is the
one the gateway would treat as a duplicate.
"""

import re


def standard_level(level: str) -> str:
    """Return a level in its standard spelling ("L2", "2nd floor" -> "Level 2"), else as given."""
    lvl = re.sub(r"\s+", " ", level.strip().lower())
    if m := re.fullmatch(r"(?:basement|b) ?(\d+)", lvl):
        return f"Basement {int(m[1])}"
    if lvl == "basement":
        return "Basement"
    if re.fullmatch(r"lower ground|lg", lvl):
        return "Lower ground"
    if re.fullmatch(r"ground|ground floor|g|gf", lvl):
        return "Ground"
    if re.fullmatch(r"upper ground|ug", lvl):
        return "Upper ground"
    if re.fullmatch(r"mezzanine|mezz", lvl):
        return "Mezzanine"
    if re.fullmatch(r"roof|rooftop|roof level", lvl):
        return "Roof"
    m = re.fullmatch(r"(?:level|lvl|l|floor|storey) ?(\d+)", lvl) or re.fullmatch(
        r"(\d+)(?:st|nd|rd|th)?(?: floor)?", lvl
    )
    if m:
        return f"Level {int(m[1])}"
    return level.strip()


def location_key(name: str, floor: str | None, building: str | None) -> str:
    """Return the gateway's duplicate key: name, level and building, case-insensitive."""
    key = f"{name.strip().lower()}|{(floor or '').strip().lower()}"
    return f"{key}|{building.strip().lower()}" if building and building.strip() else key


def describe(building: str | None, floor: str | None, name: str) -> str:
    """Return a place as the report words it: "Loading bay, Level 1, Block A"."""
    return ", ".join(part for part in (name, floor, building) if part)


def _building_words(building: str) -> list[str]:
    """A building name's words, lower case, punctuation dropped and "Blk" read as "Block"."""
    return ["block" if w == "blk" else w for w in re.findall(r"[a-z0-9]+", building.lower())]


def existing_building(spoken: str, buildings: list[str]) -> str | None:
    """Return the existing building a spoken name means, spelled as on the assessment, else None.

    The same words match ("Tower 2 (office)" for "Tower 2 (Office)"); otherwise its short form
    does ("Tower B" for "Tower B — Retail Podium", "Block C" for "Blk C Car Park"), but only when
    one building starts with it. Rag-service only; the gateway has no such rule.
    """
    said = _building_words(spoken)
    if not said:
        return None
    if same := [b for b in buildings if _building_words(b) == said]:
        return same[0]
    longer = {
        tuple(_building_words(b)): b for b in buildings if _building_words(b)[: len(said)] == said
    }
    # Two buildings start with it ("Tower B — Retail", "Tower B — Office"): too unclear to pick.
    return next(iter(longer.values())) if len(longer) == 1 else None

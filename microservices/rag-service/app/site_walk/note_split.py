"""Split a shorthand site note into facts, info requests and recommendations (CP-35).

Called by routes.py's /split-note (asked by the gateway's note-sort service). Calls privacy.py
(mask, unmask) and llm.complete under LLM_PROVIDER. The model only splits and expands; the
number check and the unknown-term check are done in code afterwards. Nothing is saved.
"""

import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app import privacy as pii
from app.generation.llm import complete

# Must match AI_FEATURES in server/src/models/ai-call.model.ts.
FEATURE = "split-note"
PROMPT_VERSION = "cp35-v2"

# The Marsh shorthand list (lower-case keys), without its "_about" note.
_MARSH = {
    k: v
    for k, v in json.loads(
        (Path(__file__).parents[1] / "retrieval" / "site_abbreviations.json").read_text()
    ).items()
    if not k.startswith("_")
}
# A number as written: an optional sign, thousands groups ("1,000" or "20 000"), a decimal part
# ("4.5" or "4,5"), then an optional unit. A "-" glued to a digit or word is a range dash,
# not a sign.
_UNITS = (
    r"l/min|gpm|mm|kpa|mpa|kg|bar|psi|hrs?|hours?|minutes?|min|metres?|meters?|m|"
    r"litres?|liters?|l|%|per cent|percent"
)
_NUMBER = re.compile(
    rf"(?:(?<![\w.])-)?\d+(?:[ ,]\d{{3}}(?!\d))*(?:[.,]\d+)?\s*(?:{_UNITS})?(?![a-z])",
    re.IGNORECASE,
)
_UNIT_CANON = {
    "hrs": "hr", "hour": "hr", "hours": "hr", "minute": "min", "minutes": "min",
    "metre": "m", "metres": "m", "meter": "m", "meters": "m",
    "litre": "l", "litres": "l", "liter": "l", "liters": "l",
    "percent": "%", "per cent": "%",
}  # fmt: skip


def _split_number(text: str) -> tuple[float, str]:
    """A matched number as (value, canonical unit): '1,000 L' and '1000 l' give the same pair."""
    m = re.match(r"(-?[\d ,.]+?)\s*([a-z/%][a-z /]*)?$", text.strip(), re.IGNORECASE)
    raw, unit = (m.group(1), m.group(2) or "") if m else (text, "")
    raw = raw.replace(" ", "")
    # "1,000" and "20 000" are thousands; "4,5" is a decimal comma.
    raw = (
        raw.replace(",", "")
        if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", raw)
        else raw.replace(",", ".")
    )
    unit = unit.strip().lower()
    return float(raw), _UNIT_CANON.get(unit, unit)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns.
class ModelPart(_Model):
    line: int
    kind: Literal["fact", "info_request", "recommendation"]
    text: str
    shorthand: str
    unknown_terms: list[str]


class SplitResult(_Model):
    parts: list[ModelPart]


SYSTEM = """You split a risk engineer's shorthand site-walk notes for a commercial property \
risk survey in Singapore. Each line is numbered. Split every line into one or more parts and \
give each part a kind:
- fact: only what was observed.
- info_request: something to ask for or obtain (a report, a document, an answer).
- recommendation: advice about what should be done.

For each part give:
- line: the number of the line it came from.
- text: its meaning in full words, with every shorthand term spelt out, using the Marsh \
shorthand list and the engineer's own glossary below. Drop a leading code such as F:, IR: or REC:.
- shorthand: the exact words of the line this part came from.
- unknown_terms: shorthand terms in the part you could not expand from either list. Do not \
guess them: leave them as written in text.

Rules:
- Never invent facts, numbers or names. Keep every number, unit and name exactly as written.
- A code such as F:, IR: or REC: anywhere in a line starts a new part of that kind (F is fact, \
IR is info_request, REC is recommendation); drop the code from text and shorthand.
- If a line has no clear split, return it as one fact part.
- Return every line at least once."""


def _terms(glossary) -> dict[str, str]:
    """The Marsh list plus the engineer's own, all lower-case keys."""
    return {**_MARSH, **{g.term.lower(): g.meaning for g in glossary}}


def _known(term: str, terms: dict[str, str]) -> bool:
    """True if `term` is in the lists, or every word of it is. One unknown word (as in
    'xyz pump') keeps it unknown: without this, a guessed expansion would pass as known."""
    t = term.lower().strip()
    words = re.findall(r"[a-z0-9/.\-]+", t)
    return t in terms or (bool(words) and all(w in terms for w in words))


def _numbers(text: str) -> list[str]:
    """Numbers (with unit) in `text`, lower-case with spaces removed, so '10 mm' == '10mm'."""
    return [re.sub(r"\s+", "", m.group(0).lower()) for m in _NUMBER.finditer(text)]


def _kept(number: str, text: str) -> bool:
    """True if a number from the engineer's words is still in `text` with the same value (so
    '1,000' = '1000', '4,5' = '4.5', '-5' is not '5') and the same unit, short or in words."""
    value, unit = _split_number(number)
    for m in _NUMBER.finditer(text):
        found, found_unit = _split_number(m.group(0))
        if found == value and (not unit or found_unit == unit):
            return True
    return False


def _flags(part: ModelPart, terms: dict[str, str]) -> list[dict]:
    """The checks done in code: a number missing from the text, and unknown terms."""
    flags = []
    # A number in the words the engineer wrote that is gone from the wording means the model
    # changed it; without this check a dropped "150 mm" would go into the report unnoticed.
    for number in dict.fromkeys(_numbers(part.shorthand)):
        if not _kept(number, part.text):
            flags.append({"type": "number_changed", "detail": number})
    # The model only reports candidates; code decides what is unknown.
    for term in dict.fromkeys(t.strip() for t in part.unknown_terms if t.strip()):
        if not _known(term, terms):
            flags.append({"type": "unknown_term", "detail": term})
    return flags


def split_note(lines: list[str], glossary, privacy=None) -> dict:
    """Return `{parts, usage, provenance}`: each part typed, expanded and flagged, with the
    index of the line it came from. Raises PrivacyUnavailable if masking fails."""
    paid_calls = usage.start()
    protection = pii.session(privacy)
    terms = _terms(glossary)

    # a. Mask every line in one /mask call; nothing raw goes to the model when protection is on.
    masked = protection.mask(lines)
    listing = "\n".join(f"{n}: {line}" for n, line in enumerate(masked))
    own = "\n".join(f"- {g.term}: {g.meaning}" for g in glossary) or "(none)"
    marsh = "\n".join(f"- {k}: {v}" for k, v in _MARSH.items())
    user = f"Marsh shorthand:\n{marsh}\n\nEngineer's glossary:\n{own}\n\nLines:\n{listing}"

    # b. One model call for all lines.
    result, model = complete(
        SYSTEM,
        user,
        SplitResult,
        config.SPLIT_NOTE_EFFORT,
        feature=FEATURE,
        model=config.SPLIT_NOTE_MODEL,
    )

    # c. Finish in code: restore real values, drop empty or stray parts, then check them.
    parts = []
    for p in result.parts:
        text, left1 = protection.unmask(p.text.strip())
        shorthand, left2 = protection.unmask(p.shorthand.strip())
        # A placeholder that could not be restored must not reach the engineer.
        if not text or not 0 <= p.line < len(lines) or left1 or left2:
            continue
        restored = ModelPart(
            line=p.line,
            kind=p.kind,
            text=text,
            shorthand=shorthand,
            unknown_terms=[protection.unmask(t)[0] for t in p.unknown_terms],
        )
        parts.append(
            {**restored.model_dump(exclude={"unknown_terms"}), "flags": _flags(restored, terms)}
        )

    # c2. A term flagged unknown on one part is unknown on every part that uses it: the model
    # reports it only once, and the engineer would add it to the glossary for one part only.
    unknown = {f["detail"] for p in parts for f in p["flags"] if f["type"] == "unknown_term"}
    for p in parts:
        have = {f["detail"] for f in p["flags"] if f["type"] == "unknown_term"}
        for term in sorted(unknown - have):
            if re.search(rf"(?<!\w){re.escape(term)}(?!\w)", p["shorthand"], re.IGNORECASE):
                p["flags"].append({"type": "unknown_term", "detail": term})

    # d. A line the model skipped (or no output at all) comes back as one fact part.
    seen = {p["line"] for p in parts}
    for n, line in enumerate(lines):
        if n not in seen:
            parts.append({"kind": "fact", "text": line, "shorthand": line, "flags": [], "line": n})
    parts.sort(key=lambda p: p["line"])
    return {
        "parts": parts,
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.SPLIT_NOTE_EFFORT,
            "prompt_version": PROMPT_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
            "privacy": protection.provenance(),
        },
    }

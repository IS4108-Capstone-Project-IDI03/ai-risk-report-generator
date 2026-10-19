"""Puts the real text back into what a model wrote from masked text (PV-01).

Pure string work with no model, so a caller can copy it and unmask a streamed answer chunk by
chunk without a call to this service (PV-03).
"""

import re

TYPES = ("CLIENT", "SITE", "ADDRESS", "PERSON", "NRIC", "PHONE", "EMAIL", "UEN", "POSTAL")

# Lenient: a model may drop the brackets or change the case ("person_1", "PERSON_1").
_PLACEHOLDER = re.compile(rf"\[?\b({'|'.join(TYPES)})_(\d+)\b\]?", re.IGNORECASE)


def unmask(text: str, mapping: dict[str, str]) -> tuple[str, list[str]]:
    """Return `text` with each placeholder replaced, and the placeholders it could not resolve.

    An unresolved one is left as written, so the caller can flag what holds it.
    """
    unknown: list[str] = []

    def restore(match: re.Match) -> str:
        placeholder = f"[{match[1].upper()}_{match[2]}]"
        if placeholder in mapping:
            return mapping[placeholder]
        unknown.append(placeholder)
        return match[0]

    return _PLACEHOLDER.sub(restore, text), unknown

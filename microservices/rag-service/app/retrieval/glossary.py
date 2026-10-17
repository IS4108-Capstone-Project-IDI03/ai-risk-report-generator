"""Short forms engineers type that the standards spell out (CB-01).

"What density and area do I use for an EH2 area?" never matches a table that
prints "Extra Group 2". The query is searched with the long form added in
brackets; the corpus keeps the standard's own words.
"""

import re

# short form (as typed) -> how the standards write it
_FORMS = {
    r"EH[- ]?1": "Extra Hazard Group 1 (Extra Group 1)",
    r"EH[- ]?2": "Extra Hazard Group 2 (Extra Group 2)",
    r"OH[- ]?1": "Ordinary Hazard Group 1 (Ordinary Group 1)",
    r"OH[- ]?2": "Ordinary Hazard Group 2 (Ordinary Group 2)",
    r"LH": "Light Hazard",
    r"FDC": "fire department connection",
    r"ITM": "inspection, testing, and maintenance",
    r"QR": "quick-response",
}
_PATTERNS = [(re.compile(rf"\b{short}\b"), long) for short, long in _FORMS.items()]


def expand_query(query: str) -> str:
    """Return the query with the long form of each short form in it added in brackets."""
    spelled = [long for pattern, long in _PATTERNS if pattern.search(query)]
    return f"{query} ({'; '.join(spelled)})" if spelled else query

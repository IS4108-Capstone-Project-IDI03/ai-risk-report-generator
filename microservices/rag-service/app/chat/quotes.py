# Pulls Cite() calls out of the answer model's OpenUI Lang and checks quotes
# against passage text. Story CB-01 (AC2: every citation quote must be real).
# Called by app/chat/answer.py.
import json
import re

# A double-quoted string with backslash escapes.
_STR = r'"(?:[^"\\]|\\.)*"'
# Needs the closing ")" so a stream cut mid-string never matches.
_CITE = re.compile(rf"Cite\(\s*({_STR})\s*,\s*({_STR})\s*\)")


def find_cites(program: str) -> list[tuple[str, str]]:
    """Return every complete Cite(label, quote) in order, escapes decoded."""
    cites = []
    for label, quote in _CITE.findall(program):
        try:
            cites.append((json.loads(label), json.loads(quote)))
        except json.JSONDecodeError:
            pass  # a bad escape would otherwise crash the whole answer
    return cites


def _squash(text: str) -> str:
    """Return text lower-cased with every whitespace run as one space."""
    return " ".join(text.lower().split())


def _bare(text: str) -> str:
    """Return text squashed, with all punctuation dropped."""
    return " ".join(re.sub(r"[^\w\s]|_", "", _squash(text)).split())


def quote_found(quote: str, passage: str) -> bool:
    """Return True if the quote occurs in the passage, loosest match last."""
    if not quote.strip():
        return False  # "" is a substring of everything; it proves nothing
    return quote in passage or _squash(quote) in _squash(passage) or _bare(quote) in _bare(passage)

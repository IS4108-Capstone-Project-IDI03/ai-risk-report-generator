"""Swaps client details in text for typed placeholders, e.g. "NUS" -> "[CLIENT_1]" (PV-01).

One mapping covers a whole request, so the same detail always gets the same placeholder, and
callers put the real text back with `placeholders.unmask` once the model has answered.

Details are found two ways: the names the caller already knows (the assessment's client, site and
people), and Presidio's recognisers for details nobody listed.
"""

import re
from dataclasses import dataclass
from functools import cache

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import SpacyNlpEngine
from presidio_analyzer.predefined_recognizers import (
    EmailRecognizer,
    PhoneRecognizer,
    SgFinRecognizer,
    SpacyRecognizer,
)

from app.allow_list import is_allowed

# Presidio's entity names -> our placeholder types.
TYPES = {
    "PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL",
    "SG_NRIC_FIN": "NRIC",
    "PERSON": "PERSON",
}

# Words that must come shortly before a detail for it to count, since the same digits are as
# likely a figure ("sum insured 91234567") or a part number ("12345678A"). A phone number written
# as one (+65, or with a space or dash) needs no label.
LABELS = {
    "PHONE": re.compile(
        r"\b(call|tel|telephone|phone|hp|mobile|mob|contact|fax|whatsapp)\b", re.IGNORECASE
    ),
    "NRIC": re.compile(r"\b(nric|fin|ic|i/c|identity)\b", re.IGNORECASE),
    "UEN": re.compile(r"\b(uen|reg|registration|company no)\b", re.IGNORECASE),
}
LABEL_WINDOW = 30  # characters before the detail

# Singapore details Presidio has no recogniser for. Only the `v` group is replaced.
PATTERNS = {
    # Business (8 digits + letter), local company (year + 5 digits + letter), other entities.
    "UEN": re.compile(r"\b(?P<v>\d{8}[A-Z]|(?:19|20)\d{7}[A-Z]|[RST]\d{2}[A-Z]{2}\d{4}[A-Z])\b"),
    # Only after "Singapore": six digits alone are as likely a figure as a postal code.
    "POSTAL": re.compile(r"\bSingapore\s*\(?(?P<v>\d{6})\b", re.IGNORECASE),
}


@dataclass(frozen=True)
class KnownEntity:
    type: str
    names: list[str]


@dataclass(frozen=True)
class _Span:
    start: int
    end: int
    type: str
    # What the placeholder restores to: a known entity's first name, else the text itself.
    original: str


@cache
def _analyzer() -> AnalyzerEngine:
    """Built once per process: loading the spaCy model takes seconds."""
    registry = RecognizerRegistry()
    registry.add_recognizer(EmailRecognizer())
    # Without SG, Presidio reads only US/European numbers.
    registry.add_recognizer(PhoneRecognizer(supported_regions=("SG",)))
    registry.add_recognizer(SgFinRecognizer())
    # People only. spaCy's organisations and places would also catch brands, standards and
    # floors (Tyco, NFPA, L27), which the drafts need; known names cover the client and site.
    registry.add_recognizer(SpacyRecognizer(supported_entities=["PERSON"]))
    nlp = SpacyNlpEngine(models=[{"lang_code": "en", "model_name": "en_core_web_lg"}])
    return AnalyzerEngine(registry=registry, nlp_engine=nlp, supported_languages=["en"])


def mask(
    texts: list[str], known: list[KnownEntity], mapping: dict[str, str] | None = None
) -> tuple[list[str], dict[str, str]]:
    """Return the texts with each detail replaced, and placeholder -> the text it replaced."""
    mapping = dict(mapping or {})
    masked = []
    for text in texts:
        # Right to left, so replacing one span leaves the earlier offsets valid. Placeholders are
        # allocated left to right, so they number in reading order.
        spans = _spans(text, known)
        placeholders = [_placeholder(span, mapping) for span in spans]
        for span, placeholder in reversed(list(zip(spans, placeholders))):
            text = text[: span.start] + placeholder + text[span.end :]
        masked.append(text)
    return masked, mapping


def _spans(text: str, known: list[KnownEntity]) -> list[_Span]:
    """The details in `text`, left to right, none overlapping.

    Where two overlap, the surer one is kept: a known name, then a pattern, then a recogniser,
    then a name the model guessed (it reads "NRIC S1234567D" as a person).
    """
    detected = _analyzer().analyze(text, language="en", entities=list(TYPES))
    found = [
        _Span(m.start(), m.end(), entity.type, entity.names[0])
        for entity in known
        for name in entity.names
        for m in _name_pattern(name).finditer(text)
    ]
    found += [
        _Span(m.start("v"), m.end("v"), type_, m["v"])
        for type_, pattern in PATTERNS.items()
        for m in pattern.finditer(text)
    ]
    found += [
        _Span(r.start, r.end, TYPES[r.entity_type], text[r.start : r.end])
        for r in sorted(detected, key=lambda r: r.entity_type == "PERSON")
        if not (r.entity_type == "PERSON" and is_allowed(text[r.start : r.end]))
    ]
    found = [span for span in found if _stands_as(span, text)]
    kept: list[_Span] = []
    for span in found:  # surest first, so it is kept over what it overlaps
        if not any(span.start < k.end and k.start < span.end for k in kept):
            kept.append(span)
    return sorted(kept, key=lambda s: s.start)


def _stands_as(span: _Span, text: str) -> bool:
    """Whether a found phone number or ID is one, not a figure or part number of the same shape."""
    if span.type not in LABELS:
        return True
    if span.type == "PHONE" and re.search(r"[+\s-]", span.original):
        return True
    before = text[max(0, span.start - LABEL_WINDOW) : span.start]
    return bool(LABELS[span.type].search(before))


def _name_pattern(name: str) -> re.Pattern:
    """The name as whole words, in any case and with any spacing between its words."""
    words = r"\s+".join(re.escape(word) for word in name.split())
    return re.compile(rf"\b{words}\b", re.IGNORECASE)


def _placeholder(span: _Span, mapping: dict[str, str]) -> str:
    words = _words(span.original)
    for placeholder, original in mapping.items():
        if not placeholder.startswith(f"[{span.type}_"):
            continue
        # "Tan" after "John Tan" is the same person.
        if words == _words(original) or (span.type == "PERSON" and words <= _words(original)):
            return placeholder
    n = sum(p.startswith(f"[{span.type}_") for p in mapping) + 1
    placeholder = f"[{span.type}_{n}]"
    mapping[placeholder] = span.original
    return placeholder


def _words(text: str) -> set[str]:
    return set(text.casefold().split())

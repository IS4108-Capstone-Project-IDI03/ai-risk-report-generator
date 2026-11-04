"""Swaps client details in text for typed placeholders, e.g. "NUS" -> "[CLIENT_1]" (PV-01).

One mapping covers a whole request, so the same detail always gets the same placeholder, and
callers put the real text back with `placeholders.unmask` once the model has answered.

Details are found three ways: the names the caller already knows (the assessment's client, site and
people), patterns for details with a fixed shape, and Presidio's recognisers for details nobody
listed. When the caller sets `detect: ["SITE"]` (CP-23), two more patterns read building names
("Quarry Hill Tower 1") and street addresses ("55 Queen's Road Central"), which spaCy mostly misses.
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

from app.allow_list import is_allowed, is_never_masked

# Presidio's entity names -> our placeholder types.
TYPES = {
    "PHONE_NUMBER": "PHONE",
    "EMAIL_ADDRESS": "EMAIL",
    "SG_NRIC_FIN": "NRIC",
    "PERSON": "PERSON",
}

# What `detect` asks for -> the Presidio entity it reads (spaCy's ORG is Presidio's
# ORGANIZATION). Places (GPE, LOC) are never read, so a jurisdiction can still be found.
DETECT = {"CLIENT": "ORGANIZATION", "SITE": "FAC"}
SPACY_TYPES = {"ORGANIZATION": "CLIENT", "FAC": "SITE"}

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

# Site-only patterns (CP-23), used when `detect` has "SITE". Capitalised word = one word like
# "Quarry" or "Queen's". Only the `v` group is replaced; city, country and postal code stay.
_CAP = r"[A-Z][\w'’-]*"
_BUILDING_NOUNS = (
    "Towers?|Centre|Center|Hub|Campus|Mall|Plaza|House|Building|Warehouse|Plant|Terminal|Park|"
    "Point|Square|Estate|Complex|Hotel|Hospital|Factory|Depot|Junction|Heights|Residences|Court|"
    "Place|Quay|Wharf|Gardens|Hall|Block|Facility"
)
# Headings are often in capitals ("OAKHAVEN CAMPUS INFORMATION SHEET"), so a noun may be too.
_BUILDING_NOUNS += "|" + _BUILDING_NOUNS.upper()
_STREET_WORDS = (
    "Road|Rd|Street|St|Avenue|Ave|Link|Drive|Dr|Lane|Way|Boulevard|Crescent|Close|Walk|Central|Park"
)
SITE_PATTERNS = {
    # A house number, then up to four name words ending in a street word: "5 Changi Business
    # Park Central 2". Greedy, so the last street word ends it.
    "ADDRESS": re.compile(
        rf"\b(?P<v>\d+[A-Za-z]?[ \t]+(?:{_CAP}[ \t]+){{1,4}}(?:{_STREET_WORDS})\b(?:[ \t]+\d+\b)?)"
    ),
    # Malay, Indonesian and Thai street forms: "Jalan Seri Utama 2".
    "ADDRESS_LOCAL": re.compile(
        rf"\b(?P<v>(?:Jalan|Jln|Lorong|Soi|Thanon)[ \t]+{_CAP}(?:[ \t]+{_CAP}){{0,2}}"
        r"(?:[ \t]+\d+\b)?)"
    ),
    # One to four name words, a building noun, then an optional "2", "Phase 1", "B" or "Central".
    "SITE": re.compile(
        rf"\b(?:(?:The|This|That|Our|At|In|On|Of|And|For|To|With|From)[ \t]+)?"
        rf"(?P<v>(?:{_CAP}[ \t]+){{1,4}}(?:{_BUILDING_NOUNS})\b"
        r"(?:[ \t]+(?:Phase[ \t]+\d+|\d+|[A-Z]|Central|North|South|East|West)\b)?)"
    ),
}
# Words that make a match no site name: a sentence opener left alone ("The Tower"), or a
# fire-safety room ("Fire Pump House").
NOT_NAME_WORDS = set(
    "the this that our at in on of and for with from fire safety real senior assistant".split()
)


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
    # It can read people, organisations and facilities, but `_spans` asks only for people unless
    # the caller sets `detect`: organisations would also catch brands, standards and floors
    # (Tyco, NFPA, L27), which the drafts need; known names cover the client and site.
    registry.add_recognizer(SpacyRecognizer(supported_entities=["PERSON", "ORGANIZATION", "FAC"]))
    nlp = SpacyNlpEngine(models=[{"lang_code": "en", "model_name": "en_core_web_lg"}])
    return AnalyzerEngine(registry=registry, nlp_engine=nlp, supported_languages=["en"])


def mask(
    texts: list[str],
    known: list[KnownEntity],
    mapping: dict[str, str] | None = None,
    detect: list[str] | None = None,
) -> tuple[list[str], dict[str, str]]:
    """Return the texts with each detail replaced, and placeholder -> the text it replaced."""
    mapping = dict(mapping or {})
    masked = []
    for text in texts:
        # Right to left, so replacing one span leaves the earlier offsets valid. Placeholders are
        # allocated left to right, so they number in reading order.
        spans = _spans(text, known, detect or [])
        placeholders = [_placeholder(span, mapping) for span in spans]
        for span, placeholder in reversed(list(zip(spans, placeholders))):
            text = text[: span.start] + placeholder + text[span.end :]
        masked.append(text)
    return masked, mapping


def _spans(text: str, known: list[KnownEntity], detect: list[str]) -> list[_Span]:
    """The details in `text`, left to right, none overlapping.

    Where two overlap, the surer one is kept: a known name, then a pattern, then a recogniser,
    then a name the model guessed (it reads "NRIC S1234567D" as a person).
    """
    entities = [*TYPES, *(DETECT[kind] for kind in detect)]
    detected = _analyzer().analyze(text, language="en", entities=entities)
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
    if "SITE" in detect:
        found += _site_spans(text)
    found += [
        _Span(r.start, r.end, TYPES[r.entity_type], text[r.start : r.end])
        for r in sorted(detected, key=lambda r: r.entity_type == "PERSON")
        if r.entity_type in TYPES
        # The model also reads "Marsh" alone as a person; it is never a client detail.
        if not (r.entity_type == "PERSON" and is_allowed(text[r.start : r.end]))
        if not is_never_masked(text[r.start : r.end])
    ]
    found += [
        _Span(start, end, SPACY_TYPES[r.entity_type], text[start:end])
        for r in detected
        if r.entity_type in SPACY_TYPES
        for start, end in _unlisted_parts(text, r.start, r.end)
    ]
    found = [span for span in found if _stands_as(span, text)]
    kept: list[_Span] = []
    for span in found:  # surest first, so it is kept over what it overlaps
        if not any(span.start < k.end and k.start < span.end for k in kept):
            kept.append(span)
    return sorted(kept, key=lambda s: s.start)


def _site_spans(text: str) -> list[_Span]:
    """Street addresses, then building names, that the model tends to miss (CP-23).

    Addresses go first: "Changi Business Park Central 2" ends in a building noun too, and the
    whole address is the surer read. Without the word checks, "Fire Pump House" would be masked.
    """
    spans = []
    for kind in ("ADDRESS", "ADDRESS_LOCAL", "SITE"):
        for m in SITE_PATTERNS[kind].finditer(text):
            start, end = m.start("v"), m.end("v")
            if kind == "SITE":
                # Reject a name made of safety words ("Fire Pump House") or allow-listed words.
                words = text[start:end].split()
                name = [w for w in words[:-1] if not w.isdigit()]
                if len(words) < 2 or any(
                    w.casefold() in NOT_NAME_WORDS or is_allowed(w) for w in name
                ):
                    continue
            if is_never_masked(text[start:end]):
                continue
            spans.append(
                _Span(start, end, "SITE" if kind == "SITE" else "ADDRESS", text[start:end])
            )
    return spans


# Words that alone are a company's form, not its name ("Ltd" on a line of its own).
COMPANY_FORMS = {"pte", "ltd", "limited", "inc", "sdn", "bhd", "berhad", "co", "corp", "plc"}
_JOINER = re.compile(r"\s+and\s+|\s*[,&]\s*")


def _unlisted_parts(text: str, start: int, end: int) -> list[tuple[int, int]]:
    """The parts of a detected organisation or facility worth masking, with tidy edges.

    The model's spans are loose: they run over line breaks into a form label ("Crest Tower
    Central\nAddress"), start with "the", or join names ("Marsh and FM Global"). Without this,
    a placeholder would restore to that loose text, and a listed name would be masked.
    """
    parts = []
    for line in re.finditer(r"[^\n]+", text[start:end]):
        a, b = start + line.start(), start + line.end()
        pieces = _pieces(text, a, b)
        # Split joined names only when one of them is listed; "Risk and Insurance" is one name.
        if not any(is_never_masked(text[x:y]) for x, y in pieces):
            pieces = [(a, b)]
        for x, y in pieces:
            x, y = _trimmed(text, x, y)
            name = text[x:y]
            label = name.endswith(":") or text[y : y + 1] == ":"
            only_form = all(w.strip(".").casefold() in COMPANY_FORMS for w in name.split())
            if name and not label and not only_form and not is_never_masked(name):
                parts.append((x, y))
    return parts


def _pieces(text: str, a: int, b: int) -> list[tuple[int, int]]:
    """`text[a:b]` cut at each "and", comma or ampersand."""
    cuts = [(a + m.start(), a + m.end()) for m in _JOINER.finditer(text[a:b])]
    starts = [a] + [e for _, e in cuts]
    ends = [s for s, _ in cuts] + [b]
    return list(zip(starts, ends))


def _trimmed(text: str, a: int, b: int) -> tuple[int, int]:
    """`text[a:b]` without surrounding spaces, or a leading "the" or greeting ("Hi Marsh")."""
    while a < b and text[a].isspace():
        a += 1
    while b > a and text[b - 1].isspace():
        b -= 1
    first = text[a:b].split(" ", 1)[0]
    if " " in text[a:b] and first.casefold() in {"the", "hi", "hello", "dear"}:
        return _trimmed(text, a + len(first) + 1, b)
    return a, b


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

"""A document's outline for the knowledge base browser (IN-17): each passage's chapter and section.

Standards are outlined by clause numbers, not heading levels. Docling's heading trails don't
nest reliably: in NFPA 25 every trail starts "25 NFPA ® › EDUFIRE › 3e" (page header, watermark,
edition mark; see .claude/plans/ingestion-data-fixes.md, D1). So only the nearest heading is read:

- "8.6 Component…", "Δ 12.4.1 General.", "N12.3.17 …", "4.1.5* …" and "A.8.6.1 …" are clauses:
  chapter "8" (or annex "A"), section "8.6" (or "A.8").
- "Chapter 8 …" and "Annex A …" start a chapter, before its first section ("").
- Any other heading ("Notes:", "Δ Table A.3.3.8 Continued") stays in the clause before it, in
  reading order. Passages before the first chapter are front matter (chapter "").

A document with no clause numbers at all (a past report) is outlined by its passages' template
`section` instead, with no second level.

A manually entered standard (IN-18) stores each passage's clause number apart (`clause`), and
the admin's heading trail may carry no numbers, so its clause is read instead of a heading. A
clause numbered only by its chapter ("8", "A") opens that chapter. Its titles come from every
heading in its trail, since the admin types the whole trail.

Each chapter and section is named only by its own heading ("Chapter 8 Installation", "2.0 LOSS
PREVENTION…", "8.6 Component replacement."), never by a sub-clause that happens to open it.
"""

import re

# A clause number at the start of a heading, after NFPA's change markers (Δ changed, N new) and
# before its "*" (explanatory note in Annex A). Two digits at most, so a year is not a chapter.
_CLAUSE = re.compile(r"^\s*(?:Δ\s*)?N?\s*(\d{1,2}|[A-Z])((?:\.\d+)+)\*?\.?(?:\s|$)")
_CHAPTER = re.compile(r"^\s*(?:Δ\s*)?(?:Chapter\s+(\d{1,2})|Annex\s+([A-Z]))\b", re.IGNORECASE)
# A manual clause that is only a chapter's number or an annex's letter (IN-18).
_CHAPTER_ONLY = re.compile(r"\s*(\d{1,2}|[A-Z])\.?\s*")


def _clause(heading: str) -> tuple[str, str] | None:
    """The chapter and section a heading opens, or None when it opens neither."""
    if found := _CLAUSE.match(heading):
        chapter = found.group(1)
        return chapter, f"{chapter}.{found.group(2).split('.')[1]}"
    if found := _CHAPTER.match(heading):
        return (found.group(1) or found.group(2)).upper(), ""
    return None


def clause_number(heading: str) -> str | None:
    """The whole clause number a heading starts with ("Δ 8.2.1* Hangers." is "8.2.1"), or None."""
    if found := _CLAUSE.match(heading):
        return found.group(1) + found.group(2)
    return None


def _opens(meta: dict) -> tuple[str, str] | None:
    """The chapter and section a passage opens: its manual clause (IN-18), else its last heading."""
    if number := meta.get("clause"):
        if found := _CHAPTER_ONLY.fullmatch(number):
            return found.group(1).upper(), ""
        return _clause(number)
    return _clause((meta.get("headings") or [""])[-1])


def places(metadatas: list[dict]) -> tuple[str, list[tuple[str, str]]]:
    """Return how the document is outlined ("clause" or "section") and each passage's place.

    `metadatas` are in reading order. A place is (chapter, section); "" is front matter as a
    chapter, or the part of a chapter before its first section.
    """
    opened = [_opens(meta) for meta in metadatas]
    if not any(opened):
        return "section", [(meta.get("section") or "", "") for meta in metadatas]
    found, current = [], ("", "")
    for place in opened:
        current = place or current
        found.append(current)
    return "clause", found


def _words(text: str) -> str:
    """A heading's words after its number: spaces collapsed, no leading "*" or closing "."."""
    return " ".join(text.split()).lstrip("*").strip().rstrip(".").strip()


def titles(metadatas: list[dict]) -> tuple[dict[str, str], dict[str, str]]:
    """Return the chapters' and the sections' titles, each from its own heading; first one wins.

    A chapter is named by "Chapter 8 …" / "Annex A …", or by the heading numbered "N.0" (which
    also names section N.0); a section only by the heading numbered exactly that section.
    """
    chapters: dict[str, str] = {}
    sections: dict[str, str] = {}
    headings = [
        heading
        for meta in metadatas
        # A manual passage's whole trail was typed by the admin (IN-18); a PDF's only nearest.
        for heading in (meta.get("headings") or [""])[None if meta.get("clause") else -1 :]
    ]
    for heading in headings:
        if found := _CHAPTER.match(heading):
            name = (found.group(1) or found.group(2)).upper()
            if title := _words(heading[found.end() :]):
                chapters.setdefault(name, title)
        elif found := _CLAUSE.match(heading):
            chapter, parts = found.group(1), found.group(2).split(".")[1:]
            title = _words(heading[found.end() :])
            if len(parts) != 1 or not title:
                continue
            sections.setdefault(f"{chapter}.{parts[0]}", title)
            if parts[0] == "0":
                chapters.setdefault(chapter, title)
    return chapters, sections


def counts(names: list[str], named: dict[str, str] | None = None) -> list[dict]:
    """Each distinct name with how often it occurs and its title (or None), in order of first
    appearance."""
    tally: dict[str, int] = {}
    for name in names:
        tally[name] = tally.get(name, 0) + 1
    return [
        {"name": name, "count": count, "title": (named or {}).get(name)}
        for name, count in tally.items()
    ]

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
"""

import re

# A clause number at the start of a heading, after NFPA's change markers (Δ changed, N new) and
# before its "*" (explanatory note in Annex A). Two digits at most, so a year is not a chapter.
_CLAUSE = re.compile(r"^\s*(?:Δ\s*)?N?\s*(\d{1,2}|[A-Z])((?:\.\d+)+)\*?\.?(?:\s|$)")
_CHAPTER = re.compile(r"^\s*(?:Δ\s*)?(?:Chapter\s+(\d{1,2})|Annex\s+([A-Z]))\b", re.IGNORECASE)


def _clause(heading: str) -> tuple[str, str] | None:
    """The chapter and section a heading opens, or None when it opens neither."""
    if found := _CLAUSE.match(heading):
        chapter = found.group(1)
        return chapter, f"{chapter}.{found.group(2).split('.')[1]}"
    if found := _CHAPTER.match(heading):
        return (found.group(1) or found.group(2)).upper(), ""
    return None


def places(metadatas: list[dict]) -> tuple[str, list[tuple[str, str]]]:
    """Return how the document is outlined ("clause" or "section") and each passage's place.

    `metadatas` are in reading order. A place is (chapter, section); "" is front matter as a
    chapter, or the part of a chapter before its first section.
    """
    nearest = [(meta.get("headings") or [""])[-1] for meta in metadatas]
    opened = [_clause(heading) for heading in nearest]
    if not any(opened):
        return "section", [(meta.get("section") or "", "") for meta in metadatas]
    found, current = [], ("", "")
    for place in opened:
        current = place or current
        found.append(current)
    return "clause", found


def counts(names: list[str]) -> list[dict]:
    """Each distinct name with how often it occurs, in order of first appearance."""
    tally: dict[str, int] = {}
    for name in names:
        tally[name] = tally.get(name, 0) + 1
    return [{"name": name, "count": count} for name, count in tally.items()]

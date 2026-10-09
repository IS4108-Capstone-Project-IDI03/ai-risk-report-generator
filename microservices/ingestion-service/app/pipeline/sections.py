"""Report section for one passage, from where it sits in a past report (IN-05).

Called by app/pipeline/__init__.py run(): report_sections() once per document,
section_label() once per passage. Calls pymupdf.
"""

import re
from difflib import SequenceMatcher

import pymupdf

# The Global PRE template's 12 section titles, in template order. 7-12 must match
# microservices/rag-service/app/generation/sections.json. Real reports number
# sections differently from the template, so only titles are matched.
TITLES = [
    "Purpose and Scope",
    "Executive Summary",
    "Opportunities for Improvement",
    "Risk Quality Ratings and Comments",
    "Loss Estimates",
    "Management Programs",
    "Construction",
    "Occupancy, Hazards, and Utilities",
    "Fire Protection",
    "External Exposures",
    "Security",
    "Business Interruption",
]
APPENDIX = "Appendix"
UNDEFINED = "Undefined"
NOT_APPLICABLE = "Not applicable"

# How alike a line and a title must be (difflib ratio, 0 = nothing shared,
# 1 = identical). On the 11 sample reports real titles score 0.84-1.00 and every
# other heading-size line 0.56 or less; two different titles score at most 0.55.
MATCH = 0.75


def _normalise(title: str) -> str:
    """Return the title lowercased, "&" as "and", with numbers and punctuation dropped."""
    letters = re.sub(r"[^a-z\s]", "", title.lower().replace("&", " and "))
    return " ".join(letters.split())


_NORMALISED = {_normalise(t): t for t in TITLES}


def _title(text: str) -> str | None:
    """Return the template title a normalised line matches, or None."""
    score, best = max((SequenceMatcher(None, text, t).ratio(), t) for t in _NORMALISED)
    return _NORMALISED[best] if score >= MATCH else None


def _heading_lines(file_path: str) -> list[tuple[int, float, str]]:
    """Return (page, font size, normalised text) for every line of text in the PDF."""
    lines = []
    with pymupdf.open(file_path) as doc:
        for page in doc:
            for block in page.get_text("dict")["blocks"]:
                for line in block.get("lines", []):
                    text = _normalise("".join(span["text"] for span in line["spans"]))
                    if text:
                        size = max(span["size"] for span in line["spans"])
                        lines.append((page.number + 1, size, text))
    return lines


def _titled(big: list[tuple[int, str]]) -> list[tuple[int, str | None]]:
    """Return (page, title or None) per heading-size line, joining a title split over two lines."""
    out, i = [], 0
    while i < len(big):
        page, text = big[i]
        title = _title(text)
        if title is None and i + 1 < len(big) and big[i + 1][0] == page:
            title = _title(f"{text} {big[i + 1][1]}")
            i += title is not None  # the second half is used up
        out.append((page, title))
        i += 1
    return out


def report_sections(file_path: str) -> list[tuple[int, str]]:
    """Return (start page, section) for each section of a past report, in page order.

    Docling's heading trails mis-nest a Marsh report's sections (~40% of passages
    under the wrong one), so sections are read from the PDF's fonts instead: a
    section heading is a line set in the size of the template's titles (28 pt in
    Marsh's template), larger than any subsection heading. Empty when no title is found.
    """
    # 1. The heading size is the largest size any line matching a title is set in.
    lines = _heading_lines(file_path)
    sizes = [size for _, size, text in lines if _title(text)]
    if not sizes:
        return []
    heading_size = max(sizes)
    big = [(page, text) for page, size, text in lines if abs(size - heading_size) < 0.5]

    # 2. Match each heading-size line to a title. Each section appears once, so only
    # a title's first line starts it; a repeat (e.g. "Fire Protection Drawings" in
    # the appendix) is treated like any other unmatched line.
    titled = _titled(big)
    firsts = {}
    for i, (_, title) in enumerate(titled):
        if title:
            firsts.setdefault(title, i)
    last = max(firsts.values())
    last_page = titled[last][0]

    # 3. Other lines are skipped up to the last section's page (a sentence in
    # heading-size font, or "Contents"); after that page, the first one starts the appendix.
    starts = [(titled[i][0], title) for title, i in firsts.items()]
    after = [page for page, _ in titled[last + 1 :] if page > last_page]
    if after:
        starts.append((after[0], APPENDIX))
    return sorted(starts, key=lambda start: start[0])


def section_label(
    source_type: str | None,
    page_start: int | None,
    page_end: int | None,
    sections: list[tuple[int, str]],
) -> str:
    """Return the report section a passage on pages `page_start`-`page_end` sits in.

    Two labels for passages without one section, kept apart so neither means two
    things (IN-05 Sprint 2 review):
    - "Not applicable": no section exists. A standard's passages, and a report's
      pages before its first section (cover, survey details, contents).
    - "Undefined": a section exists but the code can't tell which, so a person
      should look. A passage running into a page where a new section starts
      (Docling can date a new section's text to the page before), a report with
      no titles found, a passage with no page, or an Unconfirmed source type.
    """
    if source_type is not None and source_type != "marsh_report":
        return NOT_APPLICABLE
    if source_type is None or page_start is None or not sections:
        return UNDEFINED
    end = page_end or page_start
    if any(page_start < start <= end for start, _ in sections):
        return UNDEFINED
    started = [section for start, section in sections if start <= page_start]
    return started[-1] if started else NOT_APPLICABLE

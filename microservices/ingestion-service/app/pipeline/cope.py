"""COPE label for one passage from the report section it sits in (IN-05).

Called by app/pipeline/__init__.py run(): report_sections() once per document,
cope_label() once per passage. Calls pymupdf.
COPE = Construction, Occupancy, Protection, Exposure.
"""

import re

import pymupdf

# Section titles of a Marsh report and the COPE label each carries. Titles must
# match microservices/rag-service/app/generation/sections.json. Report section
# numbers differ from the template, so only titles are matched.
TITLE_TO_COPE = {
    "construction": "Construction",
    "occupancy hazards and utilities": "Occupancy",
    "fire protection": "Protection",
    "security": "Protection",
    "external exposures": "Exposure",
}


def _normalise(title: str) -> str:
    """Return the title lowercased, "&" as "and", with numbers and punctuation dropped."""
    letters = re.sub(r"[^a-z\s]", "", title.lower().replace("&", " and "))
    return " ".join(letters.split())


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


def report_sections(file_path: str) -> list[tuple[int, str]]:
    """Return (start page, COPE label) for each top-level section of a report, in page order.

    Docling's heading trails mis-nest a Marsh report's sections (the golden check
    found ~40% of passages under the wrong section), so the sections are read
    from the PDF's fonts instead: a section heading is a line set in the same
    size as the mapped section titles (28 pt in Marsh's template), which is
    larger than any subsection heading. Empty when no mapped title is found.
    """
    lines = _heading_lines(file_path)
    sizes = [size for _, size, text in lines if text in TITLE_TO_COPE]
    if not sizes:
        return []
    heading_size = max(sizes)
    return [
        (page, TITLE_TO_COPE.get(text, "all"))
        for page, size, text in lines
        if abs(size - heading_size) < 0.5
    ]


def cope_label(
    source_type: str | None,
    headings: list[str] | None,
    page: int | None = None,
    sections: list[tuple[int, str]] | None = None,
) -> str:
    """Return Construction, Occupancy, Protection, Exposure or "all" for a passage.

    Only a marsh_report is labelled. With the report's `sections` and the
    passage's start `page`, the passage takes the label of the last section
    starting on or before that page. Otherwise the outermost heading in its
    trail that names a mapped section wins. Anything else is "all".
    """
    if source_type != "marsh_report":
        return "all"
    if sections and page is not None:
        started = [label for start, label in sections if start <= page]
        return started[-1] if started else "all"
    for heading in headings or []:
        label = TITLE_TO_COPE.get(_normalise(heading))
        if label:
            return label
    return "all"

"""IN-19 (D1): a passage's heading trail holds the document's sections, nothing else.

NFPA trails began `25 NFPA ® › EDUFIRE › 3e`: a running header and a watermark Docling reads as
body headings on every page, then `Table … Continued` labels that cut the clause trail. Each test
builds a real `DoclingDocument` and runs the real `chunk()` over it.
"""

import pytest
from doc_builders import chunk_document, document, picture, prov
from docling_core.types.doc import DocItemLabel

from app.pipeline import chunker


def page_of(doc, page: int, *headings: str, text: str | None = None):
    """Headings at the top of `page`, then one line of text."""
    top = 390
    for heading in headings:
        doc.add_heading(heading, level=1, prov=prov(page, 10, top, 290, top - 10))
        top -= 15
    doc.add_text(
        DocItemLabel.TEXT, text or f"Text on page {page}.", prov=prov(page, 10, top, 290, top - 10)
    )


def trails(doc) -> list[list[str]]:
    return [p["metadata"].get("headings", []) for p in chunk_document(doc)]


def test_a_heading_repeated_on_many_pages_is_in_no_trail():
    doc = document(pages=5)
    page_of(doc, 1, "EDUFIRE", "Chapter 3 Definitions")
    for page in range(2, 6):
        page_of(doc, page, "EDUFIRE")

    # HybridChunker merges small neighbours under one heading, so the count isn't five.
    found = trails(doc)
    assert found and all(trail == ["Chapter 3 Definitions"] for trail in found)


def test_a_heading_on_two_pages_of_many_stays_a_heading():
    # A guard: "General" opens a section in two chapters; repetition alone isn't a header.
    doc = document(pages=10)
    page_of(doc, 1, "General")
    page_of(doc, 2, "Pumps")
    page_of(doc, 3, "General")

    assert trails(doc)[2] == ["General"]


def test_a_continued_table_heading_keeps_the_clause_trail_from_before_it():
    doc = document()
    doc.add_heading("3.3 General", level=1, prov=prov(1, 10, 390, 290, 380))
    doc.add_text(DocItemLabel.TEXT, "Valves are listed.", prov=prov(1, 10, 375, 290, 365))
    doc.add_heading("Table 3.3.1 Continued", level=1, prov=prov(1, 10, 360, 290, 350))
    doc.add_text(DocItemLabel.TEXT, "Gate valves are OS&Y.", prov=prov(1, 10, 345, 290, 335))

    assert trails(doc) == [["3.3 General"], ["3.3 General"]]


@pytest.mark.parametrize(
    "heading, cleaned",
    [
        ("Δ 3.3.1* Approved.", "3.3.1 Approved."),
        ("N 3.3.2 Area", "3.3.2 Area"),
        ("A.3.3.1*  Approved.", "A.3.3.1 Approved."),
        ("  Fire \n  pump ", "Fire pump"),
        ("Nozzles", "Nozzles"),
    ],
)
def test_heading_text_is_normalised(heading, cleaned):
    doc = document()
    page_of(doc, 1, heading)

    assert trails(doc) == [[cleaned]]


def test_the_picture_reader_is_told_the_cleaned_section(monkeypatch):
    calls: list[str] = []
    monkeypatch.setattr(
        chunker,
        "parse_picture",
        lambda context="", **kwargs: calls.append(context) or "Image description: a pump.",
    )
    doc = document(pages=4)
    page_of(doc, 1, "EDUFIRE", "Δ 3.3.1* Pump room")
    picture(doc, (50, 300, 250, 150))
    for page in range(2, 5):
        page_of(doc, page, "EDUFIRE")

    chunk_document(doc)

    assert calls == ["Section: 3.3.1 Pump room"]

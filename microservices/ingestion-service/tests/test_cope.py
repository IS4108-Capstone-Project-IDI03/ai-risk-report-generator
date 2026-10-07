"""IN-05: the COPE rule over synthetic heading trails (fast, runs in CI)."""

import pytest

from app.pipeline.cope import cope_label, report_sections


@pytest.mark.parametrize(
    "title, expected",
    [
        ("Construction", "Construction"),
        ("Occupancy, Hazards, and Utilities", "Occupancy"),
        ("Occupancy, Hazards & Utilities", "Occupancy"),
        ("Fire Protection", "Protection"),
        ("Security", "Protection"),
        ("External Exposures", "Exposure"),
        ("Business Interruption", "all"),
        ("Executive Summary", "all"),
    ],
)
def test_each_section_title_maps_to_its_cope_label(title, expected):
    assert cope_label("marsh_report", [title]) == expected


def test_section_numbers_and_case_are_ignored():
    assert cope_label("marsh_report", ["7. CONSTRUCTION"]) == "Construction"
    assert cope_label("marsh_report", ["3.2 Fire Protection"]) == "Protection"


def test_the_outermost_matching_heading_wins():
    assert cope_label("marsh_report", ["Fire Protection", "Security"]) == "Protection"
    assert cope_label("marsh_report", ["Fire Protection", "Construction"]) == "Protection"
    assert cope_label("marsh_report", ["Executive Summary", "Construction"]) == "Construction"
    assert cope_label("marsh_report", ["Fire Protection", "Sprinklers"]) == "Protection"


@pytest.mark.parametrize("source_type", ["fm_data_sheet", "nfpa", None, "unknown"])
def test_standards_and_unknown_source_types_are_all(source_type):
    assert cope_label(source_type, ["Construction"]) == "all"


@pytest.mark.parametrize("headings", [None, []])
def test_no_headings_is_all(headings):
    assert cope_label("marsh_report", headings) == "all"


# Docling mis-nests the report's section headings (e.g. everything after
# "Occupancy, Hazards, and Utilities" sits under it), so sections are found from
# the PDF's own fonts: a section heading is set in the same size as the mapped
# titles, at the top of its page.
def _report(tmp_path, pages):
    """Write a PDF whose pages each have (heading or None, heading size) and body text."""
    import pymupdf

    doc = pymupdf.open()
    for heading, size in pages:
        page = doc.new_page()
        if heading:
            page.insert_text((72, 100), heading, fontsize=size)
        page.insert_text((72, 160), "Body text of the section.", fontsize=11)
    path = tmp_path / "report.pdf"
    doc.save(path)
    return str(path)


def test_report_sections_are_found_from_the_section_heading_font(tmp_path):
    path = _report(
        tmp_path,
        [
            ("Property Risk Evaluation Report", 36),  # cover: bigger, not a section
            ("Executive Summary", 28),
            ("Construction", 28),
            ("Construction Narrative", 16),  # a subsection, smaller
            ("Fire Protection", 28),
            ("Security", 28),
            ("Business Interruption", 28),
        ],
    )
    assert report_sections(path) == [
        (2, "all"),
        (3, "Construction"),
        (5, "Protection"),
        (6, "Protection"),
        (7, "all"),
    ]


def test_a_passage_takes_the_section_its_start_page_falls_in(tmp_path):
    sections = [(2, "all"), (3, "Construction"), (5, "Protection"), (7, "all")]
    # The heading trail is ignored when sections are known: Docling's trail can be wrong.
    wrong_trail = ["Occupancy, Hazards, and Utilities"]
    assert cope_label("marsh_report", wrong_trail, page=4, sections=sections) == "Construction"
    assert cope_label("marsh_report", wrong_trail, page=5, sections=sections) == "Protection"
    assert cope_label("marsh_report", wrong_trail, page=9, sections=sections) == "all"
    assert cope_label("marsh_report", wrong_trail, page=1, sections=sections) == "all"


def test_without_sections_or_a_page_the_heading_trail_is_used():
    assert cope_label("marsh_report", ["Construction"], page=4, sections=[]) == "Construction"
    assert cope_label("marsh_report", ["Construction"], page=None, sections=[(1, "all")]) == (
        "Construction"
    )


def test_a_pdf_with_no_mapped_section_heading_has_no_sections(tmp_path):
    assert report_sections(_report(tmp_path, [("Chapter 1 Administration", 28)])) == []


def test_standards_ignore_sections():
    assert cope_label("fm_standard", None, page=4, sections=[(3, "Construction")]) == "all"

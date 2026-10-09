"""IN-05 (Sprint 3): the report-section rule on synthetic and sample PDFs (fast, runs in CI)."""

from pathlib import Path

import pytest

from app.pipeline.sections import report_sections, section_label

FILES = Path(__file__).parent / "test_files"


# A section heading is found from the PDF's own fonts: a line set in the same
# size as the template's section titles, at the top of its page.
def _report(tmp_path, pages):
    """Write a PDF whose pages each have heading lines [(text, size)] and body text."""
    import pymupdf

    doc = pymupdf.open()
    for headings in pages:
        page = doc.new_page()
        for n, (text, size) in enumerate(headings):
            page.insert_text((72, 100 + 40 * n), text, fontsize=size)
        page.insert_text((72, 400), "Body text of the section.", fontsize=11)
    path = tmp_path / "report.pdf"
    doc.save(path)
    return str(path)


def test_each_template_section_is_found_from_the_heading_font(tmp_path):
    path = _report(
        tmp_path,
        [
            [("Property Risk Evaluation Report", 36)],  # cover: bigger, not a section
            [("Contents", 28)],  # heading size, but not a section
            [("Purpose and Scope", 28)],
            [("Construction", 28)],
            [("Construction Narrative", 16)],  # a subsection, smaller
            [("Fire Protection", 28)],
            [("Business Interruption", 28)],
        ],
    )
    assert report_sections(path) == [
        (3, "Purpose and Scope"),
        (4, "Construction"),
        (6, "Fire Protection"),
        (7, "Business Interruption"),
    ]


def test_small_spelling_changes_still_match_a_title(tmp_path):
    path = _report(
        tmp_path,
        [
            [("Occupancy, Hazards & Utilities", 28)],
            [("7. FIRE PROTECTION", 28)],
            [("Security", 28)],
        ],
    )
    assert report_sections(path) == [
        (1, "Occupancy, Hazards, and Utilities"),
        (2, "Fire Protection"),
        (3, "Security"),
    ]


def test_a_heading_size_sentence_does_not_start_a_section(tmp_path):
    # Seen on page 7 of 6 of the 11 samples: body text set in heading-size font.
    path = _report(
        tmp_path,
        [
            [("Executive Summary", 28)],
            [("condenser water pipe stack", 28)],
            [("Opportunities for Improvement", 28)],
        ],
    )
    assert report_sections(path) == [(1, "Executive Summary"), (3, "Opportunities for Improvement")]


def test_a_title_split_over_two_lines_is_joined(tmp_path):
    path = _report(
        tmp_path,
        [[("Occupancy, Hazards", 28), ("and Utilities", 28)], [("Security", 28)]],
    )
    assert report_sections(path) == [(1, "Occupancy, Hazards, and Utilities"), (2, "Security")]


def test_the_first_unmatched_heading_after_the_last_section_starts_the_appendix(tmp_path):
    path = _report(
        tmp_path,
        [
            [("Security", 28)],
            [("Site Photos", 28)],
            [("Site Map", 28)],  # still the appendix
        ],
    )
    assert report_sections(path) == [(1, "Security"), (2, "Appendix")]


def test_a_title_seen_again_in_the_appendix_stays_in_the_appendix(tmp_path):
    # "Fire Protection Drawings" matches Fire Protection, which the report already had.
    path = _report(
        tmp_path,
        [
            [("Fire Protection", 28)],
            [("Security", 28)],
            [("Site Photos", 28)],
            [("Fire Protection Drawings", 28)],
        ],
    )
    assert report_sections(path) == [(1, "Fire Protection"), (2, "Security"), (3, "Appendix")]


def test_the_appendix_never_starts_on_the_last_sections_own_page(tmp_path):
    # A stray heading-size line on the last section's page is not an appendix.
    path = _report(tmp_path, [[("Security", 28), ("Site Perimeter", 28)], [("Site Photos", 28)]])
    assert report_sections(path) == [(1, "Security"), (2, "Appendix")]


def test_a_pdf_with_no_section_title_has_no_sections(tmp_path):
    assert report_sections(_report(tmp_path, [[("Chapter 1 Administration", 28)]])) == []


SECTIONS = [(3, "Purpose and Scope"), (4, "Construction"), (6, "Appendix")]


def test_a_report_passage_takes_the_section_its_pages_fall_in():
    assert section_label("marsh_report", 3, 3, SECTIONS) == "Purpose and Scope"
    assert section_label("marsh_report", 4, 5, SECTIONS) == "Construction"
    assert section_label("marsh_report", 9, None, SECTIONS) == "Appendix"


# "Not applicable": the passage has no section, and no one needs to look at it.
@pytest.mark.parametrize("source_type", ["fm_standard", "nfpa_standard"])
def test_a_standards_passages_are_not_applicable(source_type):
    assert section_label(source_type, 5, 5, SECTIONS) == "Not applicable"


def test_a_reports_front_matter_is_not_applicable():
    assert section_label("marsh_report", 1, 2, SECTIONS) == "Not applicable"


# "Undefined": the passage should have a section the code can't tell, so a person
# should look at it (IN-05 Sprint 2 review).
@pytest.mark.parametrize("start, end", [(5, 6), (2, 3)])
def test_a_passage_running_into_a_new_sections_page_is_undefined(start, end):
    # Seen live: a passage dated page 4 held only page 5's Security table.
    assert section_label("marsh_report", start, end, SECTIONS) == "Undefined"


def test_a_report_passage_with_no_page_is_undefined():
    assert section_label("marsh_report", None, None, SECTIONS) == "Undefined"


def test_a_report_with_no_section_titles_found_is_undefined():
    assert section_label("marsh_report", 5, 5, []) == "Undefined"


def test_an_unconfirmed_source_type_is_undefined():
    # It may be a report, so it must not be hidden as Not applicable.
    assert section_label(None, 5, 5, SECTIONS) == "Undefined"


# Start pages from each report's own Contents page (printed page + 4). Mixed Use
# 1's Contents leaves out Loss Estimates; the report has it on page 20.
@pytest.mark.parametrize(
    "name, expected",
    [
        (
            "Office Sample 5 - PRE 2026 - REDACTED.pdf",
            [(5, "Purpose and Scope"), (6, "Executive Summary"),
             (8, "Opportunities for Improvement"),
             (12, "Loss Estimates"), (18, "Risk Quality Ratings and Comments"),
             (20, "Management Programs"), (24, "Construction"),
             (26, "Occupancy, Hazards, and Utilities"), (31, "Fire Protection"),
             (36, "External Exposures"), (40, "Security"), (43, "Appendix")],
        ),
        (
            "Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf",
            [(5, "Purpose and Scope"), (6, "Executive Summary"),
             (8, "Opportunities for Improvement"),
             (18, "Risk Quality Ratings and Comments"), (20, "Loss Estimates"),
             (32, "Management Programs"), (36, "Construction"),
             (38, "Occupancy, Hazards, and Utilities"), (46, "Fire Protection"),
             (51, "External Exposures"), (55, "Security"), (57, "Business Interruption"),
             (58, "Appendix")],
        ),
        (
            "Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf",
            [(5, "Purpose and Scope"), (6, "Executive Summary"),
             (8, "Opportunities for Improvement"),
             (13, "Risk Quality Ratings and Comments"), (15, "Loss Estimates"),
             (21, "Management Programs"), (24, "Construction"),
             (25, "Occupancy, Hazards, and Utilities"), (29, "Fire Protection"),
             (33, "External Exposures"), (37, "Security"), (39, "Business Interruption"),
             (41, "Appendix")],
        ),
    ],
)  # fmt: skip
def test_sample_reports_match_their_contents_page(name, expected):
    assert report_sections(str(FILES / name)) == expected

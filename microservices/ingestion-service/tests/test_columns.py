"""Two-column pages are read column by column (CB-01, issue 02).

The nameplate page of NFPA 13-2022 (p.393) came back with the clause 29.4.3
intro, then clauses 29.2.5-29.2.6 from the other column, then the list that
belongs to 29.4.3. These tests build that page as a small DoclingDocument in the
order Docling returned it and check it is put right. No PDF or model is read.
"""

import logging

from docling_core.types.doc import (
    BoundingBox,
    CoordOrigin,
    DocItemLabel,
    DoclingDocument,
    ProvenanceItem,
    Size,
)

from app.pipeline import columns
from app.pipeline.columns import Block, clause_jumps, order_blocks, reorder_columns

PAGE_WIDTH = 600.0
LEFT = (50.0, 280.0)
RIGHT = (320.0, 550.0)
FULL = (50.0, 550.0)


def _page(*blocks: tuple[str, tuple[float, float], float]) -> DoclingDocument:
    """A one-page document with (text, (left, right), top) blocks in the order given."""
    doc = DoclingDocument(name="page")
    doc.add_page(page_no=1, size=Size(width=PAGE_WIDTH, height=800))
    for text, (left, right), top in blocks:
        doc.add_text(
            label=DocItemLabel.TEXT,
            text=text,
            prov=ProvenanceItem(
                page_no=1,
                bbox=BoundingBox(
                    l=left, t=top, r=right, b=top + 30, coord_origin=CoordOrigin.TOPLEFT
                ),
                charspan=(0, len(text)),
            ),
        )
    return doc


def _texts(doc: DoclingDocument) -> list[str]:
    return [ref.resolve(doc).text for ref in doc.body.children]


# The page as Docling returned it: the right column's 29.2.5-29.2.6 are read in
# the middle of the left column's 29.4.3 list.
NAMEPLATE_AS_READ = [
    ("29.4.3 The sign shall include the following information:", LEFT, 300),
    ("29.2.5.1 The backflow prevention assembly shall be forward flow tested.", RIGHT, 100),
    ("29.2.5.2 The minimum flow rate shall be the system demand.", RIGHT, 160),
    ("29.2.6 Exposure Systems. Operating tests shall be made.", RIGHT, 220),
    ("(1) Location of the design area or areas", LEFT, 340),
    ("(2) Size of the design area", LEFT, 380),
    ("(3) Discharge densities over the design area", LEFT, 420),
]


def test_a_two_column_page_is_read_left_column_then_right():
    doc = _page(
        ("right 1", RIGHT, 100),
        ("left 1", LEFT, 100),
        ("left 2", LEFT, 160),
        ("right 2", RIGHT, 160),
    )

    assert reorder_columns(doc) == 1

    assert _texts(doc) == ["left 1", "left 2", "right 1", "right 2"]


def test_the_nameplate_list_follows_its_intro_clause():
    doc = _page(*NAMEPLATE_AS_READ)

    reorder_columns(doc)

    texts = _texts(doc)
    intro = texts.index("29.4.3 The sign shall include the following information:")
    assert texts[intro + 1 :] == [
        "(1) Location of the design area or areas",
        "(2) Size of the design area",
        "(3) Discharge densities over the design area",
        "29.2.5.1 The backflow prevention assembly shall be forward flow tested.",
        "29.2.5.2 The minimum flow rate shall be the system demand.",
        "29.2.6 Exposure Systems. Operating tests shall be made.",
    ]


def test_a_full_width_heading_splits_the_page_into_bands():
    doc = _page(
        ("band 1 right", RIGHT, 100),
        ("band 1 left", LEFT, 100),
        ("Chapter heading", FULL, 300),
        ("band 2 right", RIGHT, 360),
        ("band 2 left", LEFT, 360),
        ("band 1 left more", LEFT, 160),
        ("band 1 right more", RIGHT, 160),
        ("band 2 left more", LEFT, 420),
        ("band 2 right more", RIGHT, 420),
    )

    reorder_columns(doc)

    assert _texts(doc) == [
        "band 1 left",
        "band 1 left more",
        "band 1 right",
        "band 1 right more",
        "Chapter heading",
        "band 2 left",
        "band 2 left more",
        "band 2 right",
        "band 2 right more",
    ]


def test_a_single_column_page_is_left_alone():
    doc = _page(("first", FULL, 100), ("second", FULL, 160), ("third", FULL, 220))

    assert reorder_columns(doc) == 0

    assert _texts(doc) == ["first", "second", "third"]


def test_a_page_with_one_block_either_side_is_not_called_two_column():
    # A side note beside a paragraph is not a column layout.
    doc = _page(("body", LEFT, 100), ("note", RIGHT, 100), ("more body", FULL, 200))

    assert reorder_columns(doc) == 0

    assert _texts(doc) == ["body", "note", "more body"]


def test_a_reordered_page_stays_reordered_on_a_second_pass():
    doc = _page(*NAMEPLATE_AS_READ)
    reorder_columns(doc)
    once = _texts(doc)

    assert reorder_columns(doc) == 0

    assert _texts(doc) == once


def test_bottom_left_coordinates_are_read_the_right_way_up():
    # Docling's usual origin: y grows upwards, so the higher block has the larger t.
    doc = DoclingDocument(name="page")
    doc.add_page(page_no=1, size=Size(width=PAGE_WIDTH, height=800))
    for text, (left, right), top in [
        ("right 1", RIGHT, 700),
        ("left 2", LEFT, 640),
        ("left 1", LEFT, 700),
        ("right 2", RIGHT, 640),
    ]:
        doc.add_text(
            label=DocItemLabel.TEXT,
            text=text,
            prov=ProvenanceItem(
                page_no=1,
                bbox=BoundingBox(
                    l=left, t=top, r=right, b=top - 30, coord_origin=CoordOrigin.BOTTOMLEFT
                ),
                charspan=(0, len(text)),
            ),
        )

    reorder_columns(doc)

    assert _texts(doc) == ["left 1", "left 2", "right 1", "right 2"]


def test_order_blocks_returns_keys_in_reading_order():
    blocks = [
        Block(0, 320, 100, 550, 130),
        Block(1, 50, 100, 280, 130),
        Block(2, 50, 160, 280, 190),
        Block(3, 320, 160, 550, 190),
    ]

    assert order_blocks(blocks, PAGE_WIDTH) == [1, 2, 0, 3]


# --- clause numbers as a cross-check --------------------------------------------


def test_clause_numbers_running_backwards_inside_a_chapter_are_flagged():
    blocks = [
        (393, "29.4.3 The sign shall include the following information:"),
        (393, "29.2.5.1 The backflow prevention assembly shall be forward flow tested."),
    ]

    assert clause_jumps(blocks) == [(393, "29.4.3", "29.2.5.1")]


def test_clause_numbers_in_order_are_not_flagged():
    blocks = [
        (392, "29.2.5.1 The backflow prevention assembly shall be tested."),
        (392, "29.2.6 Exposure Systems."),
        (393, "29.4.3 The sign shall include the following information:"),
        (393, "N 29.4.3.1 Sign text."),
        (394, "30.1.2 A new chapter starts."),
        (394, "Text without a number."),
    ]

    assert clause_jumps(blocks) == []


def test_log_clause_jumps_warns_for_a_page_still_out_of_order(caplog):
    doc = _page(
        ("29.4.3 The sign shall include the following information:", LEFT, 100),
        ("29.2.5.1 The backflow prevention assembly shall be tested.", LEFT, 160),
    )

    with caplog.at_level(logging.WARNING, logger=columns.log.name):
        assert columns.log_clause_jumps(doc) == 1

    assert "29.2.5.1 follows 29.4.3" in caplog.text

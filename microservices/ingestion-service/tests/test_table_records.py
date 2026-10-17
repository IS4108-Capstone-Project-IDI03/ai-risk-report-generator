"""Tables in the knowledge base keep their headings and title (CB-01, issue 01).

The four failing examples of "Answers inside tables can't be found" are pinned
here with the shape of the real tables (NFPA 13-2022 p.85 and p.180-181, FM 2.81
p.10), but no OCR call or PDF is involved: the reading a provider would return
is written out by hand and sent through `_table_text`, then the chunker.
"""

from types import SimpleNamespace

import pytest

from app.pipeline import chunker
from app.pipeline.chunking_helper.ocr_prompts import TableBlock, TableReading, _table_text
from app.pipeline.chunking_helper.table_text import (
    TableText,
    flatten_table,
    group_records,
    render_tables,
    split_tables,
)


def _read(*tables: TableBlock) -> str:
    """The text a provider's answer becomes, as `recognise` returns it."""
    return _table_text(TableReading(tables=list(tables)))


def _extract(monkeypatch, readings: dict[int, str], *pages: int, caption: str = ""):
    """Run `_extract_table_chunk` over table regions on `pages`, each read as `readings[page]`."""
    monkeypatch.setattr(chunker, "parse_table", lambda bbox, page, **kwargs: readings.get(page))
    provs = [
        SimpleNamespace(
            page_no=page,
            bbox=SimpleNamespace(l=10, t=300, r=200, b=100, coord_origin="BOTTOMLEFT"),
        )
        for page in pages
    ]
    item = SimpleNamespace(label=chunker.DocItemLabel.TABLE, prov=provs, self_ref=None)
    dl_chunk = SimpleNamespace(meta=SimpleNamespace(doc_items=[item]))
    return chunker._extract_table_chunk(
        chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk),
        doc_path="nfpa13.pdf",
        doc_id="nfpa13",
        chunk_id="nfpa13:table:5",
        meta=dl_chunk.meta,
        headings=["Chapter 20", "20.15 Water Supply"],
        caption=caption,
    )


# --- headings: stacked, and on both axes ----------------------------------------


def test_stacked_headings_become_a_path_per_column():
    rows = [
        ["Occupancy", "Inside Hose", "Inside Hose", "Total Combined", "Duration (minutes)"],
        ["Occupancy", "gpm", "L/min", "gpm", "Duration (minutes)"],
        ["Light hazard", "0, 50, or 100", "0, 189, or 379", "100", "30"],
    ]

    (record,) = flatten_table(rows, header_rows=2, header_cols=1)

    assert record == (
        "Light hazard | Inside Hose > gpm: 0, 50, or 100; Inside Hose > L/min: 0, 189, or 379; "
        "Total Combined > gpm: 100; Duration (minutes): 30"
    )


def test_a_blank_cell_under_a_spanning_heading_takes_that_heading():
    rows = [
        ["Hazard", "Density/Area", ""],
        ["Hazard", "gpm/ft2", "ft2"],
        ["Extra Group 2", "0.4", "2500"],
    ]

    (record,) = flatten_table(rows, header_rows=2, header_cols=1)

    assert record == "Extra Group 2 | Density/Area > gpm/ft2: 0.4; Density/Area > ft2: 2500"


def test_headings_on_both_axes_label_a_value_by_row_and_column():
    rows = [
        ["Construction Type", "Pipe schedule", "Hydraulically calculated"],
        ["Noncombustible unobstructed", "200", "225"],
        ["Obstructed combustible", "130", "130"],
    ]

    records = flatten_table(rows, header_rows=1, header_cols=1)

    assert records == [
        "Noncombustible unobstructed | Pipe schedule: 200; Hydraulically calculated: 225",
        "Obstructed combustible | Pipe schedule: 130; Hydraulically calculated: 130",
    ]


def test_a_table_without_row_headings_labels_values_by_column_only():
    assert flatten_table([["Agent", "Qty"], ["FM-200", "2"]], 1, 0) == ["Agent: FM-200; Qty: 2"]


def test_heading_rows_are_never_stored_as_data():
    # Example 1: the hose stream table's heading row used to come out as
    # "Occupancy: Occupancy; ... Duration (minutes): Duration (minutes)".
    rows = [
        ["Occupancy", "Duration (minutes)"],
        ["Light hazard", "30"],
        ["Extra hazard", "90 or 120"],
    ]

    records = flatten_table(rows, header_rows=1, header_cols=1)

    assert records == [
        "Light hazard | Duration (minutes): 30",
        "Extra hazard | Duration (minutes): 90 or 120",
    ]
    assert not any("Occupancy: Occupancy" in record for record in records)


def test_a_header_repeated_at_the_top_of_a_continuation_page_is_not_data():
    page_two = [["Occupancy", "Duration (minutes)"], ["Extra hazard", "90 or 120"]]

    assert flatten_table(page_two, header_rows=1, header_cols=1) == [
        "Extra hazard | Duration (minutes): 90 or 120"
    ]


def test_numbers_and_units_are_kept_character_for_character():
    rows = [["Hazard", "Density/Area"], ["Light", "0.1/1500 or 0.07/3000*"]]

    assert flatten_table(rows, 1, 1) == ["Light | Density/Area: 0.1/1500 or 0.07/3000*"]


# --- one passage per table, each with its title ---------------------------------


def test_two_tables_in_one_crop_become_two_passages_each_with_its_own_title(monkeypatch):
    # Example 1: density/area and hose stream tables stored as one block, with
    # only the first title.
    reading = _read(
        TableBlock(
            title="N Table 19.2.3.1.1 Density/Area",
            header_rows=1,
            header_cols=1,
            rows=[["Hazard", "Density/Area"], ["Extra Group 2", "0.4/2500 or 0.38/3000*"]],
        ),
        TableBlock(
            title="Table 20.15.2.6 Hose Stream Allowance and Water Supply Duration",
            header_rows=1,
            header_cols=1,
            rows=[
                ["Occupancy", "Total Combined Inside and Outside Hose (gpm)", "Duration (minutes)"],
                ["Extra hazard", "500", "90 or 120"],
            ],
        ),
    )

    first, second = _extract(monkeypatch, {180: reading}, 180)

    assert first["text"].startswith("N Table 19.2.3.1.1 Density/Area\n")
    assert "Extra Group 2" in first["text"] and "Hose Stream" not in first["text"]
    assert second["text"].startswith(
        "Table 20.15.2.6 Hose Stream Allowance and Water Supply Duration\n"
    )
    assert "hose stream allowance" in second["text"].lower()
    assert "Extra hazard | Total Combined Inside and Outside Hose (gpm): 500" in second["text"]
    assert "Occupancy: Occupancy" not in second["text"]
    assert first["metadata"]["table_id"] != second["metadata"]["table_id"]
    assert second["metadata"]["table_title"].startswith("Table 20.15.2.6")


def test_the_docling_caption_titles_a_table_the_crop_does_not_show(monkeypatch):
    # Example 3: the title ("light hazard", "standard spray sprinklers") is printed
    # above the table, outside the crop, so only Docling's caption has it.
    reading = _read(
        TableBlock(
            title="",
            header_rows=1,
            header_cols=1,
            rows=[
                ["Construction Type", "Maximum Protection Area (ft2)"],
                ["Noncombustible unobstructed", "225"],
            ],
        )
    )

    (passage,) = _extract(
        monkeypatch,
        {180: reading},
        180,
        caption="Table 10.2.4.2.1(a) Protection Areas and Maximum Spacing of Standard Spray "
        "Sprinklers, Light Hazard",
    )

    assert passage["text"].startswith("Table 10.2.4.2.1(a) Protection Areas")
    assert "light hazard" in passage["text"].lower()
    assert passage["metadata"]["table_title"].endswith("Light Hazard")


def test_a_table_without_any_title_is_still_stored(monkeypatch):
    reading = _read(
        TableBlock(title="", header_rows=1, header_cols=0, rows=[["Agent", "Qty"], ["FM-200", "2"]])
    )

    (passage,) = _extract(monkeypatch, {180: reading}, 180)

    assert passage["text"] == "Agent: FM-200; Qty: 2"
    assert "table_title" not in passage["metadata"]


def test_the_pages_of_a_long_table_stay_one_table_under_its_title(monkeypatch):
    first_page = _read(
        TableBlock(
            title="Table 7 Frequencies",
            header_rows=1,
            header_cols=1,
            rows=[["ID", "Frequency"], ["10", "Annually"]],
        )
    )
    second_page = _read(
        TableBlock(
            title="",
            header_rows=1,
            header_cols=1,
            rows=[["ID", "Frequency"], ["11", "Quarterly"]],
        )
    )

    (passage,) = _extract(monkeypatch, {180: first_page, 181: second_page}, 180, 181)

    assert (
        passage["text"]
        == "Table 7 Frequencies\n10 | Frequency: Annually\n11 | Frequency: Quarterly"
    )
    assert passage["metadata"]["page_start"] == 180
    assert passage["metadata"]["page_end"] == 181


# --- long tables are cut between rows -------------------------------------------


def _frequency_table() -> TableBlock:
    long_detail = "Verify the system valve trip point and the air pressure at trip. " * 6
    rows = [["ID", "Recommendation", "Frequency", "Details"]]
    for number, recommendation, frequency in [
        (10, "Determine the air leakage rate of the system", "Annually"),
        (11, "Test supervisory alarms for low air pressure", "Annually"),
        (12, "Inspect and clean system valve internals", "Annually"),
        (13, "Partial-flow trip test system valves.", "Annually"),
        (14, "Full-flow trip test, videoscope or ultrasonic analysis", "Every 3 years"),
        (15, "Inspect for debris at the riser", "Annually"),
        (16, "Test the quick-opening device", "Annually"),
    ]:
        rows.append([str(number), recommendation, frequency, long_detail])
    return TableBlock(
        title="Table 1 Dry system recommendations", header_rows=1, header_cols=1, rows=rows
    )


def test_a_long_table_is_cut_between_rows_into_groups_that_each_repeat_the_title(monkeypatch):
    # Example 4: the one row that answers was about 5% of a 3,600-character passage.
    passages = _extract(monkeypatch, {180: _read(_frequency_table())}, 180)

    assert len(passages) > 1
    assert all(p["text"].startswith("Table 1 Dry system recommendations\n") for p in passages)
    assert len({p["metadata"]["table_id"] for p in passages}) == 1
    assert len({p["id"] for p in passages}) == len(passages)
    (answer,) = [p for p in passages if "Partial-flow trip test" in p["text"]]
    assert answer["text"].count("Recommendation:") <= 3
    assert "Frequency: Annually" in answer["text"]


def test_a_short_table_stays_one_passage_with_the_plain_chunk_id(monkeypatch):
    reading = _read(
        TableBlock(title="Table 2", header_rows=1, header_cols=0, rows=[["A", "B"], ["1", "2"]])
    )

    (passage,) = _extract(monkeypatch, {180: reading}, 180)

    assert passage["id"] == "nfpa13:table:5"
    assert passage["metadata"]["table_id"] == "nfpa13:table:5"


def test_group_records_never_cuts_a_record_and_keeps_order():
    records = ["a" * 40, "b" * 40, "c" * 40, "d" * 40]

    groups = group_records(records, limit=90)

    assert groups == [records[:2], records[2:]]
    assert group_records(["x" * 500], limit=90) == [["x" * 500]]
    assert group_records([]) == []


# --- text round trip ------------------------------------------------------------


def test_render_and_split_round_trip_titles_and_records():
    tables = [TableText("Table 1", ["a: 1", "a: 2"]), TableText("", ["b: 3"])]

    text = render_tables(tables)

    assert text == "### Table 1\na: 1\na: 2\n\nb: 3"
    # An untitled block after a titled one is that table's next page.
    assert split_tables(text) == [TableText("Table 1", ["a: 1", "a: 2", "b: 3"])]


@pytest.mark.parametrize("text", ["", "\n\n", "   "])
def test_split_tables_ignores_blank_readings(text):
    assert split_tables(text) == []

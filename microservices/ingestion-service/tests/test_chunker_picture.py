"""Pictures become passages in the chunker (IN-13).

Each test builds a real `DoclingDocument` with docling-core's public API
(headings, text, captions, pictures with provenance) and runs the real
`chunk()` over it. Only the picture reader, `chunker.parse_picture`, is faked:
it records what it was asked and returns a canned description.
"""

import pytest
from doc_builders import chunk_document as _chunk
from doc_builders import document as _document
from doc_builders import picture as _picture
from doc_builders import prov as _prov
from doc_builders import table as _table
from docling_core.types.doc import DocItemLabel

from app.pipeline import chunker

PUMP_ROOM = "Image description (generated, photograph): A pump room with two pumps."


@pytest.fixture
def reader(monkeypatch):
    """Fake picture reader: records each call and answers with a canned description."""
    calls: list[dict] = []

    def _parse_picture(bbox, page, file_path, coord_origin="", context=""):
        calls.append({"bbox": list(bbox), "page": page, "context": context})
        return PUMP_ROOM

    monkeypatch.setattr(chunker, "parse_picture", _parse_picture)
    return calls


def test_a_captioned_picture_becomes_a_passage_with_its_place_in_the_document(reader):
    doc = _document()
    doc.add_heading("Fire Protection", level=1, prov=_prov(1, 10, 390, 200, 380))
    _picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")

    [passage] = _chunk(doc)

    assert passage["id"] == "report:picture:0"
    assert passage["text"] == f"Figure 3 Pump room\n{PUMP_ROOM}"
    meta = passage["metadata"]
    assert meta["headings"] == ["Fire Protection"]
    assert (meta["page_start"], meta["page_end"]) == (1, 1)
    assert meta["bbox"] == [50.0, 350.0, 250.0, 200.0]
    assert meta["bbox_pages"] == [1]
    assert meta["position"] == 0


def test_the_reader_is_told_the_section_and_caption_of_the_picture(reader):
    doc = _document()
    doc.add_heading("Fire Protection", level=1, prov=_prov(1, 10, 390, 200, 380))
    doc.add_heading("Pump Room", level=2, prov=_prov(1, 10, 375, 200, 365))
    _picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")

    _chunk(doc)

    [call] = reader
    assert call["context"] == "Section: Fire Protection > Pump Room\nCaption: Figure 3 Pump room"


def test_two_pictures_in_a_section_keep_their_reading_order(reader):
    doc = _document()
    doc.add_heading("Appendix A Site photos", level=1, prov=_prov(1, 10, 390, 200, 380))
    _picture(doc, (50, 370, 250, 220), caption="Photo 1 Riser")
    _picture(doc, (50, 200, 250, 90), caption="Photo 2 Pump")

    passages = _chunk(doc)

    assert [p["id"] for p in passages] == ["report:picture:0:g0", "report:picture:0:g1"]
    assert [p["text"].splitlines()[0] for p in passages] == ["Photo 1 Riser", "Photo 2 Pump"]
    assert [p["metadata"]["bbox"] for p in passages] == [
        [50.0, 370.0, 250.0, 220.0],
        [50.0, 200.0, 250.0, 90.0],
    ]
    assert [p["metadata"]["position"] for p in passages] == [0, 0]


def test_the_prose_around_a_picture_stays_with_it_and_the_caption_appears_once(reader):
    doc = _document()
    doc.add_heading("Fire Protection", level=1, prov=_prov(1, 10, 390, 200, 380))
    doc.add_text(
        DocItemLabel.TEXT, "The pump room was inspected.", prov=_prov(1, 10, 375, 200, 365)
    )
    _picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")
    doc.add_text(DocItemLabel.TEXT, "Valves were locked open.", prov=_prov(1, 10, 170, 200, 160))

    [passage] = _chunk(doc)

    assert passage["text"] == (
        "The pump room was inspected.\n\n"
        f"Figure 3 Pump room\n{PUMP_ROOM}\n\n"
        "Valves were locked open."
    )


def test_a_described_picture_is_marked_as_generated_with_who_wrote_it(reader, monkeypatch):
    monkeypatch.setenv("OCR_PROVIDER", "anthropic")
    monkeypatch.delenv("OCR_MODEL", raising=False)
    doc = _document()
    _picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")

    [passage] = _chunk(doc)

    meta = passage["metadata"]
    assert meta["generated_text"] == "picture_description"
    assert meta["generated_by"] == "anthropic:claude-haiku-5-5"
    assert meta["prompt_version"] == "pic-v1"


def test_a_picture_left_unread_keeps_its_caption_and_prose_unmarked(monkeypatch):
    # GLM, a logo-sized picture, or a provider that gave up.
    monkeypatch.setattr(chunker, "parse_picture", lambda **kwargs: None)
    doc = _document()
    doc.add_text(
        DocItemLabel.TEXT, "The pump room was inspected.", prov=_prov(1, 10, 375, 200, 365)
    )
    _picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")

    [passage] = _chunk(doc)

    assert passage["text"] == "The pump room was inspected.\n\nFigure 3 Pump room"
    assert "generated_text" not in passage["metadata"]
    assert chunker.PICTURE_PLACEHOLDER not in passage["text"]


def test_text_beside_a_logo_sized_picture_stays_an_ordinary_passage(reader):
    # Office Sample 5 p15, FM-200 p11: a small icon must not turn the text into a
    # picture passage whose bbox points at the icon.
    doc = _document()
    doc.add_text(DocItemLabel.TEXT, "Clean-up takes a month.", prov=_prov(1, 10, 375, 200, 365))
    _picture(doc, (210, 375, 255, 364))  # 45 x 11 pt

    [passage] = _chunk(doc)

    assert passage["id"] == "report:0"
    assert passage["text"] == "Clean-up takes a month."
    assert passage["metadata"]["bbox"] == [10.0, 375.0, 200.0, 365.0]
    assert reader == []


def test_an_unread_picture_with_no_caption_or_prose_leaves_no_passage(monkeypatch):
    # A cover page of logo-sized pictures, each skipped unread (FM-200 page 1).
    monkeypatch.setattr(chunker, "parse_picture", lambda **kwargs: None)
    doc = _document()
    _picture(doc, (10, 390, 136, 331))
    _picture(doc, (150, 390, 276, 331))

    assert _chunk(doc) == []


def test_a_picture_docling_repeats_is_read_once(reader):
    doc = _document()
    doc.add_heading("Fire Protection", level=1, prov=_prov(1, 10, 390, 200, 380))
    _picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")
    doc.add_heading("Housekeeping", level=1, prov=_prov(1, 10, 190, 200, 180))
    doc.add_text(DocItemLabel.TEXT, "Aisles were clear.", prov=_prov(1, 10, 175, 200, 165))
    _picture(doc, (50.5, 350.5, 250, 200))  # the same picture again, a hair off

    passages = _chunk(doc)

    assert len(reader) == 1
    assert [p["text"] for p in passages] == [
        f"Figure 3 Pump room\n{PUMP_ROOM}",
        "Aisles were clear.",
    ]


def test_a_picture_beside_a_table_is_kept_as_its_own_passage(reader, monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: "Agent: FM-200; Qty: 2")
    doc = _document()
    doc.add_heading("Fire Protection", level=1, prov=_prov(1, 10, 390, 200, 380))
    _table(doc, (10, 370, 290, 300))
    _picture(doc, (50, 280, 250, 130), caption="Figure 3 Pump room")

    passages = _chunk(doc)

    assert [p["id"] for p in passages] == ["report:table:0", "report:picture:0"]
    assert passages[0]["text"] == "Agent: FM-200; Qty: 2"
    assert passages[1]["text"] == f"Figure 3 Pump room\n{PUMP_ROOM}"
    assert len(reader) == 1


# --- a table crop that reads as no table is read as a picture -----------------


def test_a_table_that_reads_as_no_table_is_described_as_a_picture(reader, monkeypatch):
    # Docling sometimes labels a photo or a drawing as a table.
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: None)
    doc = _document()
    doc.add_heading("Site Plan", level=1, prov=_prov(1, 10, 390, 200, 380))
    _table(doc, (10, 370, 290, 200))

    [passage] = _chunk(doc)

    assert passage["id"] == "report:picture:0"
    assert passage["text"] == PUMP_ROOM
    meta = passage["metadata"]
    assert meta["bbox"] == [10.0, 370.0, 290.0, 200.0]
    assert meta["bbox_pages"] == [1]
    assert meta["generated_text"] == "picture_description"
    assert reader[0]["context"] == "Section: Site Plan"


def test_a_table_that_reads_is_never_read_as_a_picture(reader, monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: "Agent: FM-200; Qty: 2")
    doc = _document()
    _table(doc, (10, 370, 290, 200))

    [passage] = _chunk(doc)

    assert passage["text"] == "Agent: FM-200; Qty: 2"
    assert reader == []


def test_of_two_tables_the_one_that_reads_as_no_table_follows_as_a_picture(reader, monkeypatch):
    def parse_table(**kwargs):
        return "Agent: FM-200; Qty: 2" if kwargs["bbox"][1] == 370.0 else None

    monkeypatch.setattr(chunker, "parse_table", parse_table)
    doc = _document()
    doc.add_heading("Fire Protection", level=1, prov=_prov(1, 10, 390, 200, 380))
    _table(doc, (10, 370, 290, 300))
    _table(doc, (10, 280, 290, 100))

    passages = _chunk(doc)

    assert [p["text"] for p in passages] == ["Agent: FM-200; Qty: 2", PUMP_ROOM]
    assert passages[1]["metadata"]["bbox"] == [10.0, 280.0, 290.0, 100.0]
    assert passages[1]["metadata"]["generated_text"] == "picture_description"


def test_a_table_unreadable_on_one_of_its_pages_is_not_read_as_a_picture(reader, monkeypatch):
    # It read on page 1, so it is a real table; page 2's crop just failed.
    monkeypatch.setattr(
        chunker,
        "parse_table",
        lambda **kwargs: "Agent: FM-200; Qty: 2" if kwargs["page"] == 1 else None,
    )
    doc = _document(pages=2)
    table = _table(doc, (10, 370, 290, 200))
    table.prov.append(_prov(2, 10, 390, 290, 300))

    [passage] = _chunk(doc)

    assert passage["text"] == "Agent: FM-200; Qty: 2"
    assert reader == []

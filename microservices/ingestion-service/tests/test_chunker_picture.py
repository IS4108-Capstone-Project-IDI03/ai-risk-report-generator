"""Pictures become passages in the chunker (IN-13).

Each test builds a real `DoclingDocument` with docling-core's public API
(headings, text, captions, pictures with provenance) and runs the real
`chunk()` over it. Only the picture reader, `chunker.parse_picture`, is faked:
it records what it was asked and returns a canned description.
"""

import pytest
from docling_core.types.doc import (
    BoundingBox,
    CoordOrigin,
    DocItemLabel,
    DoclingDocument,
    ProvenanceItem,
    Size,
    TableCell,
    TableData,
)

from app.pipeline import chunker
from app.pipeline.parser import ParsedDocument

DOC_PATH = "unused.pdf"  # the reader is faked, so no PDF is opened
PUMP_ROOM = "Image description (generated, photograph): A pump room with two pumps."


def _prov(page, left, top, right, bottom):
    bbox = BoundingBox(l=left, t=top, r=right, b=bottom, coord_origin=CoordOrigin.BOTTOMLEFT)
    return ProvenanceItem(page_no=page, bbox=bbox, charspan=(0, 0))


def _document(pages=1):
    doc = DoclingDocument(name="report")
    for page in range(1, pages + 1):
        doc.add_page(page_no=page, size=Size(width=300, height=400))
    return doc


def _picture(doc, box, caption=None, page=1):
    caption_item = None
    if caption:
        caption_item = doc.add_text(
            DocItemLabel.CAPTION, caption, prov=_prov(page, box[0], box[3] - 2, box[2], box[3] - 12)
        )
    return doc.add_picture(caption=caption_item, prov=_prov(page, *box))


@pytest.fixture
def reader(monkeypatch):
    """Fake picture reader: records each call, answers from `reader.answers` by caption."""
    calls: list[dict] = []

    def _parse_picture(bbox, page, file_path, coord_origin="", context=""):
        calls.append({"bbox": list(bbox), "page": page, "context": context})
        return PUMP_ROOM

    monkeypatch.setattr(chunker, "parse_picture", _parse_picture)
    return calls


def _chunk(doc):
    parsed = ParsedDocument(doc_name="report", docling_document=doc, page_count=len(doc.pages))
    return chunker.chunk(parsed, doc_path=DOC_PATH, doc_id="report")


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


def _table(doc, box, page=1):
    data = TableData(
        num_rows=2,
        num_cols=2,
        table_cells=[
            TableCell(
                text=text,
                start_row_offset_idx=row,
                end_row_offset_idx=row + 1,
                start_col_offset_idx=col,
                end_col_offset_idx=col + 1,
                column_header=row == 0,
            )
            for row, col, text in [(0, 0, "Agent"), (0, 1, "Qty"), (1, 0, "FM-200"), (1, 1, "2")]
        ],
    )
    return doc.add_table(data=data, prov=_prov(page, *box))


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

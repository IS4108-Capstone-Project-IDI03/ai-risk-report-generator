"""IN-19 (D2): a table, formula or picture passage records the region it was read from.

`region_kind`, `region_bbox` (flat l, t, r, b from the page's bottom-left) and `region_pages`
hold only the boxes of the item the passage was read from, so a citation can show that part of
the page (KB-02). `bbox`/`bbox_pages` stay the whole passage's. A plain text passage has none.
Real `DoclingDocument`s where Docling's chunking matters; duck-typed chunks for what one
HybridChunker chunk can't easily be made to hold (two tables).
"""

from types import SimpleNamespace

import pytest
from doc_builders import chunk_document, document, picture, prov, table
from docling_core.types.doc import BoundingBox, CoordOrigin, DocItemLabel, ProvenanceItem

from app.pipeline import chunker
from app.pipeline.chunking_helper.table_text import TITLE_MARK
from app.pipeline.parser import ParsedDocument

REGION_KEYS = {"region_kind", "region_bbox", "region_pages"}


def region(passage: dict) -> tuple:
    meta = passage["metadata"]
    return meta.get("region_kind"), meta.get("region_bbox"), meta.get("region_pages")


@pytest.fixture
def tables_read(monkeypatch):
    """parse_table answers each page with `answers[page]`, or one untitled row."""
    answers: dict[int, str] = {}
    monkeypatch.setattr(
        chunker,
        "parse_table",
        lambda bbox, page, **kwargs: answers.get(page, f"Agent: FM-200; Page: {page}"),
    )
    return answers


# --- tables


def test_a_table_beside_prose_records_only_the_tables_boxes(tables_read):
    doc = document()
    doc.add_text(DocItemLabel.TEXT, "Agent quantities are below.", prov=prov(1, 10, 390, 290, 380))
    table(doc, (10, 370, 290, 300))

    [passage] = chunk_document(doc)

    assert region(passage) == ("table", [10.0, 370.0, 290.0, 300.0], [1])
    # The passage's own box still takes in the prose.
    assert passage["metadata"]["bbox"] == [10.0, 390.0, 290.0, 380.0, 10.0, 370.0, 290.0, 300.0]


def _fake_prov(page, left, top, right, bottom):
    bbox = SimpleNamespace(l=left, t=top, r=right, b=bottom, coord_origin="BOTTOMLEFT")
    return SimpleNamespace(page_no=page, bbox=bbox)


def _table_chunk(*items):
    meta = SimpleNamespace(
        doc_items=[SimpleNamespace(label=DocItemLabel.TABLE, prov=list(p)) for p in items]
    )
    return chunker._extract_table_chunk(
        chunker._detect_bboxes(None, SimpleNamespace(meta=meta)),
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:3",
        meta=meta,
    )


def test_two_tables_in_one_chunk_each_record_their_own_boxes(tables_read):
    # The second table has no title. Joined as one text, it read as the first table's next page.
    passages = _table_chunk([_fake_prov(4, 10, 700, 290, 600)], [_fake_prov(4, 10, 500, 290, 400)])

    assert [p["id"] for p in passages] == ["fm200:table:3:t0", "fm200:table:3:t1"]
    assert [region(p) for p in passages] == [
        ("table", [10.0, 700.0, 290.0, 600.0], [4]),
        ("table", [10.0, 500.0, 290.0, 400.0], [4]),
    ]


def test_a_table_over_two_pages_records_a_box_on_each_in_order(tables_read):
    [passage] = _table_chunk([_fake_prov(4, 10, 300, 290, 100), _fake_prov(5, 10, 700, 290, 400)])

    assert region(passage) == (
        "table",
        [10.0, 300.0, 290.0, 100.0, 10.0, 700.0, 290.0, 400.0],
        [4, 5],
    )


def test_each_row_group_of_a_long_table_records_the_whole_tables_region(tables_read):
    rows = [f"Agent: FM-200; Room: {n:03}; Note: {'x' * 60}" for n in range(60)]
    tables_read[4] = "\n".join([f"{TITLE_MARK}Table 4 Agent quantities", *rows])

    passages = _table_chunk([_fake_prov(4, 10, 300, 290, 100)])

    assert len(passages) > 1
    assert {
        tuple(map(tuple, (p["metadata"]["region_bbox"], p["metadata"]["region_pages"])))
        for p in passages
    } == {((10.0, 300.0, 290.0, 100.0), (4,))}


def test_a_box_measured_from_the_top_of_the_page_is_recorded_from_the_bottom(tables_read):
    doc = document()  # pages 400 points tall
    top_left = BoundingBox(l=10, t=30, r=290, b=100, coord_origin=CoordOrigin.TOPLEFT)
    doc.add_table(
        data=_table_data(), prov=ProvenanceItem(page_no=1, bbox=top_left, charspan=(0, 0))
    )

    [passage] = chunk_document(doc)

    assert region(passage) == ("table", [10.0, 370.0, 290.0, 300.0], [1])


def _table_data():
    """The 2 x 2 table `doc_builders.table` builds."""
    doc = document()
    return table(doc, (0, 1, 1, 0)).data


# --- formulas


def _formula_chunk(monkeypatch, *items):
    """Chunk one duck-typed chunk holding `items`, with formula OCR answering a fraction."""
    dl_chunk = SimpleNamespace(
        text="<!-- formula-not-decoded -->",
        meta=SimpleNamespace(doc_items=list(items), headings=[]),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    monkeypatch.setattr(
        chunker, "_chunker", lambda: SimpleNamespace(chunk=lambda dl_doc: [dl_chunk])
    )
    monkeypatch.setattr(chunker, "_extract_formula_chunk", lambda boxes, path: r"\frac{x}{y}")
    monkeypatch.setattr(chunker, "close_document", lambda: None)
    [passage] = chunker.chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )
    return passage


def _labelled(label, *provs):
    return SimpleNamespace(label=label, prov=list(provs))


def test_a_formula_passage_records_the_equations_own_boxes(monkeypatch):
    passage = _formula_chunk(
        monkeypatch,
        _labelled(DocItemLabel.TEXT, _fake_prov(5, 40, 420, 300, 400)),
        _labelled(DocItemLabel.FORMULA, _fake_prov(5, 60, 380, 160, 340)),
    )

    assert region(passage) == ("formula", [60.0, 380.0, 160.0, 340.0], [5])
    assert passage["metadata"]["bbox"] == [40.0, 420.0, 300.0, 340.0]  # the whole chunk


def test_a_formula_passage_with_no_single_equation_item_records_the_chunks_boxes(monkeypatch):
    passage = _formula_chunk(
        monkeypatch,
        _labelled(DocItemLabel.FORMULA, _fake_prov(5, 60, 380, 160, 340)),
        _labelled(DocItemLabel.FORMULA, _fake_prov(5, 60, 330, 160, 300)),
    )

    assert region(passage) == ("formula", [60.0, 380.0, 160.0, 300.0], [5])


# --- pictures


@pytest.fixture
def described(monkeypatch):
    monkeypatch.setattr(chunker, "parse_picture", lambda **kwargs: "Image description: a pump.")


def test_a_described_picture_records_its_own_boxes(described):
    doc = document()
    doc.add_text(DocItemLabel.TEXT, "The pump room was inspected.", prov=prov(1, 10, 390, 290, 380))
    picture(doc, (50, 350, 250, 200), caption="Figure 3 Pump room")

    [passage] = chunk_document(doc)

    assert region(passage) == ("picture", [50.0, 350.0, 250.0, 200.0], [1])


def test_a_table_reread_as_a_picture_records_its_boxes_as_a_picture(described, monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: None)
    doc = document()
    table(doc, (10, 370, 290, 200))

    [passage] = chunk_document(doc)

    assert region(passage) == ("picture", [10.0, 370.0, 290.0, 200.0], [1])


# --- plain text


def test_a_plain_text_passage_records_no_region():
    doc = document()
    doc.add_text(DocItemLabel.TEXT, "Aisles were clear.", prov=prov(1, 10, 390, 290, 380))

    [passage] = chunk_document(doc)

    assert not REGION_KEYS & passage["metadata"].keys()


def test_the_prose_left_when_a_table_does_not_read_records_no_region(monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: None)
    monkeypatch.setattr(chunker, "parse_picture", lambda **kwargs: None)
    doc = document()
    doc.add_text(DocItemLabel.TEXT, "Agent quantities are below.", prov=prov(1, 10, 390, 290, 380))
    table(doc, (10, 370, 290, 300))

    passages = chunk_document(doc)

    assert passages and not any(REGION_KEYS & p["metadata"].keys() for p in passages)

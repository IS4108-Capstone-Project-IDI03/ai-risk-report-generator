"""Table chunk emission in the chunker (IN-03, Phase 3).

`_detect_bboxes` selects the boxes of items carrying a given Docling label, and
`_extract_table_chunk` turns those into ONE index-ready chunk. These tests drive
both directly with duck-typed fakes (the code only uses ``getattr`` on Docling's
``meta.doc_items[].prov[].bbox``), so no Docling parse or OCR call happens.

Regressions pinned here:
  * `_detect_bboxes` used `if label != itemType: pass`, which filtered nothing,
    so a table crop also covered the surrounding prose.
  * `_extract_table_chunk` was handed `doc_id` where a file path was required.
  * the decoded table was computed and then dropped by a `warn`/`continue`.
"""

from types import SimpleNamespace

import pytest

from app.pipeline import chunker
from app.pipeline.parser import ParsedDocument


def _prov(page, left, top, right, bottom, origin="BOTTOMLEFT"):
    bbox = SimpleNamespace(l=left, t=top, r=right, b=bottom, coord_origin=origin)
    return SimpleNamespace(page_no=page, bbox=bbox)


def _item(label, *provs, self_ref=None):
    return SimpleNamespace(label=label, prov=list(provs), self_ref=self_ref)


def _chunk(*items):
    return SimpleNamespace(meta=SimpleNamespace(doc_items=list(items)))


def _table_item(*provs):
    return _item(chunker.DocItemLabel.TABLE, *provs)


def _text_item(*provs, text=""):
    item = _item(chunker.DocItemLabel.TEXT, *provs)
    item.text = text
    return item


# --- _detect_bboxes label filtering -------------------------------------------


def test_detect_bboxes_returns_only_matching_label():
    dl_chunk = _chunk(
        _table_item(_prov(4, 10, 300, 200, 100)),
        _text_item(_prov(4, 10, 90, 200, 40)),
    )

    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    # The regression: without the filter the neighbouring TEXT item was included
    # and the crop covered prose as well as the table.
    assert len(boxes) == 1
    assert boxes[0]["bbox"] == [10.0, 300.0, 200.0, 100.0]


def test_detect_bboxes_skips_non_matching_labels_entirely():
    dl_chunk = _chunk(_text_item(_prov(1, 10, 90, 200, 40)))
    assert chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk) == []


def test_detect_bboxes_collects_one_entry_per_provenance():
    dl_chunk = _chunk(_table_item(_prov(4, 10, 300, 200, 100), _prov(5, 10, 700, 200, 400)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)
    assert [b["page"] for b in boxes] == [4, 5]


def test_detect_bboxes_deduplicates_matching_provenance():
    dl_chunk = _chunk(
        _table_item(
            _prov(4, 10, 300, 200, 100),
            _prov(4, 10, 300, 200, 100),
        )
    )

    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    assert len(boxes) == 1


def test_detect_bboxes_carries_coord_origin():
    dl_chunk = _chunk(_table_item(_prov(2, 10, 300, 200, 100, origin="TOPLEFT")))
    (box,) = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)
    assert "TOPLEFT" in box["coord_origin"].upper()


def test_detect_bboxes_ignores_items_without_bbox():
    missing = SimpleNamespace(
        label=chunker.DocItemLabel.TABLE,
        prov=[SimpleNamespace(page_no=3, bbox=None)],
    )
    assert chunker._detect_bboxes(chunker.DocItemLabel.TABLE, _chunk(missing)) == []


def test_detect_bboxes_handles_a_chunk_with_no_items():
    assert chunker._detect_bboxes(chunker.DocItemLabel.TABLE, _chunk()) == []


def test_detect_bboxes_can_include_and_label_non_table_items():
    dl_chunk = _chunk(
        _table_item(_prov(4, 10, 300, 200, 100)),
        _text_item(_prov(4, 10, 90, 200, 40), text="text beside table"),
    )

    boxes = chunker._detect_bboxes(None, dl_chunk)

    assert [box["is_table"] for box in boxes] == [True, False]
    assert boxes[1]["text"] == "text beside table"


# --- _extract_table_chunk -----------------------------------------------------


@pytest.fixture
def spy_parse_table(monkeypatch):
    """Record the arguments `_extract_table_chunk` forwards to the parser."""
    calls: list[dict] = []

    def _parse_table(bbox, page, file_path, coord_origin=""):
        calls.append(
            {"bbox": bbox, "page": page, "file_path": file_path, "coord_origin": coord_origin}
        )
        return f"| table p{page} |"

    monkeypatch.setattr(chunker, "parse_table", _parse_table)
    return calls


def test_extract_table_chunk_builds_an_index_ready_chunk(spy_parse_table):
    dl_chunk = _chunk(_table_item(_prov(4, 10, 300, 200, 100)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:7",
        meta=dl_chunk.meta,
        headings=["Manual", "System Components"],
    )

    assert result["id"] == "fm200:table:7"
    assert result["text"] == "| table p4 |"
    assert result["metadata"]["doc_id"] == "fm200"
    assert result["metadata"]["headings"] == ["Manual", "System Components"]
    assert result["metadata"]["page_start"] == 4
    assert result["metadata"]["page_end"] == 4
    assert result["metadata"]["bbox"] == [10.0, 300.0, 200.0, 100.0]


def test_extract_table_chunk_keeps_text_items_in_a_mixed_chunk(spy_parse_table):
    dl_chunk = _chunk(
        _table_item(_prov(4, 10, 300, 200, 100)),
        _text_item(_prov(4, 10, 90, 200, 40), text="text beside table"),
    )
    boxes = chunker._detect_bboxes(None, dl_chunk)

    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:7",
        meta=dl_chunk.meta,
    )

    assert result["text"] == "| table p4 |\n\ntext beside table"


def test_extract_table_chunk_passes_the_pdf_path_not_the_doc_id(spy_parse_table):
    """The regression: file_path=doc_id meant PyMuPDF got "fm200", not a path."""
    dl_chunk = _chunk(_table_item(_prov(1, 10, 300, 200, 100)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    chunker._extract_table_chunk(
        boxes,
        doc_path="/docs/manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:0",
        meta=dl_chunk.meta,
    )

    assert spy_parse_table[0]["file_path"] == "/docs/manual.pdf"


def test_extract_table_chunk_forwards_coord_origin(spy_parse_table):
    dl_chunk = _chunk(_table_item(_prov(1, 10, 300, 200, 100, origin="TOPLEFT")))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:0",
        meta=dl_chunk.meta,
    )

    assert "TOPLEFT" in spy_parse_table[0]["coord_origin"].upper()


def test_multi_page_table_is_joined_in_page_order(spy_parse_table):
    dl_chunk = _chunk(_table_item(_prov(4, 10, 300, 200, 100), _prov(5, 10, 700, 200, 400)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:1",
        meta=dl_chunk.meta,
    )

    # Kept as ONE chunk spanning both pages, never token-split mid-row.
    assert result["text"] == "| table p4 |\n\n| table p5 |"
    assert result["metadata"]["page_start"] == 4
    assert result["metadata"]["page_end"] == 5


def test_extract_table_chunk_returns_none_when_nothing_decodes(monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: None)
    dl_chunk = _chunk(_table_item(_prov(1, 10, 300, 200, 100)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:0",
        meta=dl_chunk.meta,
    )

    assert result is None


def test_extract_table_chunk_returns_none_without_bboxes():
    assert (
        chunker._extract_table_chunk(
            [],
            doc_path="manual.pdf",
            doc_id="fm200",
            chunk_id="fm200:table:0",
            meta=_chunk().meta,
        )
        is None
    )


def test_chunk_deduplicates_table_bboxes_across_split_chunks(monkeypatch):
    table_prov = _prov(4, 10, 300, 200, 100)
    first = SimpleNamespace(
        text="first part",
        meta=SimpleNamespace(doc_items=[_table_item(table_prov)], headings=[]),
    )
    duplicate = SimpleNamespace(
        text="duplicate part",
        meta=SimpleNamespace(doc_items=[_table_item(_prov(4, 10, 300, 200, 100))], headings=[]),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [first, duplicate])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: "table")
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunker.chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    assert len(result) == 1
    assert result[0]["metadata"]["bbox"] == [10.0, 300.0, 200.0, 100.0]


def test_chunk_removes_seen_bboxes_from_a_later_mixed_chunk(monkeypatch):
    first_bbox = _prov(4, 10, 300, 200, 100)
    new_bbox = _prov(4, 10, 200, 200, 50)
    first = SimpleNamespace(
        text="first table",
        meta=SimpleNamespace(doc_items=[_table_item(first_bbox)], headings=[]),
    )
    mixed = SimpleNamespace(
        text="first and second tables",
        meta=SimpleNamespace(
            doc_items=[
                _table_item(_prov(4, 10, 300, 200, 100)),
                _table_item(new_bbox),
            ],
            headings=[],
        ),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [first, mixed])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "parse_table", lambda **kwargs: "table")
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunker.chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    assert len(result) == 2
    assert result[1]["metadata"]["bbox"] == [10.0, 200.0, 200.0, 50.0]


def test_partially_decoded_table_keeps_the_readable_pages(monkeypatch):
    """One unreadable page must not discard the pages that did decode."""

    def _parse_table(bbox, page, file_path, coord_origin=""):
        return "| table p4 |" if page == 4 else None

    monkeypatch.setattr(chunker, "parse_table", _parse_table)
    dl_chunk = _chunk(_table_item(_prov(4, 10, 300, 200, 100), _prov(5, 10, 700, 200, 400)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:1",
        meta=dl_chunk.meta,
    )

    assert result["text"] == "| table p4 |"


def test_first_ten_page_table_of_contents_leaders_are_removed(monkeypatch):
    dl_chunk = _chunk(_table_item(_prov(3, 10, 300, 200, 100)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    def _parse_table(bbox, page, file_path, coord_origin=""):
        return (
            "Risk Overview ......... 5\n"
            "Fire-resistant - - - 12\n"
            "Section \u2014 \u2014 \u2014 20\n"
            "Risk-based 2.0"
        )

    monkeypatch.setattr(chunker, "parse_table", _parse_table)
    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:1",
        meta=dl_chunk.meta,
    )

    assert result["text"] == "Risk Overview 5\nFire-resistant 12\nSection 20\nRisk-based 2.0"


def test_eleventh_page_tables_keep_repeated_characters(monkeypatch):
    dl_chunk = _chunk(_table_item(_prov(11, 10, 300, 200, 100)))
    boxes = chunker._detect_bboxes(chunker.DocItemLabel.TABLE, dl_chunk)

    def _parse_table(bbox, page, file_path, coord_origin=""):
        return "Appendix ......... 12"

    monkeypatch.setattr(chunker, "parse_table", _parse_table)
    result = chunker._extract_table_chunk(
        boxes,
        doc_path="manual.pdf",
        doc_id="fm200",
        chunk_id="fm200:table:1",
        meta=dl_chunk.meta,
    )

    assert result["text"] == "Appendix ......... 12"

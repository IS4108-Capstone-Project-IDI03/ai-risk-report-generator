"""Table/formula OCR runs after chunking, several regions at once (IN-12).

`chunk()` is driven with a fake HybridChunker yielding duck-typed Docling
chunks (the code reads only labels, prov page/bbox and text). The per-region
OCR calls, `parse_table` and `parse_formula_bbox`, are the network boundary and
are replaced; everything else is the real chunker.
"""

import threading
from types import SimpleNamespace

import pytest

from app.pipeline import chunker
from app.pipeline.parser import ParsedDocument
from app.pipeline.progress import IngestionCancelledError

LABEL = chunker.DocItemLabel


def _prov(page, top=300):
    bbox = SimpleNamespace(l=10, t=top, r=200, b=top - 100, coord_origin="BOTTOMLEFT")
    return SimpleNamespace(page_no=page, bbox=bbox)


def _chunk(text, label, *provs):
    item = SimpleNamespace(label=label, prov=list(provs), self_ref=None, text=text)
    return SimpleNamespace(text=text, meta=SimpleNamespace(doc_items=[item], headings=[]))


def _run(monkeypatch, chunks, reporter=None):
    monkeypatch.setattr(chunker, "_chunker", lambda: SimpleNamespace(chunk=lambda dl_doc: chunks))
    monkeypatch.setattr(chunker, "close_document", lambda: None)
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    return chunker.chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc, page_count=4),
        doc_path="manual.pdf",
        doc_id="doc",
        reporter=reporter,
    )


def test_ocr_results_land_in_reading_order_with_stable_ids(monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kw: f"| table p{kw['page']} |")
    monkeypatch.setattr(chunker, "parse_formula_bbox", lambda **kw: "W = V/S")
    chunks = [
        _chunk("intro", LABEL.TEXT, _prov(1)),
        _chunk("linearised table", LABEL.TABLE, _prov(2)),
        _chunk("after", LABEL.TEXT, _prov(3)),
        _chunk("<!-- formula-not-decoded -->", LABEL.FORMULA, _prov(4)),
    ]

    result = _run(monkeypatch, chunks)

    assert [(c["id"], c["text"]) for c in result] == [
        ("doc:0", "intro"),
        ("doc:table:1", "| table p2 |"),
        ("doc:2", "after"),
        ("doc:3", "W = V/S"),
    ]


def test_ocr_for_different_tables_is_in_flight_at_the_same_time(monkeypatch):
    monkeypatch.setenv("OCR_CONCURRENCY", "2")
    both_started = threading.Barrier(2, timeout=5)

    def parse_table(**kw):
        both_started.wait()  # breaks (raises) if the other call never starts
        return f"| table p{kw['page']} |"

    monkeypatch.setattr(chunker, "parse_table", parse_table)
    chunks = [
        _chunk("first table", LABEL.TABLE, _prov(1)),
        _chunk("second table", LABEL.TABLE, _prov(2)),
    ]

    result = _run(monkeypatch, chunks)

    assert [c["text"] for c in result] == ["| table p1 |", "| table p2 |"]


def test_a_cancel_during_the_last_table_ocr_stops_the_document(monkeypatch):
    cancelled = threading.Event()

    def parse_table(**kw):
        cancelled.set()  # the admin cancels while this region is being read
        return "| table |"

    class Reporter:
        def check_cancelled(self):
            if cancelled.is_set():
                raise IngestionCancelledError()

        def update_pages(self, current, total):
            pass

    monkeypatch.setattr(chunker, "parse_table", parse_table)

    with pytest.raises(IngestionCancelledError):
        _run(monkeypatch, [_chunk("only table", LABEL.TABLE, _prov(1))], reporter=Reporter())


def test_a_table_split_across_chunks_is_read_once_even_if_it_fails(monkeypatch):
    # Both chunks carry the same table box. It is queued once; when that one read
    # fails the table is dropped, not retried from the second chunk.
    calls = []

    def parse_table(**kw):
        calls.append(kw["page"])
        return None

    monkeypatch.setattr(chunker, "parse_table", parse_table)
    chunks = [
        _chunk("table, first part", LABEL.TABLE, _prov(2)),
        _chunk("table, second part", LABEL.TABLE, _prov(2)),
    ]

    assert _run(monkeypatch, chunks) == []
    assert calls == [2]


# --- page of each stored box ----------------------------------------------------
# `bbox` is a flat list, 4 numbers per box; `bbox_pages` names each box's page so
# the region can be cut out of the original PDF later.


def test_each_stored_box_names_its_page(monkeypatch):
    monkeypatch.setattr(chunker, "parse_table", lambda **kw: f"| table p{kw['page']} |")
    chunks = [
        _chunk("table over two pages", LABEL.TABLE, _prov(2, top=300), _prov(3, top=700)),
        _chunk("text over two pages", LABEL.TEXT, _prov(3, top=200), _prov(4, top=700)),
    ]

    table, text = _run(monkeypatch, chunks)

    assert table["metadata"]["bbox"] == [10.0, 300.0, 200.0, 200.0, 10.0, 700.0, 200.0, 600.0]
    assert table["metadata"]["bbox_pages"] == [2, 3]
    assert text["metadata"]["bbox_pages"] == [3, 4]

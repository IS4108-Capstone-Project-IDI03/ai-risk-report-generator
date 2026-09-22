"""Orchestrator wiring contract (IN-02, Task 5) — written first (TDD).

These tests exercise the stage wiring of `run()` with fakes for parse / chunk /
anonymise / index_chunks, so no Docling or network calls happen. They pin:
- stage order: parse -> chunk -> anonymise -> index
- tables/images are branched aside and never indexed
- the summary reports indexed-chunk and captured table/image counts
- index_chunks receives exactly the anonymised chunk dicts
- UnparsableDocumentError from parsing propagates
"""

import pytest

from app import pipeline
from app.pipeline.errors import UnparsableDocumentError
from app.pipeline.parser import CapturedItem, ParsedDocument


def _parsed(tables=0, images=0) -> ParsedDocument:
    return ParsedDocument(
        doc_name="manual.pdf",
        docling_document=object(),  # opaque; the fake chunker ignores it
        tables=[
            CapturedItem(kind="table", page=1, section_path=[], caption="", order=i)
            for i in range(tables)
        ],
        images=[
            CapturedItem(kind="image", page=1, section_path=[], caption="", order=i)
            for i in range(images)
        ],
    )


def _install_fakes(monkeypatch, parsed, calls, *, chunks=None):
    chunks = (
        chunks
        if chunks is not None
        else [
            {"id": "manual.pdf:0", "text": "alpha", "metadata": {"doc_name": "manual.pdf"}},
            {"id": "manual.pdf:1", "text": "beta", "metadata": {"doc_name": "manual.pdf"}},
        ]
    )

    def fake_parse(file_path, page_range=None):
        calls.append(("parse", file_path, page_range))
        return parsed

    def fake_chunk(parsed_arg, doc_path=None, doc_id=None):
        calls.append(("chunk", parsed_arg))
        return chunks

    def fake_anonymise(chunk_list):
        calls.append(("anonymise", chunk_list))
        return chunk_list

    def fake_index(chunk_list):
        calls.append(("index", chunk_list))
        return len(chunk_list)

    monkeypatch.setattr(pipeline, "parse", fake_parse)
    monkeypatch.setattr(pipeline, "chunk", fake_chunk)
    monkeypatch.setattr(pipeline, "anonymise", fake_anonymise)
    monkeypatch.setattr(pipeline, "index_chunks", fake_index)
    return chunks


def test_stage_order_is_parse_chunk_anonymise_index(monkeypatch):
    calls = []
    _install_fakes(monkeypatch, _parsed(), calls)
    pipeline.run("some/report.pdf")
    stages = [c[0] for c in calls]
    assert stages == ["parse", "chunk", "anonymise", "index"]


def test_index_receives_anonymised_chunks(monkeypatch):
    calls = []
    chunks = _install_fakes(monkeypatch, _parsed(), calls)
    pipeline.run("some/report.pdf")
    indexed = next(c[1] for c in calls if c[0] == "index")
    assert indexed == chunks


def test_summary_reports_counts(monkeypatch):
    calls = []
    _install_fakes(monkeypatch, _parsed(tables=3, images=2), calls)
    summary = pipeline.run("some/report.pdf")
    assert summary["chunks_indexed"] == 2
    assert summary["tables_captured"] == 3
    assert summary["images_captured"] == 2
    assert summary["doc_name"] == "manual.pdf"


def test_tables_and_images_are_not_indexed(monkeypatch):
    calls = []
    _install_fakes(monkeypatch, _parsed(tables=3, images=2), calls)
    pipeline.run("some/report.pdf")
    indexed = next(c[1] for c in calls if c[0] == "index")
    # Only chunk dicts are indexed; captured items never enter the index call.
    assert all("text" in c and "id" in c for c in indexed)
    assert len(indexed) == 2


def test_unparsable_error_propagates(monkeypatch):
    def boom(file_path, page_range=None):
        raise UnparsableDocumentError(file_path, "corrupt")

    monkeypatch.setattr(pipeline, "parse", boom)
    with pytest.raises(UnparsableDocumentError):
        pipeline.run("bad.pdf")


def test_page_range_forwarded_to_parse(monkeypatch):
    calls = []
    _install_fakes(monkeypatch, _parsed(), calls)
    pipeline.run("some/report.pdf", page_range=(1, 5))
    parse_call = next(c for c in calls if c[0] == "parse")
    assert parse_call[2] == (1, 5)

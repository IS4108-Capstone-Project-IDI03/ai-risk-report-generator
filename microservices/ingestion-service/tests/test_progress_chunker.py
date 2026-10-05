"""Chunk-progress reporting (E2): chunker.chunk() reports every N chunks.

The real HybridChunker is replaced with a fake that yields a fixed number of
plain text chunks, so no Docling or network calls happen. The reporter is a
recorder that captures update_chunks calls.
"""

from types import SimpleNamespace

import pytest

from app.pipeline import chunker
from app.pipeline.parser import ParsedDocument


class FakeMeta:
    """Minimal Docling chunk meta: no tables, formulas, headings or provenance."""

    doc_items: list = []
    headings: list = []


class FakeChunk:
    def __init__(self, text):
        self.text = text
        self.meta = FakeMeta()


class FakeChunker:
    """Stands in for HybridChunker: yields `count` plain text chunks."""

    def __init__(self, count):
        self._count = count

    def chunk(self, dl_doc=None):
        for n in range(self._count):
            yield FakeChunk(f"chunk {n}")


class RecordingReporter:
    def __init__(self):
        self.chunk_updates = []

    def update_chunks(self, completed, total):
        self.chunk_updates.append((completed, total))


def _install(monkeypatch, count):
    monkeypatch.setattr(chunker, "_chunker", lambda: FakeChunker(count))
    # Neutralise helpers that would need real heading/section data.
    monkeypatch.setattr(chunker, "_build_section_trails", lambda doc: {})
    monkeypatch.setattr(chunker, "close_document", lambda: None)


def _parsed():
    # A non-None docling_document is all chunk() checks before iterating.
    return ParsedDocument(
        doc_name="manual.pdf",
        docling_document=object(),
        tables=[],
        images=[],
    )


def test_reports_every_interval_chunks(monkeypatch):
    _install(monkeypatch, count=5)
    reporter = RecordingReporter()

    chunker.chunk(
        _parsed(),
        doc_path="manual.pdf",
        doc_id="doc",
        reporter=reporter,
        chunk_progress_interval=2,
    )

    # 5 chunks, interval 2 -> reported after chunk 2 and chunk 4.
    assert reporter.chunk_updates == [(2, None), (4, None)]


def test_does_not_report_mid_loop_when_interval_exceeds_count(monkeypatch):
    _install(monkeypatch, count=5)
    reporter = RecordingReporter()

    chunker.chunk(
        _parsed(),
        doc_path="manual.pdf",
        doc_id="doc",
        reporter=reporter,
        chunk_progress_interval=10,
    )

    # 5 chunks, interval 10 -> the counter never reaches a multiple of 10.
    assert reporter.chunk_updates == []


def test_a_none_reporter_does_not_raise(monkeypatch):
    _install(monkeypatch, count=5)

    chunks = chunker.chunk(
        _parsed(),
        doc_path="manual.pdf",
        doc_id="doc",
        reporter=None,
        chunk_progress_interval=2,
    )

    assert len(chunks) == 5

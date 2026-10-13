"""Page-progress reporting (E2b): chunker.chunk() reports each new page reached.

The real HybridChunker is replaced with a fake that yields chunks on given
pages, so no Docling or network calls happen. The reporter is a recorder that
captures update_pages calls. The chunker reports once each time chunking reaches
a page further than any seen before — not per chunk — against the document's
total page count.
"""

from types import SimpleNamespace

from app.pipeline import chunker
from app.pipeline.parser import ParsedDocument

# The walk tests reach the last page, so no end-of-pass report is added.
TOTAL_PAGES = 3


def _prov(page):
    """One Docling provenance entry on `page` (what _pages_of reads)."""
    return SimpleNamespace(page_no=page)


class FakeMeta:
    """Docling chunk meta carrying one doc item with one page of provenance."""

    def __init__(self, page):
        # One item, one prov box, no bbox: enough for _pages_of, nothing else.
        self.doc_items = [SimpleNamespace(prov=[_prov(page)], label=None, self_ref=None)]
        self.headings: list = []


class FakeChunk:
    def __init__(self, text, page):
        self.text = text
        self.meta = FakeMeta(page)


class FakeChunker:
    """Stands in for HybridChunker: yields one chunk per page in `pages`."""

    def __init__(self, pages):
        self._pages = pages

    def chunk(self, dl_doc=None):
        for n, page in enumerate(self._pages):
            yield FakeChunk(f"chunk {n}", page=page)


class RecordingReporter:
    def __init__(self):
        self.page_updates = []
        self.ocr_updates = []

    def update_pages(self, current, total):
        self.page_updates.append((current, total))

    def update_ocr(self, current, total):
        self.ocr_updates.append((current, total))


def _install(monkeypatch, pages):
    monkeypatch.setattr(chunker, "_chunker", lambda: FakeChunker(pages))
    # Neutralise helpers that would need real heading/section/bbox data.
    monkeypatch.setattr(chunker, "_build_section_trails", lambda doc: {})
    monkeypatch.setattr(chunker, "_chunk_bbox", lambda dl_chunk: [])
    monkeypatch.setattr(chunker, "_is_table_chunk", lambda dl_chunk: False)
    monkeypatch.setattr(chunker, "_has_formula_chunk", lambda dl_chunk: False)
    monkeypatch.setattr(chunker, "close_document", lambda: None)


def _parsed(page_count=TOTAL_PAGES):
    # A non-None docling_document is all chunk() checks before iterating;
    # page_count is the progress total.
    return ParsedDocument(
        doc_name="manual.pdf",
        docling_document=object(),
        tables=[],
        images=[],
        page_count=page_count,
    )


def _run(monkeypatch, pages, page_count=TOTAL_PAGES):
    _install(monkeypatch, pages)
    reporter = RecordingReporter()
    chunker.chunk(
        _parsed(page_count=page_count),
        doc_path="manual.pdf",
        doc_id="doc",
        reporter=reporter,
    )
    return reporter


def test_reports_each_new_page_against_the_total(monkeypatch):
    # One chunk per page across three pages -> one update per page.
    reporter = _run(monkeypatch, pages=[1, 2, 3])
    assert reporter.page_updates == [(1, TOTAL_PAGES), (2, TOTAL_PAGES), (3, TOTAL_PAGES)]


def test_reports_a_page_only_once_across_several_chunks(monkeypatch):
    # Pages 1,1,2,2,3 -> each page reported the first time it is reached.
    reporter = _run(monkeypatch, pages=[1, 1, 2, 2, 3])
    assert reporter.page_updates == [(1, TOTAL_PAGES), (2, TOTAL_PAGES), (3, TOTAL_PAGES)]


def test_does_not_report_a_page_that_is_not_further_than_the_furthest_reached(monkeypatch):
    # A chunk whose provenance steps back (3 then 2) does not re-report; the
    # page reported is monotonic.
    reporter = _run(monkeypatch, pages=[1, 3, 2])
    assert reporter.page_updates == [(1, TOTAL_PAGES), (3, TOTAL_PAGES)]


def test_reports_every_page_walked_when_the_last_pages_have_no_chunks(monkeypatch):
    # Pages 4-5 are blank (no chunk text), yet chunking has walked them all:
    # the counter must end at 5 / 5, not stick at 3 / 5.
    reporter = _run(monkeypatch, pages=[1, 2, 3], page_count=5)
    assert reporter.page_updates[-1] == (5, 5)


def test_reports_ocr_regions_read_against_the_regions_queued(monkeypatch):
    # Every chunk holds a formula, so pass 2 queues three OCR regions.
    _install(monkeypatch, pages=[1, 2, 3])
    monkeypatch.setattr(chunker, "_has_formula_chunk", lambda dl_chunk: True)
    monkeypatch.setattr(chunker, "_extract_formula_chunk", lambda bboxes, path: "W = V/S")
    reporter = RecordingReporter()

    chunker.chunk(_parsed(), doc_path="manual.pdf", doc_id="doc", reporter=reporter)

    assert reporter.ocr_updates == [(0, 3), (1, 3), (2, 3), (3, 3)]


def test_reports_no_ocr_progress_when_nothing_needs_ocr(monkeypatch):
    reporter = _run(monkeypatch, pages=[1, 2, 3])
    assert reporter.ocr_updates == []


def test_total_is_none_when_the_page_count_is_unknown(monkeypatch):
    reporter = _run(monkeypatch, pages=[1, 2], page_count=None)
    assert reporter.page_updates == [(1, None), (2, None)]


def test_a_none_reporter_does_not_raise(monkeypatch):
    _install(monkeypatch, pages=[1, 2, 3])

    chunks = chunker.chunk(
        _parsed(),
        doc_path="manual.pdf",
        doc_id="doc",
        reporter=None,
    )

    assert len(chunks) == 3

"""Chunker contract against the real FM-200 fixture (IN-02, Task 4).

Test-after: the HybridChunker's output depends on Docling's real parse, so we
parse a small page slice of the fixture once and assert the chunk dict shape and
metadata mapping against it. A skip guard covers environments where Docling
models cannot be loaded.
"""

from types import SimpleNamespace

import pytest
from test_file_option import get_fixture

from app.pipeline import chunker
from app.pipeline.chunker import chunk
from app.pipeline.parser import ParsedDocument, parse

FIXTURE = get_fixture()

# Small slice so the real parse+chunk stays fast (see test_parser for rationale).
TEST_PAGE_RANGE: tuple[int, int] = (1, 6)


@pytest.fixture(scope="module")
def chunks() -> list[dict]:
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing: {FIXTURE}")
    try:
        parsed = parse(str(FIXTURE), page_range=TEST_PAGE_RANGE)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"Docling models unavailable in this environment: {exc}")
    return chunk(parsed, doc_path=FIXTURE, doc_id="fm200")


# --- fast test (no Docling conversion) ----------------------------------------


def test_empty_document_returns_empty_list():
    parsed = ParsedDocument(doc_name="empty.pdf", docling_document=None)
    assert chunk(parsed, doc_path=None) == []


def test_chunk_metadata_carries_bbox_as_float_list(monkeypatch):
    bbox = SimpleNamespace(l=10, t=300, r=200, b=100, coord_origin="BOTTOMLEFT")
    item = SimpleNamespace(
        label=chunker.DocItemLabel.TEXT,
        prov=[SimpleNamespace(page_no=4, bbox=bbox)],
        self_ref="item-1",
    )
    dl_chunk = SimpleNamespace(
        text="body text",
        meta=SimpleNamespace(doc_items=[item], headings=[]),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [dl_chunk])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    assert result[0]["metadata"]["bbox"] == [10.0, 300.0, 200.0, 100.0]


def test_chunk_metadata_flattens_bboxes_in_page_order(monkeypatch):
    def _item(page, left, top, right, bottom):
        bbox = SimpleNamespace(
            l=left,
            t=top,
            r=right,
            b=bottom,
            coord_origin="BOTTOMLEFT",
        )
        return SimpleNamespace(
            label=chunker.DocItemLabel.TEXT,
            prov=[SimpleNamespace(page_no=page, bbox=bbox)],
        )

    dl_chunk = SimpleNamespace(
        text="body text",
        meta=SimpleNamespace(
            doc_items=[
                _item(5, 50, 500, 150, 450),
                _item(4, 10, 300, 200, 100),
            ],
            headings=[],
        ),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [dl_chunk])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    metadata = result[0]["metadata"]
    assert metadata["page_start"] == 4
    assert metadata["page_end"] == 5
    assert metadata["bbox"] == [10.0, 300.0, 200.0, 100.0, 50.0, 500.0, 150.0, 450.0]


def test_chunk_metadata_omits_empty_optional_values(monkeypatch):
    dl_chunk = SimpleNamespace(
        text="body text",
        meta=SimpleNamespace(doc_items=[], headings=[]),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [dl_chunk])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    assert result[0]["metadata"] == {"doc_id": "fm200"}


def test_first_ten_page_text_chunk_leaders_are_removed(monkeypatch):
    def _item(page):
        bbox = SimpleNamespace(l=10, t=300, r=200, b=100, coord_origin="BOTTOMLEFT")
        return SimpleNamespace(
            label=chunker.DocItemLabel.TEXT,
            prov=[SimpleNamespace(page_no=page, bbox=bbox)],
        )

    dl_chunk = SimpleNamespace(
        text="Purpose and Scope ........................................ 1",
        meta=SimpleNamespace(doc_items=[_item(3)], headings=[]),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [dl_chunk])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    assert result[0]["text"] == "Purpose and Scope 1"


def test_eleventh_page_text_chunk_leaders_are_kept(monkeypatch):
    bbox = SimpleNamespace(l=10, t=300, r=200, b=100, coord_origin="BOTTOMLEFT")
    item = SimpleNamespace(
        label=chunker.DocItemLabel.TEXT,
        prov=[SimpleNamespace(page_no=11, bbox=bbox)],
    )
    dl_chunk = SimpleNamespace(
        text="Appendix ........................................ 12",
        meta=SimpleNamespace(doc_items=[item], headings=[]),
    )
    doc = SimpleNamespace(iterate_items=lambda with_groups=False: [])
    fake_chunker = SimpleNamespace(chunk=lambda dl_doc: [dl_chunk])
    monkeypatch.setattr(chunker, "_chunker", lambda: fake_chunker)
    monkeypatch.setattr(chunker, "close_document", lambda: None)

    result = chunk(
        ParsedDocument(doc_name="manual.pdf", docling_document=doc),
        doc_path="manual.pdf",
        doc_id="fm200",
    )

    assert result[0]["text"] == "Appendix ........................................ 12"


def test_docling_contents_triplets_are_rendered_as_readable_rows():
    text = (
        "1., 1 = Purpose and Scope 1., 2 = 1. "
        "2., 1 = Executive Summary 2., 2 = 2. "
        "3., 1 = Opportunities for Improvement 3., 2 = 4. "
        ", 1 = \u2022 Risk Assessment Matrix (RAM). , 2 = 4."
    )

    assert chunker._clean_toc_leaders(text) == (
        "1. Purpose and Scope 1.\n"
        "2. Executive Summary 2.\n"
        "3. Opportunities for Improvement 4.\n"
        "\u2022 Risk Assessment Matrix (RAM). 4."
    )


def test_docling_contents_blank_rows_keep_bullet_pages_and_separate_rows():
    text = (
        "3., 1 = Opportunities for Improvement 3., 2 = 4. "
        ", 1 = \u2022 Risk Assessment Matrix (RAM). , 2 = 4. "
        ", 1 = \u2022 Management Programs. , 2 = 6. "
        ", 1 = \u2022 Physical Protection , 2 = 9. "
        ", 1 = \u2022 Past Opportunities for Improvement. , 2 = 12. "
        "9. External, 1 = Exposures , 2 = 47."
    )

    assert chunker._clean_toc_leaders(text) == (
        "3. Opportunities for Improvement 4.\n"
        "\u2022 Risk Assessment Matrix (RAM). 4.\n"
        "\u2022 Management Programs. 6.\n"
        "\u2022 Physical Protection 9.\n"
        "\u2022 Past Opportunities for Improvement. 12.\n"
        "9. External Exposures 47."
    )


# --- structural tests against the real fixture --------------------------------


@pytest.mark.model
def test_produces_chunks(chunks):
    assert chunks, "expected at least one chunk from the manual slice"
    assert all(c["text"].strip() for c in chunks)


@pytest.mark.model
def test_chunk_ids_are_unique_and_prefixed(chunks):
    ids = [c["id"] for c in chunks]
    assert len(set(ids)) == len(ids)
    assert all(c["id"].startswith("fm200:") for c in chunks)


@pytest.mark.model
def test_metadata_carries_doc_id_and_headings(chunks):
    for c in chunks:
        meta = c["metadata"]
        assert meta["doc_id"] == "fm200"
        # headings is the raw trail; present only when the chunk has headings,
        # and when present it is a non-empty homogeneous list of str.
        if "headings" in meta:
            assert isinstance(meta["headings"], list)
            assert meta["headings"]
            assert all(isinstance(h, str) for h in meta["headings"])
    # At least some chunks should sit under a heading.
    assert any("headings" in c["metadata"] for c in chunks)


@pytest.mark.model
def test_metadata_values_are_chroma_safe(chunks):
    # Chroma 1.5.5 accepts scalars OR a non-empty homogeneous list of scalars.
    scalars = (str, int, float, bool)
    for c in chunks:
        for key, value in c["metadata"].items():
            if isinstance(value, list):
                assert value, f"{key} is an empty list (Chroma rejects [])"
                first = type(value[0])
                assert all(type(v) is first for v in value), f"{key} list not homogeneous"
                assert all(isinstance(v, scalars) for v in value), f"{key} list not scalars"
            else:
                assert isinstance(value, scalars), f"{key}={value!r} is not scalar/list"


@pytest.mark.model
def test_page_bounds_are_ints_within_slice(chunks):
    with_pages = [c for c in chunks if "page_start" in c["metadata"]]
    assert with_pages, "expected page provenance on at least some chunks"
    start, end = TEST_PAGE_RANGE
    for c in with_pages:
        meta = c["metadata"]
        assert isinstance(meta["page_start"], int)
        assert isinstance(meta["page_end"], int)
        assert meta["page_start"] <= meta["page_end"]
        # Provenance must fall within the parsed page window.
        assert start <= meta["page_start"] <= end
        assert start <= meta["page_end"] <= end


# --- inspection aid (opt-in) --------------------------------------------------

# Number of chunks and text preview length to dump when inspecting.
INSPECT_START = 0
INSPECT_LIMIT = 40
INSPECT_TEXT_CHARS = 300


@pytest.mark.model
@pytest.mark.inspect
def test_inspect_chunks(chunks):
    """Dump chunk text + metadata for eyeballing, before any indexing.

    Not part of the normal suite — opt in and show output with:
        uv run pytest tests/test_chunker.py -m inspect -s

    Calls the chunker directly (no embed/upsert), so these are exactly the
    chunk dicts that would be handed to `index_chunks`.
    """
    print(f"\n=== {len(chunks)} chunks (showing up to {INSPECT_LIMIT}) ===")
    for c in chunks[INSPECT_START : INSPECT_START + INSPECT_LIMIT]:
        meta = c["metadata"]
        print(
            f"\n[{c['id']}] pages={meta.get('page_start')}-{meta.get('page_end')}\n"
            f"bbox={meta.get('bbox')!r} headings={meta.get('headings')!r}"
        )
        print(c["text"][:INSPECT_TEXT_CHARS])
    # Light sanity check so this isn't a silent no-op if chunking breaks.
    assert chunks

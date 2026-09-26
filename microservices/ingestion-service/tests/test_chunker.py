"""Chunker contract against the real FM-200 fixture (IN-02, Task 4).

Test-after: the HybridChunker's output depends on Docling's real parse, so we
parse a small page slice of the fixture once and assert the chunk dict shape and
metadata mapping against it. A skip guard covers environments where Docling
models cannot be loaded.
"""

from pathlib import Path

import pytest

from app.pipeline.chunker import chunk

# from app.pipeline.chunker_with_display import chunk
from app.pipeline.parser import ParsedDocument, parse

FIXTURE = Path(__file__).parent / "FM_Standard_File" / "Tyco Hygood FM-200 Engineered Manual.pdf"

# Small slice so the real parse+chunk stays fast (see test_parser for rationale).
TEST_PAGE_RANGE: tuple[int, int] = (1, 10)


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
            f"\n[{c['id']}] pages={meta.get('page_start')}-{meta.get('page_end')} "
            f"headings={meta.get('headings')!r}"
        )
        print(c["text"][:INSPECT_TEXT_CHARS])
    # Light sanity check so this isn't a silent no-op if chunking breaks.
    assert chunks

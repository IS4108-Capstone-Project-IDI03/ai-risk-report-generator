"""Anonymiser contract (IN-02, Task 3) — written first (TDD).

Anonymisation runs AFTER chunking: it takes the chunk dicts and returns them
unchanged for now (pass-through). Real PII masking is future work and, when it
lands, must rewrite each chunk's ``text`` (and scrub PII from metadata such as
headings/captions) while keeping ids and the rest of the metadata intact.

These tests pin the pass-through contract so a later real implementation keeps
the same shape (list[dict] in, list[dict] out) unless deliberately changed.
"""

import copy

from app.pipeline.anonymiser import anonymise


def _chunk(cid: str, text: str) -> dict:
    return {
        "id": cid,
        "text": text,
        "metadata": {
            "doc_id": "manual",
            "section_path": "Doc > Section",
            "page_start": 2,
            "page_end": 3,
        },
    }


def test_returns_text_unchanged():
    chunks = [_chunk("d:0", "hello world"), _chunk("d:1", "second chunk")]
    result = anonymise(chunks)
    assert [c["text"] for c in result] == ["hello world", "second chunk"]


def test_preserves_ids_and_metadata():
    chunks = [_chunk("d:0", "a"), _chunk("d:1", "b")]
    result = anonymise(chunks)
    assert [c["id"] for c in result] == ["d:0", "d:1"]
    assert all(c["metadata"]["doc_id"] == "manual" for c in result)
    assert all(c["metadata"]["section_path"] == "Doc > Section" for c in result)


def test_does_not_mutate_input_chunks():
    chunks = [_chunk("d:0", "sensitive text")]
    snapshot = copy.deepcopy(chunks)
    anonymise(chunks)
    assert chunks == snapshot


def test_empty_input_returns_empty():
    assert anonymise([]) == []


def test_result_is_a_list():
    result = anonymise([_chunk("d:0", "x")])
    assert isinstance(result, list)

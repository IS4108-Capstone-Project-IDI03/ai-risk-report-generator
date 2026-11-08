"""Anonymiser contract (IN-02, Task 3; PV-06).

Anonymisation runs AFTER chunking, the last step before embedding. Without
protection it passes chunks through unchanged. With it (a redacted report), it is
the epic's safety net: each chunk's text goes through /mask once more, for details
the OCR model read out of pictures, keeping the redaction's tags. Ids and metadata
are kept. privacy-service is faked (`fake_privacy`).
"""

import copy

import pymupdf

from app.pipeline.anonymiser import anonymise
from app.pipeline.redactor import redact_pdf
from app.privacy import session


def _chunk(cid: str, text: str) -> dict:
    return {
        "id": cid,
        "text": text,
        "metadata": {
            "doc_id": "manual",
            "headings": ["Doc", "Section"],
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
    assert all(c["metadata"]["headings"] == ["Doc", "Section"] for c in result)


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


# PV-06: with protection on, chunk text is the safety net's, masked once more before embedding.
PRIVACY = {"enabled": True, "known_entities": [{"type": "PERSON", "names": ["John Tan"]}]}
PICTURE = "Image description (generated, photograph): A sign reading Call +65 6123 4567."


def test_with_protection_a_number_read_from_a_picture_is_tagged(fake_privacy):
    [result] = anonymise([_chunk("d:picture:0", PICTURE)], session(PRIVACY))

    assert result["text"] == (
        "Image description (generated, photograph): A sign reading Call [PHONE_1]."
    )
    assert result["id"] == "d:picture:0"
    assert result["metadata"] == _chunk("d:picture:0", PICTURE)["metadata"]


def test_tags_from_the_redaction_stay_and_new_ones_continue_its_numbering(fake_privacy):
    protection = session(PRIVACY)
    page = pymupdf.open()
    page.new_page().insert_text((50, 100), "John Tan, +65 6000 0000.")
    redact_pdf(page.tobytes(), protection)  # [PERSON_1] and [PHONE_1], as before parsing
    chunk = _chunk("d:0", "[PERSON_1] ([PHONE_1]) put up a sign: Call +65 6123 4567.")

    [result] = anonymise([chunk], protection)

    assert result["text"] == "[PERSON_1] ([PHONE_1]) put up a sign: Call [PHONE_2]."
    assert protection.mapping == {
        "[PERSON_1]": "John Tan",
        "[PHONE_1]": "+65 6000 0000",
        "[PHONE_2]": "+65 6123 4567",
    }


def test_with_protection_off_nothing_is_sent_and_text_is_unchanged(fake_privacy):
    # A guard, passing when first run: a session that is off masks nothing.
    [result] = anonymise([_chunk("d:0", PICTURE)], session({"enabled": False}))

    assert result["text"] == PICTURE
    assert fake_privacy.requests == []

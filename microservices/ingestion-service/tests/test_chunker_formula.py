"""Formula chunk bbox handling in the chunker (IN-03).

`_has_formula_chunk` decides a chunk is a formula, `_chunk_bbox` turns that
chunk into one union bounding box PER PAGE it spans, and `_extract_formula_chunk`
crops + decodes those boxes via `parse_formula_bbox`.

These tests drive the bbox logic directly with duck-typed fakes (the code only
uses ``getattr`` on Docling's ``meta.doc_items[].prov[].bbox``), so no Docling
parse or Pix2Text model runs. `parse_formula_bbox` is monkeypatched to record
which pages it was asked to decode.

NOTE: `test_multi_page_formula_decodes_every_page` is EXPECTED TO FAIL today.
`_extract_formula_chunk` only reads ``chunk_bboxes[0]``, so a formula that spans
pages silently drops every page after the first. The failing test documents the
bug and should start passing once the extractor loops over all pages.
"""

from types import SimpleNamespace

from app.pipeline import chunker


def _prov(
    page: int, left: float, top: float, right: float, bottom: float, origin: str = "BOTTOMLEFT"
):
    """A fake Docling provenance entry: a page number plus a bbox."""
    bbox = SimpleNamespace(l=left, t=top, r=right, b=bottom, coord_origin=origin)
    return SimpleNamespace(page_no=page, bbox=bbox)


def _item(*provs):
    return SimpleNamespace(prov=list(provs))


def _chunk(*items):
    return SimpleNamespace(meta=SimpleNamespace(doc_items=list(items)))


def _formula_item(*provs):
    """A doc item labelled FORMULA (for `_has_formula_chunk`)."""
    item = _item(*provs)
    item.label = chunker.DocItemLabel.FORMULA
    return item


def _spans_pages_5_and_6():
    """One formula chunk whose items land on page 5 AND page 6."""
    return _chunk(
        _item(_prov(5, 40, 380, 160, 340)),
        _item(_prov(6, 40, 60, 160, 20)),
    )


# --- _has_formula_chunk -------------------------------------------------------


def test_has_formula_chunk_true_when_formula_label_present():
    chunk = _chunk(_formula_item(_prov(1, 10, 100, 90, 60)))
    assert chunker._has_formula_chunk(chunk) is True


def test_has_formula_chunk_false_without_formula_label():
    item = _item(_prov(1, 10, 100, 90, 60))
    item.label = chunker.DocItemLabel.TEXT
    assert chunker._has_formula_chunk(_chunk(item)) is False


# --- _chunk_bbox: per-page split + union --------------------------------------


def test_chunk_bbox_splits_into_one_box_per_page():
    boxes = chunker._chunk_bbox(_spans_pages_5_and_6())
    # One union box per page, sorted by page number.
    assert [b["page"] for b in boxes] == [5, 6]
    assert all(len(b["bbox"]) == 4 for b in boxes)


def test_chunk_bbox_unions_multiple_items_on_same_page():
    # Two items on page 5; the union is l=min, r=max, t=max, b=min
    # (bottom-left origin: larger t is higher on the page).
    chunk = _chunk(
        _item(_prov(5, 40, 300, 100, 280)),
        _item(_prov(5, 60, 320, 160, 260)),
    )
    (box,) = chunker._chunk_bbox(chunk)
    assert box["page"] == 5
    assert box["bbox"] == (40, 320, 160, 260)


def test_chunk_bbox_carries_coord_origin():
    chunk = _chunk(_item(_prov(3, 10, 100, 90, 60, origin="TOPLEFT")))
    (box,) = chunker._chunk_bbox(chunk)
    assert "TOPLEFT" in box["coord_origin"].upper()


def test_chunk_bbox_ignores_items_without_page_or_bbox():
    good = _item(_prov(2, 10, 100, 90, 60))
    missing_bbox = SimpleNamespace(prov=[SimpleNamespace(page_no=2, bbox=None)])
    chunk = _chunk(good, missing_bbox)
    boxes = chunker._chunk_bbox(chunk)
    assert [b["page"] for b in boxes] == [2]


# --- _extract_formula_chunk ---------------------------------------------------


def test_extract_formula_chunk_decodes_single_page(monkeypatch):
    seen: list[int] = []

    def fake_parse(bbox, page, file_path):
        seen.append(page)
        return "E = mc^2"

    monkeypatch.setattr(chunker, "parse_formula_bbox", fake_parse)

    chunk = _chunk(_item(_prov(5, 40, 380, 160, 340)))
    boxes = chunker._chunk_bbox(chunk)
    result = chunker._extract_formula_chunk(boxes, "doc.pdf")

    assert result == "E = mc^2"
    assert seen == [5]


def test_multi_page_formula_decodes_every_page(monkeypatch):
    """A formula spanning pages 5 and 6 must decode BOTH pages.

    EXPECTED TO FAIL today: `_extract_formula_chunk` only reads
    ``chunk_bboxes[0]``, so page 6 is dropped and only page 5 is decoded. This
    test pins the correct behaviour so the truncation bug gets fixed later.
    """
    seen: list[int] = []

    def fake_parse(bbox, page, file_path):
        seen.append(page)
        return f"formula-p{page}"

    monkeypatch.setattr(chunker, "parse_formula_bbox", fake_parse)

    boxes = chunker._chunk_bbox(_spans_pages_5_and_6())
    chunker._extract_formula_chunk(boxes, "doc.pdf")

    # Both pages of the multi-page formula should be decoded, in order.
    assert seen == [5, 6]

"""Stage 2: chunk the parsed document into index-ready dicts.

Runs Docling's `HybridChunker` (token-aware, heading-carrying) over the parsed
`DoclingDocument` and maps each Docling chunk to the dict shape `index_chunks`
expects: ``{"id", "text", "metadata"}``.

Docling chunk metadata is mapped as:
- ``meta.headings``            -> ``headings`` (the heading trail, a list of str)
- ``meta.doc_items[].prov[].page_no`` -> ``page_start`` / ``page_end``

``headings`` is stored as the raw list (outermost -> nearest heading).
``page_start`` / ``page_end`` are ints (present only when page provenance is known)
``bbox`` is a flat list of float coordinates, in page order, when provenance is known.
``doc_id`` is the foreign key back to the source document BUT not implemented yet.

Chunk sizing: Defaults to 512-token and triggers overflow, warnings on long chunks.
We embed with Cohere ``embed-v4.0`` (128k-token limit), so 512 is far too small.
`MAX_CHUNK_TOKENS``. Keep chunks well under the embedder limit for retrieval precision
Adjust ``MAX_CHUNK_TOKENS`` (and ``CHUNK_TOKENIZER_MODEL`` if desired) below.
"""

import re
from functools import lru_cache
from typing import Any

from docling_core.transforms.chunker import HybridChunker
from docling_core.types.doc import (
    DocItemLabel,
    SectionHeaderItem,
    TitleItem,
)

from app.pipeline.chunking_helper.formula_parser import parse_formula_bbox
from app.pipeline.chunking_helper.page_cache import close_document
from app.pipeline.chunking_helper.table_parser import parse_table
from app.pipeline.parser import ParsedDocument

# --- chunk sizing
MAX_CHUNK_TOKENS = 1024
# Tokenizer used only to COUNT tokens for boundary decisions (not for embedding).
# Adjust it for embeding model (Cohere embed)
CHUNK_TOKENIZER_MODEL = "BAAI/bge-m3"
_FIRST_PAGES_LIMIT = 10


def _has_formula_chunk(dl_chunk) -> bool:
    """True if a chunk is derived (wholly or partly) from a formula.

    Docking's enriched_formula detection slows down run on pages even without formula.
    Extract out bbox and extract separately with a dedicated tool instead.
    """

    has_formula = any(item.label == DocItemLabel.FORMULA for item in dl_chunk.meta.doc_items)
    return has_formula


def _detect_bboxes(item_label: DocItemLabel | None, dl_chunk) -> list[dict]:
    """Bounding boxes of items in `dl_chunk`, optionally filtered by label.

    Each entry is ``{"page": int, "bbox": [float, ...], "coord_origin": str}``
    taken straight from Docling provenance. Docling's origin is normally
    bottom-left; `image_crop` reconciles that against the page height.

    When no label is supplied, each entry also carries ``is_table`` and the
    source item's ``text``. Text is attached only to the first provenance box
    for an item so multi-box items are not emitted repeatedly.
    """

    boxes: list[dict] = []
    for item in getattr(dl_chunk.meta, "doc_items", None) or []:
        item_label_value = getattr(item, "label", None)
        if item_label is not None and item_label_value != item_label:
            continue

        for prov_index, prov in enumerate(getattr(item, "prov", None) or []):
            bbox = getattr(prov, "bbox", None)
            if bbox is None:
                continue
            boxes.append(
                {
                    "page": getattr(prov, "page_no", None),
                    "bbox": [float(bbox.l), float(bbox.t), float(bbox.r), float(bbox.b)],
                    "coord_origin": str(getattr(bbox, "coord_origin", "")),
                    "is_table": item_label_value == DocItemLabel.TABLE,
                    "text": getattr(item, "text", "") if prov_index == 0 else "",
                }
            )
    return _bbox_area_deduplication(boxes)


def _bbox_area(chunk_bbox: dict) -> float:
    left, top, right, bottom = chunk_bbox["bbox"]
    return abs(right - left) * abs(bottom - top)


def _bboxes_match(first: dict, second: dict) -> bool:
    """Whether two provenance boxes are close enough to represent one region."""
    if first["page"] != second["page"]:
        return False
    if first.get("is_table", True) != second.get("is_table", True):
        return False

    first_area = _bbox_area(first)
    second_area = _bbox_area(second)
    largest_area = max(first_area, second_area)
    if largest_area == 0:
        return first["bbox"] == second["bbox"]

    area_diff_ratio = abs(first_area - second_area) / largest_area
    if area_diff_ratio >= 0.1:
        return False

    return all(abs(first["bbox"][idx] - second["bbox"][idx]) <= 2.0 for idx in range(4))


def _bbox_area_deduplication(chunk_bboxes: list[dict]) -> list[dict]:
    deduplicated_bboxes: list[dict] = []
    for chunk_bbox in chunk_bboxes:
        if not any(_bboxes_match(chunk_bbox, existing) for existing in deduplicated_bboxes):
            deduplicated_bboxes.append(chunk_bbox)
    return deduplicated_bboxes


def _unseen_bboxes(bboxes: list[dict], seen_bboxes: list[dict]) -> list[dict]:
    """Return bboxes not already emitted by an earlier table chunk."""
    return [bbox for bbox in bboxes if not any(_bboxes_match(bbox, seen) for seen in seen_bboxes)]


def _chunk_bbox(dl_chunk) -> list[dict]:
    """Bounding box of the ENTIRE chunk, one union box per page it spans.

    Used for formulas exception: formula lives inside ordinary text items — so
    `_detect_bboxes(FormulaItem, ...)` returns []. Instead we union the bboxes of
    all the chunk's items (text and formula).

    Each entry is ``{"page": int, "bbox": [float, ...], "coord_origin": str}``.
    NOTE: Docling's origin is bottom-left; a downstream crop (e.g.
    OCR) must reconcile origin (and scale to page size) first.
    """
    # page_no -> [origin, l, t, r, b] accumulated to a union rectangle.
    per_page: dict[int, dict] = {}
    for item in getattr(dl_chunk.meta, "doc_items", None) or []:
        for prov in getattr(item, "prov", None) or []:
            bbox = getattr(prov, "bbox", None)
            page = getattr(prov, "page_no", None)
            if bbox is None or page is None:
                continue
            origin = str(getattr(bbox, "coord_origin", ""))
            acc = per_page.get(page)
            if acc is None:
                # First bbox for this page: start the union with it.
                per_page[page] = {
                    "l": bbox.l,
                    "t": bbox.t,
                    "r": bbox.r,
                    "b": bbox.b,
                    "coord_origin": origin,
                }
            else:
                # Accumulate the union of all bboxes on this page.
                acc["l"] = min(acc["l"], bbox.l)
                acc["r"] = max(acc["r"], bbox.r)
                acc["t"] = max(acc["t"], bbox.t)
                acc["b"] = min(acc["b"], bbox.b)
    chunk_bboxes = [
        {
            "page": page,
            "bbox": [float(a["l"]), float(a["t"]), float(a["r"]), float(a["b"])],
            "coord_origin": a["coord_origin"],
        }
        for page, a in sorted(per_page.items())
    ]

    return _bbox_area_deduplication(chunk_bboxes)


def _is_table_chunk(dl_chunk) -> bool:
    """True if a chunk is derived (wholly or partly) from a table.

    The HybridChunker linearises tables into text and may split a large table
    mid-row, which destroys row/column/header associations.
    Extract out the table with a dedicated tool
    """

    is_table = any(item.label == DocItemLabel.TABLE for item in dl_chunk.meta.doc_items)
    return is_table


def _pages_of(meta) -> list[int]:
    """Sorted unique page numbers referenced by a Docling chunk's items."""
    pages: set[int] = set()
    for item in getattr(meta, "doc_items", None) or []:
        for prov in getattr(item, "prov", None) or []:
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                pages.add(page_no)
    return sorted(pages)


def _update_section_stack(stack: list[tuple[int, str]], level: int, text: str) -> None:
    """Push a heading onto a level-keyed stack, dropping deeper-or-equal levels.

    If next header is of a higher level, drop until its at the parent of the current level
    """
    while stack and stack[-1][0] >= level:
        stack.pop()
    stack.append((level, text))


def _build_section_trails(doc) -> dict[str, list[str]]:
    """Map each document item's self_ref -> its heading trail (outermost first)."""
    trails: dict[str, list[str]] = {}
    stack: list[tuple[int, str]] = []
    for item, _tree_level in doc.iterate_items(with_groups=False):
        label = getattr(item, "label", None)
        if isinstance(item, TitleItem) or label == DocItemLabel.TITLE:
            _update_section_stack(stack, 0, item.text)

        elif isinstance(item, SectionHeaderItem) or label == DocItemLabel.SECTION_HEADER:
            level = getattr(item, "level", 1) or 1
            _update_section_stack(stack, level, item.text)

        self_ref = getattr(item, "self_ref", None)
        if self_ref is not None:
            trails[self_ref] = [text for _lvl, text in stack]
    return trails


def _chunk_trail(dl_chunk, trails: dict[str, list[str]]) -> list[str]:
    """Heading trail for a chunk, via the self_ref of its first doc item."""
    for item in getattr(dl_chunk.meta, "doc_items", None) or []:
        self_ref = getattr(item, "self_ref", None)
        if self_ref in trails:
            return trails[self_ref]
    return []


def _flatten_bboxes(bboxes: list[dict] | None) -> list[float]:
    """Flatten per-page bbox coordinates into Chroma-safe metadata values."""
    if not bboxes:
        return []
    return [float(coordinate) for box in bboxes for coordinate in box["bbox"]]


def _is_first_pages(bboxes: list[dict]) -> bool:
    """Whether every provenance box belongs to the document's first few pages."""
    pages = [box.get("page") for box in bboxes]
    return bool(pages) and all(
        isinstance(page, int) and 1 <= page <= _FIRST_PAGES_LIMIT for page in pages
    )


_DOCLING_COLUMN_MARKER_RE = re.compile(r",\s*(?P<column>\d+)\s*=")
_TOC_LEADER_RE = re.compile(r"[ \t]*(?:[.\-\u2013\u2014][ \t]*){3,}")
_DOCLING_TRIPLET_RE = re.compile(r"(?P<row>\d+\.)?,\s*(?P<column>\d+)\s*=\s*")


def _clean_toc_leaders(text: str) -> str:
    """Remove table-of-contents leaders and Docling cell markers."""
    text = _TOC_LEADER_RE.sub(" ", text)

    def replace_triplet(match: re.Match[str]) -> str:
        if match.group("column") != "1":
            return " "

        row = match.group("row")
        following = text[match.end() :].lstrip()
        if row and not following.startswith("\u2022"):
            # bullet: keep the row number if it leads a bulleted list, else drop it
            return f"\n{row} "
        if row:
            return "\n"

        preceding = text[: match.start()]
        if preceding.rstrip()[-1:].isalnum():
            return " "
        markers = list(_DOCLING_COLUMN_MARKER_RE.finditer(preceding))
        if markers and markers[-1].group("column") == "2":
            return "\n"
        return " " if "\u2022" in preceding.rsplit("\n", 1)[-1] else "\n"

    text = _DOCLING_TRIPLET_RE.sub(replace_triplet, text)
    text = re.sub(r"(?P<page>\d+\.)\s+(?=\d+\.\s)", r"\g<page>\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r" *\n *", "\n", text).strip()


def _build_metadata(
    meta,
    doc_id: str,
    headings: list[str] | None = None,
    bboxes: list[dict] | None = None,
) -> dict:
    # Prefer the nested trail computed from heading levels (passed in); fall back
    # to Docling's flat per-chunk headings only if no trail was provided.
    if headings is None:
        headings = list(getattr(meta, "headings", None) or [])
    pages = _pages_of(meta)
    page_start = pages[0] if pages else None
    page_end = pages[-1] if pages else None

    metadata: dict = {
        "doc_id": doc_id,  # foreign key back to the source document
    }
    # `headings` is the chunk's heading trail (outermost -> nearest). Chroma
    # accepts a homogeneous list of str, but rejects an empty list, so only set
    # the key when there is at least one heading. Join for display when needed.
    if headings:
        metadata["headings"] = headings
    if page_start is not None:
        metadata["page_start"] = page_start
        metadata["page_end"] = page_end
    bbox_coordinates = _flatten_bboxes(bboxes)
    if bbox_coordinates:
        metadata["bbox"] = bbox_coordinates
    return metadata


def _extract_table_chunk(
    table_bboxes: list[dict],
    doc_path: str,
    doc_id: str,
    chunk_id: str,
    meta,
    headings: list[str] | None = None,
) -> dict | None:
    """Extract a table into a single index-ready chunk, or None.

    Called IN SERIES the moment a table is detected during chunking, so its
    result can be appended in document (reading) order rather than collected and
    reconciled afterwards. `table_bboxes` carries one page + bounding box per
    item in the mixed chunk (see `_detect_bboxes`). Only entries labelled as
    tables are sent to the table parser; other entries contribute their source
    text directly.

    The table is emitted as ONE chunk and never token-split: splitting a table
    mid-row is exactly the failure this path exists to avoid, so a table that
    exceeds `MAX_CHUNK_TOKENS` is still kept whole. A table spanning pages is
    decoded page by page and joined in order.

    Returns None when no region decoded, so the caller skips the table rather
    than indexing an empty chunk.
    """
    parts: list[str] = []
    for box in table_bboxes:
        if not box.get("is_table", True):
            text = str(box.get("text", "")).strip()
            if text:
                parts.append(text)
            continue

        parsed = parse_table(
            bbox=box["bbox"],
            page=box["page"],
            file_path=doc_path,
            coord_origin=box.get("coord_origin", ""),
        )
        if parsed:
            parts.append(parsed)

    if not parts:
        return None

    text = "\n\n".join(parts)
    if _is_first_pages(table_bboxes):
        text = _clean_toc_leaders(text)

    return {
        "id": chunk_id,
        "text": text,
        "metadata": _build_metadata(
            meta,
            doc_id,
            headings=headings,
            bboxes=table_bboxes,
        ),
    }


def _extract_formula_chunk(chunk_bboxes: list[dict], file_path: str) -> str:
    """Decode a formula chunk by cropping and parsing each page it spans.

    Runs IN SERIES the moment a formula chunk is detected. A formula chunk can
    span multiple pages, so `chunk_bboxes` holds one box PER page (see
    `_chunk_bbox`). We decode every page in order and join the results — reading
    only the first box would silently drop everything after the first page.

    `parse_formula_bbox` converts Docling's bottom-left bbox to the crop tool's
    convention, crops, and decodes the region.
    """
    parts: list[str] = []
    for box in chunk_bboxes:
        decoded = parse_formula_bbox(
            bbox=box["bbox"],
            page=box["page"],
            file_path=file_path,
            coord_origin=box.get("coord_origin", ""),
        )
        if decoded:
            parts.append(decoded)
    return "\n".join(parts)


@lru_cache(maxsize=1)
def _chunker():
    """Build (once) a HybridChunker with an explicit tokenizer + token ceiling.

    The tokenizer only counts tokens for boundary decisions; embedding is still
    done by Cohere downstream. Cached so the tokenizer loads a single time per
    process. Imported lazily so importing this module doesn't pull Docling's
    heavy deps until chunking is actually used.
    """
    from docling_core.transforms.chunker.tokenizer.huggingface import (
        HuggingFaceTokenizer,
    )

    tokenizer = HuggingFaceTokenizer.from_pretrained(
        CHUNK_TOKENIZER_MODEL, max_tokens=MAX_CHUNK_TOKENS
    )
    return HybridChunker(tokenizer=tokenizer)


def chunk(
    parsed: ParsedDocument,
    doc_path: str | None = None,
    doc_id: str | None = None,
    reporter=None,
) -> list[dict]:
    """Chunk a parsed document into index-ready chunk dicts.

    Args:
        parsed: result of `parser.parse`, carrying the `DoclingDocument`.
        doc_id: stable identifier for the source document; defaults to the
            document name. Used to build unique chunk ids (``f"{doc_id}:{n}"``).
        reporter: an optional ProgressReporter (E2). Updates for each page.

    Returns:
        A list of ``{"id", "text", "metadata"}`` dicts ready for `index_chunks`.
        Empty if the document produced no chunks.
    """
    if doc_path is None:
        return []

    doc = parsed.docling_document
    if doc is None:
        return []

    resolved_doc_id = doc_id or parsed.doc_name

    chunker: HybridChunker = _chunker()

    # Precompute nested heading trails (self_ref -> trail) from heading levels,
    # since a chunk's own meta.headings is flat.
    section_trails = _build_section_trails(doc)

    total_pages = parsed.page_count
    page_reached = 0

    chunks: list[dict] = []
    seen_chunk_bboxes: list[dict] = []
    try:
        for n, dl_chunk in enumerate(chunker.chunk(dl_doc=doc)):
            text = (dl_chunk.text or "").strip()
            if not text:
                continue

            pages = _pages_of(dl_chunk.meta)
            if pages and len(pages) > 0 and pages[-1] > page_reached:
                page_reached = pages[-1]
                if reporter:
                    reporter.update_pages(page_reached, total_pages)

            trail = _chunk_trail(dl_chunk, section_trails)

            # Tables are handled IN SERIES here, not collected for later: the
            # moment a table chunk is detected we grab its bounding box and run
            # table extraction inline, so the table lands in reading order.
            if _is_table_chunk(dl_chunk):
                # Docling's linearised table text is discarded on purpose — it
                # has already lost the row/column structure.
                table_bboxes = _unseen_bboxes(_detect_bboxes(None, dl_chunk), seen_chunk_bboxes)
                if not table_bboxes:
                    continue
                table_chunk = _extract_table_chunk(
                    table_bboxes,
                    doc_path=str(doc_path),
                    doc_id=resolved_doc_id,
                    chunk_id=f"{resolved_doc_id}:table:{n}",
                    meta=dl_chunk.meta,
                    headings=trail,
                )
                if table_chunk is not None:
                    chunks.append(table_chunk)
                    seen_chunk_bboxes.extend(table_bboxes)
                continue

            chunk_bboxes: list[dict[Any, Any]] = _chunk_bbox(dl_chunk)
            has_formula = _has_formula_chunk(dl_chunk)
            if has_formula:
                # With formula enrichment OFF, formula text gets replaced with
                #  <!-- formula-not-decoded -->
                # formula process in series (appended in reading order when done).
                formula_chunk = _extract_formula_chunk(chunk_bboxes, str(doc_path))
                if formula_chunk:
                    text = formula_chunk
            elif _is_first_pages(chunk_bboxes):
                text = _clean_toc_leaders(text)

            chunks.append(
                {
                    "id": f"{resolved_doc_id}:{n}",
                    "text": text,
                    "metadata": _build_metadata(
                        dl_chunk.meta,
                        resolved_doc_id,
                        headings=trail,
                        bboxes=chunk_bboxes,
                    ),
                }
            )
    finally:
        # Release the PDF handle even if a region blows up mid-document.
        close_document()

    return chunks

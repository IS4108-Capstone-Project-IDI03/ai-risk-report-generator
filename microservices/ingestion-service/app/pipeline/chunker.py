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
``bbox_pages`` names the page of each 4-number box in ``bbox``, in the same order.
``position`` is the chunk's number in reading order (the number in its id).
Table chunks also carry ``table_id`` (shared by a table's row groups) and
``table_title``.
``doc_id`` is the foreign key back to the source document BUT not implemented yet.

Chunk sizing: Defaults to 512-token and triggers overflow, warnings on long chunks.
We embed with Cohere ``embed-v4.0`` (128k-token limit), so 512 is far too small.
`MAX_CHUNK_TOKENS``. Keep chunks well under the embedder limit for retrieval precision
Adjust ``MAX_CHUNK_TOKENS`` (and ``CHUNK_TOKENIZER_MODEL`` if desired) below.
"""

import os
import re
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache, partial
from typing import Any

from docling_core.transforms.chunker import HybridChunker
from docling_core.transforms.chunker.hierarchical_chunker import (
    ChunkingDocSerializer,
    ChunkingSerializerProvider,
)
from docling_core.types.doc import (
    DocItemLabel,
    PictureItem,
    RefItem,
    SectionHeaderItem,
    TitleItem,
)

from app.pipeline.chunking_helper.formula_parser import parse_formula_bbox
from app.pipeline.chunking_helper.ocr_model import reader
from app.pipeline.chunking_helper.ocr_prompts import PICTURE_PROMPT_VERSION
from app.pipeline.chunking_helper.page_cache import close_document
from app.pipeline.chunking_helper.picture_parser import parse_picture
from app.pipeline.chunking_helper.table_parser import parse_table
from app.pipeline.chunking_helper.table_text import group_records, split_tables
from app.pipeline.parser import ParsedDocument

# --- chunk sizing
MAX_CHUNK_TOKENS = 1024
# Tokenizer used only to COUNT tokens for boundary decisions (not for embedding).
# Adjust it for embeding model (Cohere embed)
CHUNK_TOKENIZER_MODEL = "BAAI/bge-m3"
_FIRST_PAGES_LIMIT = 10
# Table/formula/picture regions read at once (OCR_CONCURRENCY overrides). The calls are
# network-bound, so threads suffice; keep it under the OCR provider's rate limit.
OCR_CONCURRENCY = 6
# What a picture serializes to while chunking. Docling's default is "", which
# leaves an uncaptioned picture out of every chunk; any text puts the picture
# item (and its bbox) into its chunk's doc_items. It never reaches passage text:
# picture chunks are rebuilt from their items.
PICTURE_PLACEHOLDER = "<!-- picture -->"


class _PictureSerializerProvider(ChunkingSerializerProvider):
    """Docling's chunking serializer, with pictures kept as a placeholder."""

    def get_serializer(self, doc):
        params = ChunkingDocSerializer.model_fields["params"].default
        return ChunkingDocSerializer(
            doc=doc, params=params.model_copy(update={"image_placeholder": PICTURE_PLACEHOLDER})
        )


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
    if first.get("is_picture", False) != second.get("is_picture", False):
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


def _is_picture_chunk(dl_chunk) -> bool:
    """True if a chunk holds a picture (photo, diagram, chart) Docling located."""
    return any(item.label == DocItemLabel.PICTURE for item in dl_chunk.meta.doc_items)


def _pictures_of(dl_chunk, doc, seen_bboxes: list[dict]) -> list[dict]:
    """Each picture in a chunk, in reading order, with the prose that sits by it.

    A picture carries its own boxes, its caption, and the chunk's prose: text
    before the first picture goes with it, text after a picture stays with that
    picture. A picture's own caption items are left out of the prose, as the
    caption already leads its passage. A picture whose boxes are all in
    `seen_bboxes` (Docling repeated it) is left out, and its new boxes are added
    there, so each picture is read once.
    """
    items = getattr(dl_chunk.meta, "doc_items", None) or []
    # HybridChunker hands back plain DocItems (no text, no captions); the
    # document holds the real items.
    resolved = {item.self_ref: RefItem(cref=item.self_ref).resolve(doc) for item in items}
    caption_refs = {
        ref.cref
        for picture in resolved.values()
        if isinstance(picture, PictureItem)
        for ref in picture.captions
    }

    pictures: list[dict] = []
    before: list[str] = []
    for item in items:
        if getattr(item, "label", None) != DocItemLabel.PICTURE:
            text = (getattr(resolved[item.self_ref], "text", "") or "").strip()
            if text and item.self_ref not in caption_refs:
                (pictures[-1]["after"] if pictures else before).append(text)
            continue
        boxes = [
            {
                "page": prov.page_no,
                "bbox": [float(v) for v in (prov.bbox.l, prov.bbox.t, prov.bbox.r, prov.bbox.b)],
                "coord_origin": str(getattr(prov.bbox, "coord_origin", "")),
                "is_table": False,
                "is_picture": True,
            }
            for prov in getattr(item, "prov", None) or []
            if getattr(prov, "bbox", None) is not None
        ]
        boxes = _unseen_bboxes(_bbox_area_deduplication(boxes), seen_bboxes)
        if not boxes:
            continue
        seen_bboxes.extend(boxes)
        picture = resolved[item.self_ref]
        caption = picture.caption_text(doc) if isinstance(picture, PictureItem) else ""
        pictures.append(
            {
                "boxes": boxes,
                "caption": " ".join(caption.split()),
                "before": [] if pictures else before,
                "after": [],
            }
        )
    return pictures


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


def _table_caption(dl_chunk, doc) -> str:
    """The printed caption Docling tied to a chunk's table, or "" (it is in no chunk text)."""
    for item in getattr(dl_chunk.meta, "doc_items", None) or []:
        if getattr(item, "label", None) != DocItemLabel.TABLE:
            continue
        caption_text = getattr(item, "caption_text", None)
        text = caption_text(doc) if callable(caption_text) else ""
        if isinstance(text, str) and text.strip():
            return " ".join(text.split())
    return ""


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
    position: int | None = None,
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
    # Place in reading order (the id's number), so search can fetch a hit's neighbours.
    if position is not None:
        metadata["position"] = position
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
        # One page per box, in the same order, so a region can be cut out of the
        # original PDF later (bbox alone can't say which page a box is on).
        box_pages = [box.get("page") for box in bboxes]
        if all(isinstance(page, int) for page in box_pages):
            metadata["bbox_pages"] = box_pages
    return metadata


def _extract_table_chunk(
    table_bboxes: list[dict],
    doc_path: str,
    doc_id: str,
    chunk_id: str,
    meta,
    headings: list[str] | None = None,
    caption: str = "",
    position: int | None = None,
) -> list[dict] | None:
    """Extract a region's tables into index-ready chunks, or None.

    Runs as one pass-2 OCR job (see `chunk`): its slot was reserved in reading
    order when the table was met, so it may finish in any order.
    `table_bboxes` carries one page + bounding box per
    item in the mixed chunk (see `_detect_bboxes`). Only entries labelled as
    tables are sent to the table parser; other entries contribute their source
    text directly.

    Each table is its own chunk(s), led by its title (Docling's `caption` for the
    first table, else the title the reader found in the image). A crop holding
    two tables gives two; a table over `GROUP_CHARS` is cut between rows into
    groups that each repeat the title, so one answering row is not drowned by
    the rest. Every chunk carries `table_id`, shared by its groups, so a hit can
    be widened to the whole table at search time. A table spanning pages is
    decoded page by page and its pages joined in order.

    Returns None when nothing decoded, so the caller skips the table rather
    than indexing an empty chunk.
    """
    before: list[str] = []
    after: list[str] = []
    readings: list[str] = []
    for box in table_bboxes:
        if not box.get("is_table", True):
            text = str(box.get("text", "")).strip()
            if text:
                (after if readings else before).append(text)
            continue

        parsed = parse_table(
            bbox=box["bbox"],
            page=box["page"],
            file_path=doc_path,
            coord_origin=box.get("coord_origin", ""),
        )
        if parsed:
            readings.append(parsed)

    text = "\n\n".join(readings)
    if text and _is_first_pages(table_bboxes):
        text = _clean_toc_leaders(text)
    tables = [table for table in split_tables(text) if table.records]
    metadata = _build_metadata(
        meta, doc_id, headings=headings, bboxes=table_bboxes, position=position
    )

    if not tables:
        prose = "\n\n".join(before + after)
        return [{"id": chunk_id, "text": prose, "metadata": metadata}] if prose else None

    chunks: list[dict] = []
    for index, table in enumerate(tables):
        table_id = chunk_id if len(tables) == 1 else f"{chunk_id}:t{index}"
        title = (caption.strip() if index == 0 else "") or table.title
        groups = group_records(table.records)
        for part, records in enumerate(groups):
            chunk_text = "\n".join(([title] if title else []) + records)
            chunks.append(
                {
                    "id": table_id if len(groups) == 1 else f"{table_id}:g{part}",
                    "text": chunk_text,
                    "metadata": {
                        **metadata,
                        "table_id": table_id,
                        **({"table_title": title} if title else {}),
                    },
                }
            )
    chunks[0]["text"] = "\n\n".join(before + [chunks[0]["text"]])
    chunks[-1]["text"] = "\n\n".join([chunks[-1]["text"]] + after)
    return chunks


def _picture_context(headings: list[str] | None, caption: str) -> str:
    """Where a picture sits, for its reader: the heading trail and its caption."""
    lines = []
    if headings:
        lines.append(f"Section: {' > '.join(headings)}")
    if caption:
        lines.append(f"Caption: {caption}")
    return "\n".join(lines)


def _extract_picture_chunk(
    pictures: list[dict],
    doc_path: str,
    doc_id: str,
    chunk_id: str,
    meta,
    headings: list[str] | None = None,
    position: int | None = None,
) -> list[dict]:
    """Describe a chunk's pictures as passages, one per picture.

    Runs as one pass-2 OCR job (see `chunk`). Each passage leads with the
    picture's caption, then its description, and carries the picture's own
    boxes in `bbox`/`bbox_pages`, so it can be cut out of the PDF again.
    """
    passages: list[dict] = []
    for index, picture in enumerate(pictures):
        context = _picture_context(headings, picture["caption"])
        readings = [
            parse_picture(
                bbox=box["bbox"],
                page=box["page"],
                file_path=doc_path,
                coord_origin=box.get("coord_origin", ""),
                context=context,
            )
            for box in picture["boxes"]
        ]
        read = [reading for reading in readings if reading]
        body = "\n".join(line for line in [picture["caption"], *read] if line)
        metadata = _build_metadata(
            meta, doc_id, headings=headings, bboxes=picture["boxes"], position=position
        )
        if read:
            # The description is the model's, not the document's (IN-13).
            metadata.update(
                generated_text="picture_description",
                generated_by=reader(),
                prompt_version=PICTURE_PROMPT_VERSION,
            )
        passages.append(
            {
                # `:g<k>` orders a chunk's pictures at search time, as it does a
                # table's row groups (rag-service `_group`).
                "id": chunk_id if len(pictures) == 1 else f"{chunk_id}:g{index}",
                "text": "\n\n".join(
                    part for part in [*picture["before"], body, *picture["after"]] if part
                ),
                "metadata": metadata,
            }
        )
    return passages


def _extract_formula_chunk(chunk_bboxes: list[dict], file_path: str) -> str:
    """Decode a formula chunk by cropping and parsing each page it spans.

    Runs as one pass-2 OCR job (see `chunk`). A formula chunk can
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
    return HybridChunker(tokenizer=tokenizer, serializer_provider=_PictureSerializerProvider())


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

    # Pass 1 walks the chunks in reading order. A table or formula chunk gets
    # its slot in `chunks` now and its OCR job queued in `ocr_jobs`; pass 2 runs
    # the jobs several at a time and fills the slots, so order and ids never
    # depend on which OCR call finishes first.
    chunks: list[dict | list[dict] | None] = []
    ocr_jobs: list[tuple[int, str, Callable[[], Any]]] = []
    seen_chunk_bboxes: list[dict] = []
    try:
        for n, dl_chunk in enumerate(chunker.chunk(dl_doc=doc)):
            _check_cancelled(reporter)
            text = (dl_chunk.text or "").strip()
            if not text:
                continue

            pages = _pages_of(dl_chunk.meta)
            if pages and len(pages) > 0 and pages[-1] > page_reached:
                page_reached = pages[-1]
                if reporter:
                    reporter.update_pages(page_reached, total_pages)

            trail = _chunk_trail(dl_chunk, section_trails)
            pictures = (
                _pictures_of(dl_chunk, doc, seen_chunk_bboxes)
                if _is_picture_chunk(dl_chunk)
                else []
            )
            # A picture chunk is rebuilt from its items in pass 2, so the
            # placeholder never reaches passage text.
            picture_job = partial(
                _extract_picture_chunk,
                pictures,
                doc_path=str(doc_path),
                doc_id=resolved_doc_id,
                chunk_id=f"{resolved_doc_id}:picture:{n}",
                meta=dl_chunk.meta,
                headings=trail,
                position=n,
            )

            if _is_table_chunk(dl_chunk):
                # Docling's linearised table text is discarded on purpose — it
                # has already lost the row/column structure.
                table_bboxes = _unseen_bboxes(_detect_bboxes(None, dl_chunk), seen_chunk_bboxes)
                if table_bboxes:
                    # Counted as seen when queued (not when decoded), so a table
                    # split across chunks is read once even while OCR runs in
                    # parallel. A table that fails to decode is not retried later.
                    seen_chunk_bboxes.extend(table_bboxes)
                    job = partial(
                        _extract_table_chunk,
                        table_bboxes,
                        doc_path=str(doc_path),
                        doc_id=resolved_doc_id,
                        chunk_id=f"{resolved_doc_id}:table:{n}",
                        meta=dl_chunk.meta,
                        headings=trail,
                        caption=_table_caption(dl_chunk, doc),
                        position=n,
                    )
                    ocr_jobs.append((len(chunks), "table", job))
                    chunks.append(None)  # filled (or dropped) in pass 2
                if pictures:
                    # The table's passages carry the chunk's prose; the
                    # pictures beside it keep only their caption and reading.
                    for picture in pictures:
                        picture["before"], picture["after"] = [], []
                    ocr_jobs.append((len(chunks), "picture", picture_job))
                    chunks.append(None)  # filled in pass 2
                continue

            if pictures:
                ocr_jobs.append((len(chunks), "picture", picture_job))
                chunks.append(None)  # filled in pass 2
                continue
            # A chunk whose only picture was already read keeps its prose alone.
            text = text.replace(PICTURE_PLACEHOLDER, "").strip()
            if not text:
                continue

            chunk_bboxes: list[dict[Any, Any]] = _chunk_bbox(dl_chunk)
            if _has_formula_chunk(dl_chunk):
                # With formula enrichment OFF, formula text gets replaced with
                #  <!-- formula-not-decoded -->; pass 2 re-reads the region and
                # keeps Docling's text if nothing decodes.
                job = partial(_extract_formula_chunk, chunk_bboxes, str(doc_path))
                ocr_jobs.append((len(chunks), "formula", job))
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
                        position=n,
                    ),
                }
            )

        # Trailing pages with no chunk text (blank, image-only) never move the
        # counter, but pass 1 has walked them: report the full count before OCR.
        if reporter and total_pages and page_reached < total_pages:
            reporter.update_pages(total_pages, total_pages)

        _run_ocr_jobs(ocr_jobs, chunks, reporter)
    finally:
        # Release the PDF handle even if a region blows up mid-document.
        close_document()

    # A table slot holds the list of chunks its tables and row groups became.
    return [
        passage
        for slot in chunks
        if slot is not None
        for passage in (slot if isinstance(slot, list) else [slot])
    ]


def _check_cancelled(reporter) -> None:
    check = getattr(reporter, "check_cancelled", None)
    if check:
        check()


def _ocr_concurrency() -> int:
    value = os.getenv("OCR_CONCURRENCY", "").strip()
    return max(1, int(value)) if value else OCR_CONCURRENCY


def _run_ocr_jobs(jobs: list[tuple[int, str, Callable[[], Any]]], chunks: list, reporter) -> None:
    """Pass 2: run queued table/formula OCR concurrently and fill their slots.

    A table job returns its chunks (or None, which drops the slot); a formula job
    returns decoded text, which replaces Docling's placeholder when not empty.
    Cancellation is checked as each region finishes; queued regions are then
    dropped and only the calls already in flight are waited for.
    """
    if not jobs:
        return
    # Regions finish out of page order, so progress is counted by region.
    if reporter:
        reporter.update_ocr(0, len(jobs))
    pool = ThreadPoolExecutor(max_workers=_ocr_concurrency())
    try:
        futures = {pool.submit(job): (slot, kind) for slot, kind, job in jobs}
        for done, future in enumerate(as_completed(futures), start=1):
            _check_cancelled(reporter)
            if reporter:
                reporter.update_ocr(done, len(jobs))
            slot, kind = futures[future]
            result = future.result()
            if kind in ("table", "picture"):
                chunks[slot] = result
            elif result:
                chunks[slot]["text"] = result
    finally:
        pool.shutdown(wait=True, cancel_futures=True)

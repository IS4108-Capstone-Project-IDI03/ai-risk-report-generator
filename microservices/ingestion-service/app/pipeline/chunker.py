"""Stage 2: chunk the parsed document into index-ready dicts.

Runs Docling's `HybridChunker` (token-aware, heading-carrying) over the parsed
`DoclingDocument` and maps each Docling chunk to the dict shape `index_chunks`
expects: ``{"id", "text", "metadata"}``.

Docling chunk metadata is mapped as:
- ``meta.headings``            -> ``headings`` (the heading trail, a list of str)
- ``meta.doc_items[].prov[].page_no`` -> ``page_start`` / ``page_end``

``headings`` is stored as the raw list (outermost -> nearest heading). Chroma
accepts a homogeneous list of str but rejects an empty list, so the key is only
set when the chunk has at least one heading. ``page_start`` / ``page_end`` are
ints (present only when page provenance is known) so callers can filter/cite by
page. ``doc_id`` is the foreign key back to the source document.

Chunk sizing: Defaults to 512-token and triggers overflow, warnings on long chunks.
We embed with Cohere ``embed-v4.0`` (128k-token limit), so 512 is far too small.
`MAX_CHUNK_TOKENS``. Keep chunks well under the embedder limit for retrieval precision
Adjust ``MAX_CHUNK_TOKENS`` (and ``CHUNK_TOKENIZER_MODEL`` if desired) below.
"""

from functools import lru_cache
from warnings import warn

from docling_core.transforms.chunker import HybridChunker
from docling_core.types.doc import DocItemLabel, TableItem

from app.pipeline.chunking_helper.formula_parser import close_document, parse_formula_bbox
from app.pipeline.parser import ParsedDocument

# --- chunk sizing
MAX_CHUNK_TOKENS = 1024
# Tokenizer used only to COUNT tokens for boundary decisions (not for embedding).
# Adjust it for embeding model (Cohere embed)
CHUNK_TOKENIZER_MODEL = "BAAI/bge-m3"


def _has_formula_chunk(dl_chunk) -> bool:
    """True if a chunk is derived (wholly or partly) from a formula.

    Docking's enriched_formula detection slows down run on pages even without formula.
    Extract out bbox and extract separately with a dedicated tool instead.
    """

    has_formula = any(item.label == DocItemLabel.FORMULA for item in dl_chunk.meta.doc_items)
    return has_formula


def _detect_bboxes(itemType, dl_chunk) -> list[dict]:
    """Bounding boxes for the formula item(s) behind a formula chunk.

    Each entry is ``{"page": int, "bbox": (l, t, r, b), "coord_origin": str}``
    taken straight from Docling provenance. NOTE: Docling's origin is typically
    bottom-left; pdfplumber expects top-left in PDF points — the extraction step
    must reconcile origin (and scale to the page size) before cropping.
    """

    boxes: list[dict] = []
    for item in getattr(dl_chunk.meta, "doc_items", None) or []:
        if not isinstance(item, itemType):
            continue
        for prov in getattr(item, "prov", None) or []:
            bbox = getattr(prov, "bbox", None)
            if bbox is None:
                continue
            boxes.append(
                {
                    "page": getattr(prov, "page_no", None),
                    "bbox": (bbox.l, bbox.t, bbox.r, bbox.b),
                    "coord_origin": str(getattr(bbox, "coord_origin", "")),
                }
            )
    return boxes


def _chunk_bbox(dl_chunk) -> list[dict]:
    """Bounding box of the ENTIRE chunk, one union box per page it spans.

    Used for formulas exception: formula lives inside ordinary text items — so
    `_detect_bboxes(FormulaItem, ...)` returns []. Instead we union the bboxes of
    all the chunk's items (text and formula).

    Each entry is ``{"page": int, "bbox": (l, t, r, b), "coord_origin": str}``.
    NOTE: Docling's origin is bottom-left; a downstream crop (e.g. pdfplumber or
    a formula-OCR) must reconcile origin (and scale to page size) first.
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
    return [
        {
            "page": page,
            "bbox": (a["l"], a["t"], a["r"], a["b"]),
            "coord_origin": a["coord_origin"],
        }
        for page, a in sorted(per_page.items())
    ]


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


def _build_metadata(meta, doc_id: str) -> dict:
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
    return metadata


def _extract_table_chunk(table_bboxes: list[dict], doc_id: str, chunk_id: str, meta) -> dict | None:
    """Extract a table into a single index-ready chunk (IN-03) — not yet implemented.

    Called IN SERIES the moment a table is detected during chunking, so its
    result can be appended in document (reading) order rather than collected and
    reconciled afterwards. `table_bboxes` carries the page + bounding box for the
    table (see `_table_bboxes`).

    When implemented: for each bbox, convert Docling's (bottom-left) coordinates
    to pdfplumber's top-left origin using the page height, open the PDF and crop
    with `page.within_bbox(...)`, then serialise the extracted grid to
    Markdown/row-wise text as ONE chunk (never token-split) with the
    `{"id", "text", "metadata"}` shape (reuse `_build_metadata`).

    Returns None for now so tables are effectively skipped until the tool lands.
    """
    return None


def _extract_formula_chunk(chunk_bboxes: list[dict], file_path: str) -> str:
    """Extract a formula chunk into one index-ready chunk — not yet implemented.

    Runs IN SERIES the moment a formula chunk is detected

    When implemented: convert the bbox from Docling's bottom-left origin to the
    crop tool's convention (using page height), crop, decode the formula, and
    return one {"id", "text", "metadata"} chunk (reuse `_build_metadata`).
    """
    text = parse_formula_bbox(
        bbox=chunk_bboxes[0]["bbox"], page=chunk_bboxes[0]["page"], file_path=file_path
    )
    return text


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
    parsed: ParsedDocument, doc_path: str | None = None, doc_id: str | None = None
) -> list[dict]:
    """Chunk a parsed document into index-ready chunk dicts.

    Args:
        parsed: result of `parser.parse`, carrying the `DoclingDocument`.
        doc_id: stable identifier for the source document; defaults to the
            document name. Used to build unique chunk ids (``f"{doc_id}:{n}"``).

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

    chunks: list[dict] = []
    for n, dl_chunk in enumerate(chunker.chunk(dl_doc=doc)):
        text = (dl_chunk.text or "").strip()
        if not text:
            continue

        # Tables are handled IN SERIES here, not collected for later: the moment
        # a table chunk is detected we grab its bounding box and run table
        # extraction inline, so any table chunk is appended in reading order
        if _is_table_chunk(dl_chunk):
            table_bboxes = _detect_bboxes(
                TableItem, dl_chunk
            )  # bbox(es) to use with pdfplumber later
            _ = _extract_table_chunk(
                table_bboxes, resolved_doc_id, f"{resolved_doc_id}:table:{n}", dl_chunk.meta
            )

            warn("Table extraction and chunking not implemented yet")
            continue
        elif _has_formula_chunk(dl_chunk):
            # With formula enrichment OFF, formula text gets replaced with
            #  <!-- formula-not-decoded -->
            # formula process in series (appended in reading order when done).
            formula_bboxes = _chunk_bbox(dl_chunk)
            formula_chunk = _extract_formula_chunk(formula_bboxes, doc_path)
            if formula_chunk is not None:
                text = formula_chunk

        chunks.append(
            {
                "id": f"{resolved_doc_id}:{n}",
                "text": text,
                "metadata": _build_metadata(dl_chunk.meta, resolved_doc_id),
            }
        )
    close_document()
    return chunks

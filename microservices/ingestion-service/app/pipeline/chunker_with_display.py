# =============================================================================
# TEMPORARY / THROWAWAY DEBUG TOOLING — DO NOT SHIP.
#
# This file is a copy of `chunker.py` used only to visually verify that the
# bounding boxes handed to downstream table/formula extraction line up with the
# real content on the rendered PDF page. It mirrors `chunker.py`'s public API
# exactly and (in later tasks) wires a blocking bbox-viewer window into the
# table and formula detection points.
#
# Enable it by swapping the import in `app/pipeline/__init__.py`:
#     from app.pipeline.chunker_with_display import chunk
# Tear it down by deleting THIS file and reverting that import back to:
#     from app.pipeline.chunker import chunk
#
# Because it is disposable, everything extra (PDF path, render scale) is
# hardcoded at module level rather than plumbed through configuration.
# =============================================================================
"""Stage 2 (DEBUG COPY): chunk the parsed document into index-ready dicts.

TEMPORARY throwaway variant of `chunker.py` that mirrors its public API and, in
later tasks, opens a blocking window drawing detected bounding box(es) over the
rendered PDF page whenever a TABLE or FORMULA chunk is detected. It will be
deleted after bbox verification (see the header comment above for enable /
teardown steps).

"""

from pathlib import Path

from docling_core.types.doc import DocItemLabel, TableItem
from docling_core.transforms.chunker import HybridChunker
from app.pipeline.chunking_helper.formula_parser import parse_formula_bbox, close_document
from functools import lru_cache
from warnings import warn

from app.pipeline.parser import ParsedDocument

_SECTION_SEPARATOR = " > "

# --- chunk sizing
MAX_CHUNK_TOKENS = 1024
# Tokenizer used only to COUNT tokens for boundary decisions (not for embedding).
# Adjust it for embeding model (Cohere embed)
CHUNK_TOKENIZER_MODEL = "BAAI/bge-m3"

# --- DEBUG-only configuration (hardcoded; ParsedDocument carries no source path)
# The PDF under inspection is hardcoded because ParsedDocument does not carry the
# source file path. Resolve it relative to THIS file so it is independent of the
# current working directory:
#   Path(__file__).resolve()   -> .../app/pipeline/chunker_with_display.py
#   .parent                    -> .../app/pipeline
#   .parent.parent             -> .../app
#   .parent.parent.parent      -> .../ingestion-service   (service root, where tests/ lives)
DEBUG_PDF_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "tests"
    / "FM_Standard_File"
    / "Tyco Hygood FM-200 Engineered Manual.pdf"
)
# PyMuPDF render zoom factor. Larger = crisper page image, bigger window.
RENDER_SCALE = 2.0
DISPLAY_Y_SCALE = 0.5  # Display-only vertical squash so the tall page fits the window; does not affect the coord transform or its tests.


def _bbox_to_canvas_rect(
    bbox: tuple[float, float, float, float],
    page_height_pts: float,
    scale: float,
    coord_origin: str,
) -> tuple[float, float, float, float]:
    """Map a Docling bbox ``(l, t, r, b)`` to a canvas pixel rect ``(x0, y0, x1, y1)``.

    Pure function — NO I/O, NO Tk, NO PyMuPDF — so it is the single unit-testable
    piece of this debug tool (Req 5.1).

    Docling's DEFAULT coordinate origin is BOTTOM-LEFT: ``t`` and ``b`` are
    measured UP from the page bottom. A Tk canvas, by contrast, has y growing
    DOWNWARD from the top. So for a bottom-left bbox we must FLIP the y axis
    against the page height ``H`` (``H - t`` / ``H - b``) before applying the
    scale (Req 5.2). A TOP-LEFT origin already matches the canvas (y-down), so no
    flip is applied (Req 5.3).

    ``page_height_pts`` (``H``) MUST be the UNSCALED page height in points
    (``page.rect.height``). Keeping it unscaled means the flip happens in
    page-point space and the trailing ``* S`` applies the render scale AFTER the
    flip, so the rectangle lines up with the pixmap rendered at ``scale``. Do NOT
    pre-scale ``H``.

    Args:
        bbox: Docling page-point coordinates ``(l, t, r, b)``.
        page_height_pts: UNSCALED page height ``H`` in points.
        scale: Render zoom ``S`` the pixmap was rendered at.
        coord_origin: Stringified coordinate origin (e.g.
            ``"CoordOrigin.BOTTOMLEFT"`` / ``"CoordOrigin.TOPLEFT"``). Detection is
            a case-insensitive ``"TOP"`` substring check; anything without ``"TOP"``
            is treated as bottom-left (Docling's default).

    Returns:
        ``(x0, y0, x1, y1)`` floats in pixmap pixel space.
    """
    l, t, r, b = bbox
    S = scale
    H = page_height_pts
    x0 = l * S
    x1 = r * S
    if "TOP" in coord_origin.upper():
        # Top-left origin: already y-down like the canvas, so no vertical flip (Req 5.3).
        y0 = t * S
        y1 = b * S
    else:
        # Bottom-left origin (Docling default): flip against the UNSCALED page
        # height, then scale (Req 5.2).
        y0 = (H - t) * S
        y1 = (H - b) * S
    return (x0, y0, x1, y1)


def _show_page_window(pixmap, rects: list[tuple], title: str) -> None:
    """Build a Tk root + Canvas showing the page image with bbox rectangles,
    then block on ``mainloop()`` until the user closes the window.

    Debug-only viewer builder (see module header). Grouped with the other debug
    helpers (`_bbox_to_canvas_rect`).

    Tk is imported lazily HERE (not at module top) so importing this module in a
    headless context (e.g. the pure Coord_Transform unit test) never requires a
    display.

    Args:
        pixmap: A PyMuPDF pixmap for the rendered page (exposes ``width``,
            ``height``, ``samples`` and ``tobytes``).
        rects: Canvas pixel rectangles ``(x0, y0, x1, y1)`` (from
            `_bbox_to_canvas_rect`) to draw over the page.
        title: Window title, e.g. ``"{chunk_id} [{kind}] page {p}"`` (Req 4.5).

    Blocks until the window is closed (Req 2.3), then returns so the caller can
    advance to the next page/chunk (Req 2.4, 3.2, 3.3).
    """
    import tkinter

    root = tkinter.Tk()
    root.title(title)  # Req 4.5

    # Display-only squash: the page is rendered at full RENDER_SCALE (crisp), but
    # it is too tall to fit the window. We shrink only the DISPLAYED height by
    # DISPLAY_Y_SCALE here — the coord transform (_bbox_to_canvas_rect) and its
    # tests are untouched. Because the shown image is squashed vertically, we must
    # squash the rect y-coordinates by the same factor below so the red boxes keep
    # tracking the content on the (now shorter) page.
    disp_w = pixmap.width
    disp_h = max(1, int(pixmap.height * DISPLAY_Y_SCALE))

    canvas = tkinter.Canvas(root, width=disp_w, height=disp_h)

    # Build the page image: Pillow-preferred, PPM fallback (Req 4.6).
    try:
        from PIL import Image, ImageTk

        img = Image.frombytes(
            "RGB", [pixmap.width, pixmap.height], pixmap.samples
        )
        # Squash to the display size (full width, half height).
        img = img.resize((disp_w, disp_h))
        photo = ImageTk.PhotoImage(img)
    except ImportError:
        photo = tkinter.PhotoImage(data=pixmap.tobytes("ppm"))
        # subsample takes INTEGERS only; this only supports integer downscale,
        # which is fine for DISPLAY_Y_SCALE = 0.5 (factor 2). Squash height only.
        factor = max(1, round(1 / DISPLAY_Y_SCALE))
        photo = photo.subsample(1, factor)

    # Keep a reference on the root so Tk does not garbage-collect the image and
    # blank the canvas.
    root._img = photo

    canvas.create_image(0, 0, anchor="nw", image=photo)

    # Draw each detected bbox as a red rectangle over the page (Req 4.4). The y
    # coords are multiplied by DISPLAY_Y_SCALE so the boxes track the vertically
    # squashed page image drawn above.
    for x0, y0, x1, y1 in rects:
        canvas.create_rectangle(
            x0, y0 * DISPLAY_Y_SCALE, x1, y1 * DISPLAY_Y_SCALE, outline="red", width=2
        )

    canvas.pack()

    # Closing the window ends the loop cleanly and returns control to the caller
    # (Req 2.4, 3.2, 3.3).
    root.protocol("WM_DELETE_WINDOW", root.destroy)

    # Blocks (pauses chunking) until the window is closed (Req 2.3).
    root.mainloop()


def _debug_show_bboxes(bboxes: list[dict], chunk_id: str, kind: str) -> None:
    """Open one blocking Debug_Viewer window per page for the given bboxes.

    Debug-only orchestrator (see module header). Grouped with the other debug
    helpers (`_bbox_to_canvas_rect`, `_show_page_window`).

    Groups the Bbox_Entry records by page and shows one window per page in
    ASCENDING page order, so a multi-page chunk is inspected in reading order
    (Req 2.1, 2.2, 3.1, 3.2, 3.3). Each entry has the shape
    ``{"page": int | None, "bbox": (l, t, r, b), "coord_origin": str}``.

    This function must NEVER raise: every failure path (missing page number,
    unopenable PDF, out-of-range page, render failure, missing display) emits a
    ``warnings.warn(...)`` and continues so the chunking pipeline is never
    crashed by the debug tool (Req 6.1, 6.2, 6.3, 6.4).

    Args:
        bboxes: Bbox_Entry records from `_detect_bboxes` / `_chunk_bbox`.
        chunk_id: Chunk id string used in the window title (Req 4.5).
        kind: Chunk kind label (e.g. ``"table"`` / ``"formula"``) for the title.
    """
    # PyMuPDF imported lazily HERE so importing this module headlessly (e.g. the
    # pure Coord_Transform unit test) does not require PyMuPDF.
    import pymupdf

    # Group entries by page in ascending order (Req 3.1). Entries with no page
    # number are warned and skipped (Req 6.3).
    pages: dict[int, list[dict]] = {}
    for entry in bboxes:
        page = entry.get("page")
        if page is None:
            warn(
                f"[debug bbox viewer] {chunk_id} [{kind}]: skipping bbox with no "
                f"page number: {entry.get('bbox')}"
            )
            continue
        pages.setdefault(page, []).append(entry)

    if not pages:
        return

    # Open DEBUG_PDF_PATH once per call. On open failure, warn and return without
    # opening any viewer (Req 6.1).
    try:
        doc = pymupdf.open(DEBUG_PDF_PATH)
    except Exception as exc:  # noqa: BLE001 - never crash the pipeline (Req 6.1)
        warn(
            f"[debug bbox viewer] {chunk_id} [{kind}]: could not open PDF "
            f"{DEBUG_PDF_PATH!s}: {exc!r}"
        )
        return

    try:
        for p in sorted(pages):  # ascending page order (Req 3.1, 3.2, 3.3)
            index = p - 1  # Docling 1-based page -> PyMuPDF 0-based index (Req 4.3)
            # Guard the page index before use (Req 6.2).
            if index < 0 or index >= doc.page_count:
                warn(
                    f"[debug bbox viewer] {chunk_id} [{kind}]: page {p} "
                    f"(index {index}) out of range for PDF with "
                    f"{doc.page_count} page(s); skipping"
                )
                continue

            # Render the page to a pixmap at RENDER_SCALE. On render failure,
            # warn and continue to the next page (Req 4.2, 6.4).
            try:
                page = doc[index]
                pixmap = page.get_pixmap(
                    matrix=pymupdf.Matrix(RENDER_SCALE, RENDER_SCALE)
                )
            except Exception as exc:  # noqa: BLE001 - never crash (Req 6.4)
                warn(
                    f"[debug bbox viewer] {chunk_id} [{kind}]: failed to render "
                    f"page {p}: {exc!r}; skipping"
                )
                continue

            # H is the UNSCALED page height in points; the transform applies the
            # scale AFTER the flip so rectangles line up with the pixmap (Req 5).
            H = page.rect.height
            rects = [
                _bbox_to_canvas_rect(
                    entry["bbox"], H, RENDER_SCALE, entry["coord_origin"]
                )
                for entry in pages[p]
            ]

            # Blocks until the window is closed, then advances to the next page
            # (Req 2.3, 2.4, 3.2, 3.3). Wrapped so a missing display (headless)
            # warns rather than crashes.
            try:
                _show_page_window(
                    pixmap, rects, title=f"{chunk_id} [{kind}] page {p}"
                )
            except Exception as exc:  # noqa: BLE001 - never crash (Req 6)
                warn(
                    f"[debug bbox viewer] {chunk_id} [{kind}]: could not open "
                    f"viewer for page {p}: {exc!r}; skipping"
                )
                continue
    finally:
        doc.close()


def _has_formula_chunk(dl_chunk) -> bool:
    """True if a chunk is derived (wholly or partly) from a formula.

    Docking's enriched_formula detection slows down run on pages even without formula. Extract out bbox and extract separately with a dedicated tool instead.
    """
    
    has_formula = any(
        item.label == DocItemLabel.FORMULA
        for item in dl_chunk.meta.doc_items
    )
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
                    "l": bbox.l, "t": bbox.t, "r": bbox.r, "b": bbox.b,
                    "coord_origin": origin,
                }
            else:
                # Accumulate the union of all bboxes on this page. All bboxes should have the same origin.
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
    mid-row, which destroys row/column/header associations. Extract out the table with a dedicated tool (IN-03) instead of keeping the mangled text.
    """
    
    is_table = any(
        item.label == DocItemLabel.TABLE
        for item in dl_chunk.meta.doc_items
    )
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
        # Chroma requires scalar values: serialise the list-valued heading trail.
        "section_path": _SECTION_SEPARATOR.join(headings),
    }
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

def _extract_formula_chunk(chunk_bboxes: list[dict], file_path: str) -> dict | None:
    """Extract a formula chunk into one index-ready chunk — not yet implemented.

    Runs IN SERIES the moment a formula chunk is detected

    When implemented: convert the bbox from Docling's bottom-left origin to the
    crop tool's convention (using page height), crop, decode the formula, and
    return one {"id", "text", "metadata"} chunk (reuse `_build_metadata`).
    """
    text = parse_formula_bbox(
        bbox=chunk_bboxes[0]["bbox"],
        page=chunk_bboxes[0]["page"],
        file_path=file_path,
        coord_origin=chunk_bboxes[0]["coord_origin"],
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



def chunk(parsed: ParsedDocument, doc_path:str | None = None, doc_id: str | None = None) -> list[dict]:
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
            table_bboxes = _detect_bboxes(TableItem, dl_chunk)  # bbox(es) to use with pdfplumber later
            _debug_show_bboxes(table_bboxes, f"{resolved_doc_id}:table:{n}", "table")  # TEMPORARY debug call — remove with this file
            table_chunk = _extract_table_chunk(
                table_bboxes, resolved_doc_id, f"{resolved_doc_id}:table:{n}", dl_chunk.meta
            )
            if table_chunk is not None:
                chunks.append(table_chunk)
            else:
                warn("Table extraction and chunking not implemented yet")
            continue
        elif _has_formula_chunk(dl_chunk):
            # With formula enrichment OFF, formula text gets replaced with <!-- formula-not-decoded -->
            # formula process in series (appended in reading order when done).
            formula_bboxes = _chunk_bbox(dl_chunk)
            _debug_show_bboxes(formula_bboxes, f"{resolved_doc_id}:formula:{n}", "formula")  # TEMPORARY debug call — remove with this file
            formula_chunk = _extract_formula_chunk(
                formula_bboxes, doc_path
            )
            if formula_chunk is not None:
                chunks.append(formula_chunk)
            else:
                warn("Formula extraction and chunking not implemented yet")
            continue
        

        chunks.append(
            {
                "id": f"{resolved_doc_id}:{n}",
                "text": text,
                "metadata": _build_metadata(dl_chunk.meta, resolved_doc_id),
            }
        )
    close_document()
    return chunks

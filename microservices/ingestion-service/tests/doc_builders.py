"""Build real `DoclingDocument`s for chunker tests, and chunk them.

Uses docling-core's public API (pages, headings, text, captions, tables and
pictures with provenance), so tests see what HybridChunker really hands the
chunker: plain DocItems that keep only label, self_ref and prov. Duck-typed
fakes carry `.text` and captions the real chunks do not.
"""

from docling_core.types.doc import (
    BoundingBox,
    CoordOrigin,
    DocItemLabel,
    DoclingDocument,
    ProvenanceItem,
    Size,
    TableCell,
    TableData,
)

from app.pipeline import chunker
from app.pipeline.parser import ParsedDocument

DOC_PATH = "unused.pdf"  # OCR readers are faked, so no PDF is opened


def prov(page, left, top, right, bottom):
    bbox = BoundingBox(l=left, t=top, r=right, b=bottom, coord_origin=CoordOrigin.BOTTOMLEFT)
    return ProvenanceItem(page_no=page, bbox=bbox, charspan=(0, 0))


def document(pages=1):
    doc = DoclingDocument(name="report")
    for page in range(1, pages + 1):
        doc.add_page(page_no=page, size=Size(width=300, height=400))
    return doc


def _caption(doc, text, box, page):
    """A caption item just under `box` (bottom-left origin)."""
    return doc.add_text(
        DocItemLabel.CAPTION, text, prov=prov(page, box[0], box[3] - 2, box[2], box[3] - 12)
    )


def picture(doc, box, caption=None, page=1):
    caption_item = _caption(doc, caption, box, page) if caption else None
    return doc.add_picture(caption=caption_item, prov=prov(page, *box))


def table(doc, box, page=1, caption=None):
    """A 2 x 2 table: headings Agent, Qty; one row FM-200, 2."""
    data = TableData(
        num_rows=2,
        num_cols=2,
        table_cells=[
            TableCell(
                text=text,
                start_row_offset_idx=row,
                end_row_offset_idx=row + 1,
                start_col_offset_idx=col,
                end_col_offset_idx=col + 1,
                column_header=row == 0,
            )
            for row, col, text in [(0, 0, "Agent"), (0, 1, "Qty"), (1, 0, "FM-200"), (1, 1, "2")]
        ],
    )
    caption_item = _caption(doc, caption, box, page) if caption else None
    return doc.add_table(data=data, caption=caption_item, prov=prov(page, *box))


def chunk_document(doc):
    parsed = ParsedDocument(doc_name="report", docling_document=doc, page_count=len(doc.pages))
    return chunker.chunk(parsed, doc_path=DOC_PATH, doc_id="report")

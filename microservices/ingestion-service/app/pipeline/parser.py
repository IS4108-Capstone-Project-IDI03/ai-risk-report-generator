"""Stage 1: parse a raw document into structured content.

Docling is the sole parser. It converts a document into a `DoclingDocument`
whose items we iterate in reading order, splitting them by type:

- text  -> `TextBlock`s that continue through the pipeline (anonymise -> chunk
  -> embed). Each block keeps its heading `section_path` and PDF `page`
  (IN-02: section structure + source page location).
- tables -> captured with page/section and passed through unprocessed (Todo for later stories).
- images -> captured with page/section and passed through unprocessed (Todo for later stories).

If Docling cannot parse the document we raise `UnparsableDocumentError`, which a
later OCR extraction path can catch (Todo for later stories).
"""

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from docling.datamodel.base_models import ConversionStatus, InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import (
    DocItemLabel,
    DoclingDocument,
    PictureItem,
    SectionHeaderItem,
    TableItem,
    TextItem,
    TitleItem,
)

from app.pipeline.errors import UnparsableDocumentError

# Labels whose text is body content we want to keep and chunk. Page
# headers/footers and captions are deliberately excluded from body text.
_BODY_TEXT_LABELS = {
    DocItemLabel.TEXT,
    DocItemLabel.PARAGRAPH,
    DocItemLabel.LIST_ITEM,
    DocItemLabel.CODE,
    DocItemLabel.FORMULA,
}


@dataclass
class TextBlock:
    """A single run of body text with its provenance."""

    text: str
    section_path: list[str]
    page: int | None
    order: int


@dataclass
class CapturedItem:
    """ For tables and images"""
    kind: str  # "table" | "image"
    page: int | None
    section_path: list[str]
    caption: str
    order: int


@dataclass
class ParsedDocument:
    """Structured result of parsing one document.

    `docling_document` is the raw Docling document, exposed so the chunker can
    run Docling's native (token-aware, heading-carrying) chunking over it. The
    derived `text_blocks` / `tables` / `images` remain available for callers
    that want the flattened, provenance-tagged view.
    """

    doc_name: str
    docling_document: DoclingDocument | None = None
    text_blocks: list[TextBlock] = field(default_factory=list)
    tables: list[CapturedItem] = field(default_factory=list)
    images: list[CapturedItem] = field(default_factory=list)


def _page_count(source: Path) -> int | None:
    """True page count of a PDF via PyMuPDF, or None if it can't be read.

    Used only to validate a caller-supplied ``page_range`` against the real
    document size. Returning None on failure lets a genuinely broken file fall
    through to Docling's own error handling instead of failing here.
    """
    try:
        import pymupdf

        with pymupdf.open(source) as pdf:
            return pdf.page_count
    except Exception:
        return None


def _page_of(item) -> int | None:
    """First provenance page number for an item, if any."""
    prov = getattr(item, "prov", None)
    if prov:
        return prov[0].page_no
    return None


def _caption_of(item, doc) -> str:
    """Best-effort caption text for a table/image, empty if none."""
    text = getattr(item, "caption_text", None)
    if callable(text):
        try:
            return text(doc) or ""
        except Exception:
            return ""
    return ""


def _update_section_stack(stack: list[tuple[int, str]], level: int, text: str) -> None:
    """Maintain a heading stack keyed by level so text can record its path.

    A heading at level N replaces any deeper-or-equal headings, then is pushed,
    so the stack always reflects the active heading ancestry.
    """
    while stack and stack[-1][0] >= level:
        stack.pop()
    stack.append((level, text))


def _extract_text_blocks(doc) -> tuple[list[TextBlock], list[CapturedItem], list[CapturedItem]]:
    """Route document items into text blocks, tables, and images."""
    text_blocks: list[TextBlock] = []
    tables: list[CapturedItem] = []
    images: list[CapturedItem] = []
    # Heading ancestry as (level, text); title sits at level 0.
    section_stack: list[tuple[int, str]] = []
    order = 0

    for item, _tree_level in doc.iterate_items(with_groups=False):
        order += 1
        label = getattr(item, "label", None)
        section_path = [text for _lvl, text in section_stack]

        if isinstance(item, TitleItem) or label == DocItemLabel.TITLE:
            _update_section_stack(section_stack, 0, item.text)
        elif isinstance(item, SectionHeaderItem) or label == DocItemLabel.SECTION_HEADER:
            # SectionHeaderItem.level is 1-based; keep it above the title's 0.
            level = getattr(item, "level", 1) or 1
            _update_section_stack(section_stack, level, item.text)
        elif isinstance(item, TableItem) or label == DocItemLabel.TABLE:
            # Passed through unprocessed — real table handling is future work.
            tables.append(
                CapturedItem(
                    kind="table",
                    page=_page_of(item),
                    section_path=section_path,
                    caption=_caption_of(item, doc),
                    order=order,
                )
            )
        elif isinstance(item, PictureItem) or label == DocItemLabel.PICTURE:
            # Passed through unprocessed — real figure handling is future work.
            images.append(
                CapturedItem(
                    kind="image",
                    page=_page_of(item),
                    section_path=section_path,
                    caption=_caption_of(item, doc),
                    order=order,
                )
            )
        elif isinstance(item, TextItem) and label in _BODY_TEXT_LABELS:
            text = (item.text or "").strip()
            if text:
                text_blocks.append(
                    TextBlock(
                        text=text,
                        section_path=section_path,
                        page=_page_of(item),
                        order=order,
                    )
                )
        # Everything else (page headers/footers, captions, key-value regions,
        # etc.) is ignored for body text on purpose.

    return text_blocks, tables, images


def _fallback_extract(file_path: str) -> tuple[list[CapturedItem], list[CapturedItem]]:
    """PyMuPDF fallback for tables/images Docling could not extract.

    Only intended for the case where Docling parses the text but misses tables
    or figures that clearly exist. Not needed for the current fixture, so it is
    an explicit, unimplemented hook rather than silent behaviour.
    """
    raise NotImplementedError(
        "PyMuPDF table/image fallback is not implemented yet"
    )


# Bound a single document's processing time so a pathological file cannot hang
# the pipeline indefinitely (seconds).
_DOCUMENT_TIMEOUT_SECONDS = 600.0


@lru_cache(maxsize=1)
def _converter() -> DocumentConverter:
    """Build (once) the Docling converter with a text-layer-first PDF pipeline.

    Cached so the layout/table models are loaded a single time per process and
    reused across documents, instead of being reloaded on every parse. Building
    it here (rather than inside `parse`) also means environment/model-init
    failures surface as themselves rather than being mistaken for an unparsable
    document — only failures while processing a specific document become
    `UnparsableDocumentError`.

    OCR is disabled on purpose: engineered reports/standards ship with a real
    text layer, and OCR is by far the most expensive stage (it can turn a parse
    into tens of minutes on CPU). A page with no extractable text simply yields
    no text here — that is exactly the "needs OCR later" case that is out of
    scope for now. Table-structure detection stays on so tables are still
    separated out (IN-02), and a per-document timeout bounds the worst case.
    """
    pipeline_options = PdfPipelineOptions(
        do_ocr=False,
        do_table_structure=True,
        document_timeout=_DOCUMENT_TIMEOUT_SECONDS,
    )
    return DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )


def parse(
    file_path: str, page_range: tuple[int, int] | None = None
) -> ParsedDocument:
    """Parse a document into structured text blocks plus captured tables/images.

    Args:
        file_path: path to the document to parse.
        page_range: optional 1-based, inclusive ``(start, end)`` page window to
            parse instead of the whole document. Useful for fast smoke parses.
            ``start`` must be >= 1 and ``end`` must be greater than ``start``;
            ``end`` must also fall within the document's page count.

    Raises:
        ValueError: if ``page_range`` is malformed (start < 1 or end <= start)
            or falls outside the document's page count.
        UnparsableDocumentError: if Docling could not extract the document
            (bad/corrupt/empty content). Carries the source path so a later OCR
            path can pick it up. Environment/model-init errors are NOT wrapped;
            they propagate as-is.
    """
    source = Path(file_path)

    convert_kwargs: dict = {"raises_on_error": False}
    if page_range is not None:
        start, end = page_range
        if start < 1 or end <= start:
            raise ValueError(
                f"page_range must satisfy start >= 1 and end > start, got {page_range}"
            )
        page_count = _page_count(source)
        if page_count is not None and end > page_count:
            raise ValueError(
                f"page_range end {end} exceeds document page count {page_count}"
            )
        convert_kwargs["page_range"] = (start, end)

    # raises_on_error=False so a per-document failure comes back as a status we
    # can classify, instead of an exception we would have to distinguish from
    # pipeline init errors.
    result = _converter().convert(source, **convert_kwargs)

    if result.status in (ConversionStatus.FAILURE, ConversionStatus.SKIPPED):
        raise UnparsableDocumentError(
            str(file_path), f"Docling could not extract the document (status={result.status.value})"
        )

    doc = getattr(result, "document", None)
    if doc is None:
        raise UnparsableDocumentError(str(file_path), "Docling returned no document")

    text_blocks, tables, images = _extract_text_blocks(doc)

    if not text_blocks and not tables and not images:
        raise UnparsableDocumentError(
            str(file_path), "Docling produced no extractable content"
        )

    return ParsedDocument(
        doc_name=source.name,
        docling_document=doc,
        text_blocks=text_blocks,
        tables=tables,
        images=images,
    )

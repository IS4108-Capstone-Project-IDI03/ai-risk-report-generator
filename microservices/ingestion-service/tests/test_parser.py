"""Parser contract against the real FM-200 fixture (IN-02).

Docling conversion is slow (model load + CPU inference), so the fixture PDF is
parsed once per module and shared across the structural assertions. Fast tests
that don't need conversion (error path, section-stack logic) run separately.
"""

import pytest
from test_file_option import get_fixture

from app.pipeline.errors import UnparsableDocumentError
from app.pipeline.parser import (
    CapturedItem,
    ParsedDocument,
    TextBlock,
    _update_section_stack,
    parse,
)

FIXTURE = get_fixture()

# Docling runs vision models on CPU per page, so parsing the whole manual takes
# minutes on every run. The default structural tests only need a representative
# slice, so pick a small (start, end) 1-based inclusive window here. Choose a
# range that contains real headings, body text, and ideally a table/figure.
# The full-document parse still runs in the opt-in `slow` test below.
TEST_PAGE_RANGE: tuple[int, int] = (45, 55)


def _parse_fixture(page_range: tuple[int, int] | None) -> ParsedDocument:
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing: {FIXTURE}")
    try:
        return parse(str(FIXTURE), page_range=page_range)
    except UnparsableDocumentError:
        # A real extraction failure is a genuine parser problem — surface it.
        raise
    except Exception as exc:  # noqa: BLE001
        # Docling needs ML model weights it fetches from Hugging Face on first
        # use. Where those can't be downloaded (offline/proxy/cert-blocked CI),
        # skip the conversion-dependent assertions rather than reporting a
        # false failure. These run for real wherever the models are available.
        pytest.skip(
            f"Docling models unavailable in this environment: {exc}.\n"
            "Please resolve the error to try downloading again"
        )


@pytest.fixture(scope="module")
def parsed() -> ParsedDocument:
    # Fast: only the TEST_PAGE_RANGE slice is parsed.
    return _parse_fixture(TEST_PAGE_RANGE)


# --- fast tests (no Docling conversion) ---------------------------------------


def test_unparsable_file_raises_with_source(tmp_path):
    bogus = tmp_path / "not-a-real.pdf"
    bogus.write_bytes(b"%PDF-1.4 this is not a valid pdf body")
    with pytest.raises(UnparsableDocumentError) as excinfo:
        parse(str(bogus))
    assert excinfo.value.source == str(bogus)


def test_section_stack_nests_and_truncates():
    stack: list[tuple[int, str]] = []
    _update_section_stack(stack, 0, "Title")
    _update_section_stack(stack, 1, "Section A")
    _update_section_stack(stack, 2, "Sub A.1")
    assert [t for _l, t in stack] == ["Title", "Section A", "Sub A.1"]

    # A new level-1 heading drops the deeper sub-heading and the sibling section.
    _update_section_stack(stack, 1, "Section B")
    assert [t for _l, t in stack] == ["Title", "Section B"]


@pytest.mark.parametrize("bad_range", [(0, 3), (1, 1), (3, 2), (-1, 2)])
def test_page_range_rejects_malformed_bounds(bad_range):
    # start >= 1 and end > start are validated up front, before conversion.
    with pytest.raises(ValueError):
        parse(str(FIXTURE), page_range=bad_range)


@pytest.mark.model
def test_page_range_rejects_out_of_document_bounds():
    # end must fall within the real document page count (read via PyMuPDF).
    if not FIXTURE.exists():
        pytest.skip(f"fixture missing: {FIXTURE}")
    with pytest.raises(ValueError, match="exceeds document page count"):
        parse(str(FIXTURE), page_range=(1, 10_000))


# --- structural tests against the real fixture --------------------------------


@pytest.mark.model
def test_produces_text_blocks(parsed):
    assert parsed.text_blocks, "expected at least one text block from the manual"
    assert all(isinstance(b, TextBlock) for b in parsed.text_blocks)
    assert all(b.text.strip() for b in parsed.text_blocks)


@pytest.mark.model
def test_every_text_block_has_section_path_and_page(parsed):
    # IN-02 (1): section path present (list, may be empty before first heading).
    # IN-02 (2): source PDF page number present.
    for block in parsed.text_blocks:
        assert isinstance(block.section_path, list)
        assert isinstance(block.page, int)
        assert block.page >= 1


@pytest.mark.model
def test_some_text_blocks_carry_a_heading_path(parsed):
    # The manual has headings, so at least some blocks should sit under one.
    assert any(block.section_path for block in parsed.text_blocks)


@pytest.mark.model
def test_reading_order_preserved(parsed):
    # IN-02 (3): original positions retained as a monotonic order index.
    orders = [block.order for block in parsed.text_blocks]
    assert orders == sorted(orders)
    assert len(set(orders)) == len(orders)


@pytest.mark.model
def test_tables_and_images_separated_and_unprocessed(parsed):
    # Tables/images are captured on their own streams, never mixed into text.
    for item in parsed.tables:
        assert isinstance(item, CapturedItem)
        assert item.kind == "table"
    for item in parsed.images:
        assert isinstance(item, CapturedItem)
        assert item.kind == "image"
    captured_orders = {i.order for i in parsed.tables} | {i.order for i in parsed.images}
    text_orders = {b.order for b in parsed.text_blocks}
    assert captured_orders.isdisjoint(text_orders)


@pytest.mark.model
def test_doc_name_is_fixture_filename(parsed):
    assert parsed.doc_name == FIXTURE.name


# --- opt-in full-document parse (slow) ----------------------------------------


@pytest.mark.slow
@pytest.mark.model
def test_full_document_parse():
    """Parse the entire manual, not just the TEST_PAGE_RANGE slice.

    Slow (minutes on CPU); opt in with `-m slow`. Verifies the same IN-02
    guarantees hold across the whole document.
    """
    doc = _parse_fixture(None)
    assert doc.text_blocks
    for block in doc.text_blocks:
        assert isinstance(block.section_path, list)
        assert isinstance(block.page, int) and block.page >= 1
    orders = [b.order for b in doc.text_blocks]
    assert orders == sorted(orders)
    assert len(set(orders)) == len(orders)


# --- parse timeout (IN-12) ----------------------------------------------------
# On a 2-vCPU cloud box a large standard parses for well over the old 600 s.


def _pdf_timeout(monkeypatch, value):
    from docling.datamodel.base_models import InputFormat

    from app.pipeline import parser

    if value is None:
        monkeypatch.delenv("DOCLING_DOCUMENT_TIMEOUT", raising=False)
    else:
        monkeypatch.setenv("DOCLING_DOCUMENT_TIMEOUT", value)
    parser._converter.cache_clear()
    try:
        options = parser._converter().format_to_options[InputFormat.PDF].pipeline_options
        return options.document_timeout
    finally:
        parser._converter.cache_clear()


def test_parse_timeout_defaults_to_thirty_minutes(monkeypatch):
    assert _pdf_timeout(monkeypatch, None) == 1800.0


def test_parse_timeout_comes_from_docling_document_timeout(monkeypatch):
    assert _pdf_timeout(monkeypatch, "2400") == 2400.0


# --- a parse that runs out of time fails (IN-12) ------------------------------
# Docling stops at document_timeout and returns the pages it finished as
# PARTIAL_SUCCESS. Indexing that would leave the rest of the standard out of
# search while the upload shows Complete.


def test_a_parse_that_runs_out_of_time_fails_instead_of_indexing_part_of_it(monkeypatch):
    from types import SimpleNamespace

    from docling.datamodel.base_models import ConversionStatus, ErrorItem
    from docling_core.types.doc import DoclingDocument

    from app.pipeline import parser
    from app.pipeline.errors import DocumentTimeoutError

    try:
        from docling.datamodel.base_models import DoclingComponentType, FailureCategory
    except ImportError:  # older layout
        from docling.datamodel.base_models import DoclingComponentType
        from docling.datamodel.document import FailureCategory

    timed_out = SimpleNamespace(
        status=ConversionStatus.PARTIAL_SUCCESS,
        document=DoclingDocument(name="manual"),
        errors=[
            ErrorItem(
                component_type=DoclingComponentType.PIPELINE,
                module_name="StandardPdfPipeline",
                error_message="Pipeline stage timeout: processed 40/120 pages successfully",
                category=FailureCategory.TIMEOUT,
            )
        ],
    )
    monkeypatch.setattr(
        parser, "_converter", lambda: SimpleNamespace(convert=lambda *a, **k: timed_out)
    )

    with pytest.raises(DocumentTimeoutError, match="40/120"):
        parser.parse(str(FIXTURE))


# --- batched parsing: 20 pages per convert call -------------------------------
# A fake converter stands in for Docling's models: each call returns a
# DoclingDocument holding one paragraph on the first page of the requested range.


def _blank_pdf(tmp_path, pages: int, bookmarks=None) -> str:
    """A blank PDF, optionally with bookmarks as pymupdf [level, title, page] rows."""
    import pymupdf

    path = tmp_path / f"blank-{pages}.pdf"
    with pymupdf.open() as pdf:
        for _ in range(pages):
            pdf.new_page()
        if bookmarks:
            pdf.set_toc(bookmarks)
        pdf.save(path)
    return str(path)


def _batch_document(start: int, end: int, failed_pages=frozenset(), headings=None):
    """A batch's document: its pages (less any that failed), any `headings`
    ({page: text}) in its range as level-1 section headers, as Docling gives
    them with heading levels off, and one paragraph on its first page that
    didn't fail."""
    from docling_core.types.doc import (
        BoundingBox,
        DocItemLabel,
        DoclingDocument,
        ProvenanceItem,
        Size,
    )

    doc = DoclingDocument(name="blank")
    kept = [n for n in range(start, end + 1) if n not in failed_pages]
    for page_no in kept:
        doc.add_page(page_no=page_no, size=Size(width=612, height=792))
    for page_no, heading in sorted((headings or {}).items()):
        if page_no in kept:
            doc.add_heading(
                text=heading,
                level=1,
                prov=ProvenanceItem(
                    page_no=page_no,
                    bbox=BoundingBox(l=72, t=40, r=540, b=60),
                    charspan=(0, len(heading)),
                ),
            )
    text = f"Paragraph from page {kept[0]}"
    doc.add_text(
        label=DocItemLabel.PARAGRAPH,
        text=text,
        prov=ProvenanceItem(
            page_no=kept[0],
            bbox=BoundingBox(l=72, t=72, r=540, b=100),
            charspan=(0, len(text)),
        ),
    )
    return doc


class _FakeConverter:
    def __init__(self, failed_pages=frozenset(), headings=None, timed_out_batch=None) -> None:
        self.page_ranges: list[tuple[int, int]] = []
        self.failed_pages = failed_pages
        self.headings = headings
        self.timed_out_batch = timed_out_batch

    def convert(self, source, page_range=None, **kwargs):
        from types import SimpleNamespace

        from docling.datamodel.base_models import (
            ConversionStatus,
            DoclingComponentType,
            ErrorItem,
            FailureCategory,
        )

        self.page_ranges.append(page_range)
        if page_range == self.timed_out_batch:
            return SimpleNamespace(
                status=ConversionStatus.PARTIAL_SUCCESS,
                document=_batch_document(*page_range),
                errors=[
                    ErrorItem(
                        component_type=DoclingComponentType.PIPELINE,
                        module_name="StandardPdfPipeline",
                        error_message="Pipeline stage timeout: processed 12/20 pages successfully",
                        category=FailureCategory.TIMEOUT,
                    )
                ],
                pages=[],
            )
        return SimpleNamespace(
            status=ConversionStatus.SUCCESS,
            document=_batch_document(*page_range, self.failed_pages, self.headings),
            errors=[],
            pages=[],
        )


@pytest.fixture
def fake_converter(monkeypatch):
    from app.pipeline import parser

    converter = _FakeConverter()
    monkeypatch.setattr(parser, "_converter", lambda: converter)
    return converter


def test_a_long_document_is_converted_twenty_pages_at_a_time(tmp_path, fake_converter):
    result = parse(_blank_pdf(tmp_path, 45))

    assert fake_converter.page_ranges == [(1, 20), (21, 40), (41, 45)]
    assert [(b.text, b.page) for b in result.text_blocks] == [
        ("Paragraph from page 1", 1),
        ("Paragraph from page 21", 21),
        ("Paragraph from page 41", 41),
    ]


@pytest.mark.parametrize(
    ("pages", "expected_batches"),
    [
        (7, [(1, 7)]),
        (1, [(1, 1)]),
        (20, [(1, 20)]),
        (41, [(1, 20), (21, 40), (41, 41)]),
    ],
)
def test_short_documents_and_single_page_tails_are_converted(
    tmp_path, fake_converter, pages, expected_batches
):
    result = parse(_blank_pdf(tmp_path, pages))

    assert fake_converter.page_ranges == expected_batches
    assert result.page_count == pages


class _PageRecorder:
    def __init__(self) -> None:
        self.pages: list[tuple[int, int | None]] = []

    def update_pages(self, current: int, total: int | None) -> None:
        self.pages.append((current, total))


@pytest.mark.parametrize(
    ("pages", "expected_updates"),
    [
        (45, [(20, 45), (40, 45), (45, 45)]),
        (7, [(7, 7)]),
    ],
)
def test_pages_parsed_are_reported_after_each_batch(
    tmp_path, fake_converter, pages, expected_updates
):
    reporter = _PageRecorder()

    parse(_blank_pdf(tmp_path, pages), reporter=reporter)

    assert reporter.pages == expected_updates


def test_a_stop_requested_during_parsing_ends_it_after_the_current_batch(tmp_path, fake_converter):
    from app.pipeline.progress import IngestionCancelledError

    class _StopRequested:
        def update_pages(self, current, total):
            raise IngestionCancelledError()

    with pytest.raises(IngestionCancelledError):
        parse(_blank_pdf(tmp_path, 45), reporter=_StopRequested())

    assert fake_converter.page_ranges == [(1, 20)]


def test_a_batch_that_runs_out_of_time_fails_the_parse_without_converting_the_rest(
    tmp_path, monkeypatch
):
    from app.pipeline import parser
    from app.pipeline.errors import DocumentTimeoutError

    converter = _FakeConverter(timed_out_batch=(21, 40))
    monkeypatch.setattr(parser, "_converter", lambda: converter)

    with pytest.raises(DocumentTimeoutError, match="12/20"):
        parse(_blank_pdf(tmp_path, 45))

    assert converter.page_ranges == [(1, 20), (21, 40)]


def test_a_page_failing_at_a_batch_edge_does_not_renumber_later_pages(tmp_path, monkeypatch):
    from app.pipeline import parser

    # Docling leaves a failed page out of the batch's document: here page 21,
    # the first page of the second batch, and page 40, the last.
    converter = _FakeConverter(failed_pages={21, 40})
    monkeypatch.setattr(parser, "_converter", lambda: converter)

    result = parse(_blank_pdf(tmp_path, 45))

    assert [(b.text, b.page) for b in result.text_blocks] == [
        ("Paragraph from page 1", 1),
        ("Paragraph from page 22", 22),
        ("Paragraph from page 41", 41),
    ]
    assert sorted(result.docling_document.pages) == [n for n in range(1, 46)]


def test_a_page_range_not_starting_at_page_one_keeps_its_page_numbers(tmp_path, fake_converter):
    result = parse(_blank_pdf(tmp_path, 80), page_range=(45, 70))

    assert fake_converter.page_ranges == [(45, 64), (65, 70)]
    assert [(b.text, b.page) for b in result.text_blocks] == [
        ("Paragraph from page 45", 45),
        ("Paragraph from page 65", 65),
    ]


def test_heading_levels_are_assigned_across_batches_from_the_pdf_bookmarks(tmp_path, monkeypatch):
    from docling_core.types.doc import SectionHeaderItem

    from app.pipeline import parser

    # "Section A.1" (page 25, second batch) sits under "Chapter A" (page 1,
    # first batch) in the PDF's bookmarks.
    pdf = _blank_pdf(tmp_path, 45, bookmarks=[[1, "Chapter A", 1], [2, "Section A.1", 25]])
    converter = _FakeConverter(headings={1: "Chapter A", 25: "Section A.1"})
    monkeypatch.setattr(parser, "_converter", lambda: converter)

    result = parse(pdf)

    headings = [
        (item.text, item.level)
        for item in result.docling_document.texts
        if isinstance(item, SectionHeaderItem)
    ]
    assert headings == [("Chapter A", 1), ("Section A.1", 2)]


@pytest.mark.slow
@pytest.mark.model
def test_batched_heading_levels_match_a_single_conversion_of_the_real_manual():
    """Pages 15-45 parse as two batches (15-34, 35-45); their headings must
    come out as one convert call with Docling's own heading pass gives them."""
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc import SectionHeaderItem

    from app.pipeline import parser

    def headings(doc):
        return [
            (item.text, item.level, item.prov[0].page_no if item.prov else None)
            for item in doc.texts
            if isinstance(item, SectionHeaderItem)
        ]

    page_range = (15, 45)
    batched = _parse_fixture(page_range)

    options = parser._converter().format_to_options[InputFormat.PDF].pipeline_options
    single_options = options.model_copy(
        update={"heading_hierarchy_options": parser._HEADING_OPTIONS}
    )
    single = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=single_options)}
    ).convert(str(FIXTURE), page_range=page_range)

    assert headings(batched.docling_document), "expected headings in pages 15-45"
    assert headings(batched.docling_document) == headings(single.document)

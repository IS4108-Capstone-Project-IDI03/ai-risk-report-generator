"""Ingestion pipeline orchestrator.

`run(file_path)` chains the stages for one document:

    [redact] -> parse -> (tables/images branched aside) -> chunk -> anonymise -> index

A past report is redacted first when protection is on (PV-05): parsing, chunking, the OCR crops
(rendered from the PDF), embedding and storage then all read tags instead of client details.

and returns a summary. `index_chunks` embeds each chunk (Cohere) and upserts it
to Chroma, so embedding happens inside the index step, not as a separate stage.

Execution model: `run()` is synchronous and self-contained. It takes a file
path, returns a summary on success, and raises on failure (e.g.
`UnparsableDocumentError`). It does not depend on request/response objects or
global state.

NOTE (future work): a full parse is CPU-bound and can take minutes, so this must
not be run inline in an HTTP request. Today a direct caller (CLI/batch/test)
invokes `run()` and waits. Later, `/ingest` can hand `run()` to a background
worker or task queue and return "queued" immediately, adding job-status
tracking. That change wraps `run()` unchanged — keep it free of web/framework
dependencies so a worker can call it exactly as a CLI does.
"""

import sys
import tempfile
from pathlib import Path

from app.labelling.config import STANDARDS
from app.pipeline import sections as report
from app.pipeline.anonymiser import anonymise
from app.pipeline.errors import UnparsableDocumentError
from app.pipeline.indexer import index_chunks
from app.pipeline.progress import IngestionCancelledError, NoOpReporter
from app.pipeline.redactor import redact_pdf
from app.privacy import session

__all__ = [
    "run",
    "parse",
    "chunk",
    "anonymise",
    "index_chunks",
    "UnparsableDocumentError",
    "IngestionCancelledError",
    "NoOpReporter",
]


def _check_cancelled(reporter) -> None:
    check = getattr(reporter, "check_cancelled", None)
    if check:
        check()


# `parse` and `chunk` live in modules instead of global import
# Resolving them as package attributes (rather than local imports inside `run()`)
# keeps them patchable via `monkeypatch.setattr(pipeline, "parse", ...)`, which
# the orchestrator wiring tests rely on.
def __getattr__(name: str):
    if name == "parse":
        from app.pipeline.parser import parse

        return parse
    if name == "chunk":
        from app.pipeline.chunker import chunk

        return chunk
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def run(
    file_path: str,
    page_range: tuple[int, int] | None = None,
    doc_id: str | None = None,
    labels: dict | None = None,
    reporter=None,
    privacy: dict | None = None,
) -> dict:
    """Ingest one document end to end and return a summary.

    Args:
        file_path: path to the document to ingest.
        page_range: 1-based inclusive ``(start, end)`` page window,
            forwarded to the parser (useful for smoke runs).
        doc_id: the document's permanent id, so chunk ids are
            ``f"{doc_id}:{n}"`` and never collide across documents.
            Defaults to the file name.
        labels: the document's labels (source type, country, facility type,
            effective date, status; a key is absent when Unconfirmed), added to
            every chunk's metadata so search can filter on them (KB-01). Each
            chunk also gets its own report section from where it sits in the
            PDF (IN-05).
        reporter: an optional ProgressReporter (E2) that records each stage
            transition to MongoDB. When omitted, a NoOpReporter is used so the
            stage calls below need no guards. On failure, run() re-raises
            without calling finish(); the worker's except block records the
            failed stage.
        privacy: the gateway's `{enabled, known_entities, detect?}` (the epic's Rule 1). When
            enabled, a document that is not a standard is redacted before parsing (PV-05);
            standards are public.

    Returns:
        A summary dict::

            {
                "doc_name": str,
                "chunks_indexed": int,
                "tables_captured": int,
                "images_captured": int,
                "privacy": {"enabled": bool, "masked_count": int},
                "mapping": dict,  # tag -> the detail it replaced; empty when not redacted
            }

    Raises:
        UnparsableDocumentError: if the document could not be parsed. Propagated
            so a caller (or future OCR fallback) can react.
    """
    # Resolve `parse`/`chunk` through this module so the lazy `__getattr__`
    # above supplies the real (Docling-backed) implementations on first use
    # Allow module object to act as a class
    this = sys.modules[__name__]

    # A no-op sentinel so stage calls need no `if reporter:` guards.
    _reporter = reporter or NoOpReporter()

    labels = labels or {}
    protection = session(privacy)
    with tempfile.TemporaryDirectory() as tmp:
        source, mapping = file_path, {}
        # A standard is public; anything else (a report, or a type still Unconfirmed) is redacted.
        if protection.enabled and labels.get("source_type") not in STANDARDS:
            _check_cancelled(_reporter)
            _reporter.start_stage("anonymising")
            redacted, mapping = redact_pdf(Path(file_path).read_bytes(), protection)
            # Same file name: the parser reports it as the document's name.
            source = str(Path(tmp) / Path(file_path).name)
            Path(source).write_bytes(redacted)
        summary = _parse_to_index(this, source, file_path, page_range, doc_id, labels, _reporter)
    _reporter.finish()

    # Whether this document was protected: a standard is not, even with protection on.
    privacy_record = {"enabled": source != file_path, "masked_count": len(protection.mapping)}
    return {**summary, "privacy": privacy_record, "mapping": mapping}


def _parse_to_index(
    this, source: str, original: str, page_range, doc_id, labels: dict, reporter
) -> dict:
    """Parse, chunk, label and index `source`, the PDF to read: the original, or its redacted
    copy. Returns the counts for `run`'s summary."""
    _check_cancelled(reporter)
    reporter.start_stage("parsing")
    parsed = this.parse(source, page_range=page_range, reporter=reporter)

    tables_captured = len(parsed.tables)
    images_captured = len(parsed.images)

    reporter.start_stage("chunking")
    # The OCR crops are rendered from `source`, so a redacted report's crops are redacted too.
    chunks = this.chunk(parsed, doc_path=source, doc_id=doc_id, reporter=reporter)

    # A report's sections are read once from its fonts (IN-05); other documents need none. The
    # original's fonts: reading them sends nothing anywhere, and gives only fixed section names.
    is_report = labels.get("source_type") == "marsh_report"
    sections = report.report_sections(original) if is_report else []

    # Still a pass-through: the safety net on chunk text is PV-06's. The "anonymising" stage is
    # now the redaction before parsing.
    chunks = anonymise(chunks)
    for c in chunks:
        _check_cancelled(reporter)
        c["metadata"].update(labels)
        # The section is per passage (IN-05), from the pages it sits on.
        meta = c["metadata"]
        meta["section"] = report.section_label(
            labels.get("source_type"), meta.get("page_start"), meta.get("page_end"), sections
        )

    reporter.start_stage("indexing")
    _check_cancelled(reporter)
    chunks_indexed = (
        index_chunks(chunks, reporter=reporter, page_total=parsed.page_count) if chunks else 0
    )

    return {
        "doc_name": parsed.doc_name,
        "chunks_indexed": chunks_indexed,
        "tables_captured": tables_captured,
        "images_captured": images_captured,
    }

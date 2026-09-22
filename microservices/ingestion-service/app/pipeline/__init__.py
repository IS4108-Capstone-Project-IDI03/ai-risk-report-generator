"""Ingestion pipeline orchestrator.

`run(file_path)` chains the stages for one document:

    parse -> (tables/images branched aside) -> chunk -> anonymise -> index

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

from app.pipeline.anonymiser import anonymise
from app.pipeline.errors import UnparsableDocumentError
from app.pipeline.indexer import index_chunks

__all__ = [
    "run",
    "anonymise",
    "index_chunks",
    "UnparsableDocumentError",
]


def run(file_path: str, page_range: tuple[int, int] | None = None) -> dict:
    """Ingest one document end to end and return a summary.

    Args:
        file_path: path to the document to ingest.
        page_range: optional 1-based inclusive ``(start, end)`` page window,
            forwarded to the parser (useful for smoke runs).

    Returns:
        A summary dict::

            {
                "doc_name": str,
                "chunks_indexed": int,
                "tables_captured": int,
                "images_captured": int,
            }

    Raises:
        UnparsableDocumentError: if the document could not be parsed. Propagated
            so a caller (or future OCR fallback) can react.
    """
    # Import the heavy stages (Docling / docling_core / pix2text) lazily, so
    # importing this package for /health, /ingest, /index does not load them.
    from app.pipeline.chunker import chunk
    from app.pipeline.parser import parse

    parsed = parse(file_path, page_range=page_range)

    # Tables and images are captured but not processed/indexed yet.
    tables_captured = len(parsed.tables)
    images_captured = len(parsed.images)

    chunks = chunk(parsed, doc_path=file_path, doc_id=None)
    chunks = anonymise(chunks)
    chunks_indexed = index_chunks(chunks) if chunks else 0

    return {
        "doc_name": parsed.doc_name,
        "chunks_indexed": chunks_indexed,
        "tables_captured": tables_captured,
        "images_captured": images_captured,
    }

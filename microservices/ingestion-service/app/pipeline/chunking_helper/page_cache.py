"""One cached PyMuPDF handle for the document being chunked.

Both the table and formula extractors crop regions out of the *same* PDF, once
per detected region. Opening the file per region would be wasteful, so the
handle is cached at module level and reused while the path is unchanged.

This cache is deliberately shared rather than duplicated per extractor. Two
private caches (one in `formula_parser`, one in `table_parser`) meant two open
handles to the same file and two close functions, only one of which the chunker
actually called — so the other leaked for the lifetime of the process.

Scope: one document at a time, which matches the pipeline (`chunk()` processes a
single document and closes the handle in a `finally`). Switching paths closes the
previous handle before opening the new one.
"""

import pymupdf

# Module-level so the handle survives between region crops. `_document_path`
# tracks which file `_document` belongs to, so a new path forces a reopen.
_document: pymupdf.Document | None = None
_document_path: str | None = None


def load_document(file_path: str) -> pymupdf.Document:
    """Return an open handle for `file_path`, reusing the cached one if possible.

    A different path closes the currently cached handle first, so at most one
    document is ever open.
    """
    global _document, _document_path

    if _document is not None and _document_path == str(file_path):
        return _document

    # Different document: release the previous handle before opening the next.
    close_document()

    _document = pymupdf.open(file_path)
    _document_path = str(file_path)
    return _document


def close_document() -> None:
    """Close and forget the cached handle. Safe to call when nothing is open."""
    global _document, _document_path

    if _document is not None:
        _document.close()
    _document = None
    _document_path = None


def cached_path() -> str | None:
    """Path of the currently cached document, or None. Exposed for tests."""
    return _document_path

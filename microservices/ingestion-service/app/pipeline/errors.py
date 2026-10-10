"""Pipeline error types.

`UnparsableDocumentError` marks a document the parser could not extract. It is
raised (not swallowed) so a later stage can catch it and hand the file off to an
OCR extraction path (out of scope for now). The offending source path is carried
on the exception so that fallback can locate the file without re-deriving it.
"""


class UnparsableDocumentError(Exception):
    """Raised when a document cannot be parsed and needs an OCR fallback.

    Attributes:
        source: Path/filename of the document that failed to parse.
    """

    def __init__(self, source: str, message: str | None = None) -> None:
        self.source = source
        super().__init__(message or f"Could not parse document: {source}")


class DocumentTimeoutError(Exception):
    """Raised when Docling stops at `document_timeout` before parsing every page.

    Docling returns the pages it finished as PARTIAL_SUCCESS; indexing those
    would leave the rest of the document out of search while it shows Complete.
    """

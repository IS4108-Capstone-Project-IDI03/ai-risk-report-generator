"""Contract for the pipeline error type used by the future OCR fallback."""

import pytest

from app.pipeline.errors import UnparsableDocumentError


def test_is_exception_subclass():
    assert issubclass(UnparsableDocumentError, Exception)


def test_carries_source_path():
    err = UnparsableDocumentError("reports/broken.pdf")
    assert err.source == "reports/broken.pdf"
    assert "reports/broken.pdf" in str(err)


def test_custom_message_preserves_source():
    err = UnparsableDocumentError("reports/broken.pdf", "encrypted, needs OCR")
    assert err.source == "reports/broken.pdf"
    assert str(err) == "encrypted, needs OCR"


def test_can_be_caught_as_exception():
    with pytest.raises(UnparsableDocumentError) as excinfo:
        raise UnparsableDocumentError("scan.pdf")
    assert excinfo.value.source == "scan.pdf"

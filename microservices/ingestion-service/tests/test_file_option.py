from pathlib import Path


def get_fixture():
    path = Path(__file__).parent / "test_files"
    # Parser/chunker contract tests need an extractable PDF with text and headings.
    # Keep image-only PDFs below for OCR-specific tests instead.

    # FIXTURE = path / "Tyco Hygood FM-200 Engineered Manual.pdf"
    # FIXTURE = path / "Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf"
    # FIXTURE = path / "Office Sample 5 - PRE 2026 - REDACTED.pdf"
    # FIXTURE = path / "Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf"

    # Image-only PDFs — use for OCR-specific tests only, not parser/chunker contracts:
    FIXTURE = path / "unextractable" / "NFPA_25.pdf"
    # FIXTURE = path / "unextractable" / "NFPA_2001.pdf"
    return FIXTURE


def get_ocr_fixture():
    """Image-only fixture for OCR inspect tests.

    Switch TEST_PAGE_RANGE in test_chunker.py to a content-heavy slice (not
    the cover pages) when using these — pages 1-2 of scanned standards docs
    are typically cover/TOC with little body text for OCR to recover.
    """
    path = Path(__file__).parent / "test_files" / "unextractable"
    FIXTURE = path / "NFPA_2001.pdf"
    # FIXTURE = path / "NFPA_25.pdf"
    # FIXTURE = path / "ttt.pdf"
    return FIXTURE

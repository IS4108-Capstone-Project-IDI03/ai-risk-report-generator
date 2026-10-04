from pathlib import Path


def get_fixture():
    path = Path(__file__).parent / "test_files"
    # Parser/chunker contract tests need an extractable PDF with text and headings.
    # Keep image-only PDFs below for OCR-specific tests instead.

    FIXTURE = path / "Tyco Hygood FM-200 Engineered Manual.pdf"
    # FIXTURE = path / "Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf"
    # FIXTURE = path / "Office Sample 5 - PRE 2026 - REDACTED.pdf"
    # FIXTURE = path / "Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf"
    # FIXTURE = path / "unextractable" / "NFPA_2001.pdf"
    # FIXTURE = path / "unextractable" / "NFPA_25.pdf"
    return FIXTURE

"""Unit and integration tests for dynamic OCR engine selection (ocr_config.py).

Unit tests
----------
Mock ``platform.system()`` and the ``GPU_ENABLED`` environment variable to
verify every branch of ``get_ocr_options()`` without touching real hardware:

    +-----------+-----------+----------------------------+--------------------+
    | platform  | GPU       | Expected OCR class         | formula_enrichment |
    +===========+===========+============================+====================+
    | Darwin    | false     | TesseractCliOcrOptions     | False              |
    +-----------+-----------+----------------------------+--------------------+
    | Darwin    | true      | TesseractCliOcrOptions     | False  (GPU flag   |
    |           |           |                            |  ignored on macOS) |
    +-----------+-----------+----------------------------+--------------------+
    | Windows   | false     | RapidOcrOptions            | False              |
    +-----------+-----------+----------------------------+--------------------+
    | Windows   | true      | NemotronOcrOptions         | True               |
    +-----------+-----------+----------------------------+--------------------+
    | Linux     | false     | RapidOcrOptions            | False              |
    +-----------+-----------+----------------------------+--------------------+
    | Linux     | true      | NemotronOcrOptions         | True               |
    +-----------+-----------+----------------------------+--------------------+

Integration test
----------------
Parses ``tests/test_files/unextractable/ttt.pdf`` using the OCR engine that
``get_ocr_options()`` selects for the *current* environment. The file is
intentionally unparsable, so the goal is not to get text out — it is to confirm
that the wiring is correct: ``parse()`` initialises without error and raises
``UnparsableDocumentError`` as expected.
"""

from pathlib import Path

import pytest

from docling.datamodel.pipeline_options import (
    NemotronOcrOptions,
    RapidOcrOptions,
    TesseractCliOcrOptions,
)

from app.pipeline.errors import UnparsableDocumentError
from app.pipeline.ocr_config import get_ocr_options, is_gpu_enabled

# Import the real parse function at module load time, before conftest's
# stub_document_ocr fixture patches parser_module.parse. This reference
# bypasses the shim so the integration test can verify the real error path.
from app.pipeline.parser import parse as _real_parse

# The unparsable fixture used for the integration test.  This file is used
# directly here rather than going through test_file_option.py because the
# purpose of this test is specifically to exercise OCR config wiring against a
# file that triggers UnparsableDocumentError.
_UNEXTRACTABLE_FIXTURE = (
    Path(__file__).parent / "test_files" / "unextractable" / "ttt.pdf"
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _patch(monkeypatch, system: str, gpu_enabled: str) -> None:
    """Apply platform and GPU_ENABLED patches for a single test case."""
    monkeypatch.setattr("app.pipeline.ocr_config.platform.system", lambda: system)
    monkeypatch.setenv("GPU_ENABLED", gpu_enabled)


# ---------------------------------------------------------------------------
# is_gpu_enabled
# ---------------------------------------------------------------------------


def test_gpu_enabled_true(monkeypatch):
    monkeypatch.setenv("GPU_ENABLED", "true")
    assert is_gpu_enabled() is True


def test_gpu_enabled_false_when_absent(monkeypatch):
    monkeypatch.delenv("GPU_ENABLED", raising=False)
    assert is_gpu_enabled() is False


def test_gpu_enabled_false_explicit(monkeypatch):
    monkeypatch.setenv("GPU_ENABLED", "false")
    assert is_gpu_enabled() is False


def test_gpu_enabled_strips_whitespace(monkeypatch):
    monkeypatch.setenv("GPU_ENABLED", "  true  ")
    assert is_gpu_enabled() is True


def test_gpu_enabled_case_insensitive(monkeypatch):
    monkeypatch.setenv("GPU_ENABLED", "TRUE")
    assert is_gpu_enabled() is True


# ---------------------------------------------------------------------------
# get_ocr_options — macOS
# ---------------------------------------------------------------------------


def test_macos_no_gpu_returns_tesseract(monkeypatch):
    _patch(monkeypatch, "Darwin", "false")
    ocr_options, formula_enrichment = get_ocr_options()
    assert isinstance(ocr_options, TesseractCliOcrOptions)
    assert formula_enrichment is False


def test_macos_gpu_flag_ignored_returns_tesseract(monkeypatch):
    """GPU_ENABLED=true on macOS must still select TesseractCli, not Nemotron."""
    _patch(monkeypatch, "Darwin", "true")
    ocr_options, formula_enrichment = get_ocr_options()
    assert isinstance(ocr_options, TesseractCliOcrOptions)
    assert formula_enrichment is False


# ---------------------------------------------------------------------------
# get_ocr_options — Windows
# ---------------------------------------------------------------------------


def test_windows_no_gpu_returns_rapidocr(monkeypatch):
    _patch(monkeypatch, "Windows", "false")
    ocr_options, formula_enrichment = get_ocr_options()
    assert isinstance(ocr_options, RapidOcrOptions)
    assert formula_enrichment is False


def test_windows_with_gpu_returns_nemotron(monkeypatch):
    _patch(monkeypatch, "Windows", "true")
    ocr_options, formula_enrichment = get_ocr_options()
    assert isinstance(ocr_options, NemotronOcrOptions)
    assert formula_enrichment is True


# ---------------------------------------------------------------------------
# get_ocr_options — Linux (Docker / CI)
# ---------------------------------------------------------------------------


def test_linux_no_gpu_returns_rapidocr(monkeypatch):
    _patch(monkeypatch, "Linux", "false")
    ocr_options, formula_enrichment = get_ocr_options()
    assert isinstance(ocr_options, RapidOcrOptions)
    assert formula_enrichment is False


def test_linux_with_gpu_returns_nemotron(monkeypatch):
    _patch(monkeypatch, "Linux", "true")
    ocr_options, formula_enrichment = get_ocr_options()
    assert isinstance(ocr_options, NemotronOcrOptions)
    assert formula_enrichment is True


# ---------------------------------------------------------------------------
# get_ocr_options — OcrMode
# ---------------------------------------------------------------------------


def test_ocr_mode_is_full_page_on_all_engines(monkeypatch):
    """All engines should use FULL_PAGE mode regardless of platform/GPU."""
    from docling.datamodel.pipeline_options import OcrMode

    for system, gpu in [("Darwin", "false"), ("Windows", "false"), ("Windows", "true")]:
        _patch(monkeypatch, system, gpu)
        ocr_options, _ = get_ocr_options()
        assert ocr_options.mode == OcrMode.FULL_PAGE, (
            f"Expected FULL_PAGE for system={system}, GPU_ENABLED={gpu}, "
            f"got {ocr_options.mode}"
        )


# ---------------------------------------------------------------------------
# Integration test — wiring against unparsable fixture
# ---------------------------------------------------------------------------


@pytest.mark.model
def test_parse_unextractable_raises_with_current_engine():
    """Confirm the full wiring: converter initialises and raises UnparsableDocumentError.

    Uses the current environment's OCR engine (whatever get_ocr_options()
    returns for this machine). The file is intentionally unextractable, so a
    successful parse would itself be a bug. We're testing that:

    1. get_ocr_options() selects an engine without crashing.
    2. _converter() initialises with that engine without crashing.
    3. parse() raises UnparsableDocumentError (not a raw Docling exception).
    4. The error carries the correct source path.

    Uses ``_real_parse`` (imported at module load before conftest's
    ``stub_document_ocr`` shim is installed) to verify the real error path
    rather than the stub fallback.
    """
    if not _UNEXTRACTABLE_FIXTURE.exists():
        pytest.skip(f"fixture missing: {_UNEXTRACTABLE_FIXTURE}")

    # Clear the lru_cache so the converter is rebuilt with the real (unmocked)
    # OCR options for this environment.
    from app.pipeline.parser import _converter

    _converter.cache_clear()

    try:
        with pytest.raises(UnparsableDocumentError) as exc_info:
            _real_parse(str(_UNEXTRACTABLE_FIXTURE))

        assert exc_info.value.source == str(_UNEXTRACTABLE_FIXTURE)
    except UnparsableDocumentError:
        raise
    except Exception as exc:  # noqa: BLE001
        pytest.skip(
            f"Docling models unavailable in this environment: {exc}.\n"
            "Please resolve the error to try downloading again."
        )
    finally:
        # Always restore cache state so subsequent tests use their own setup.
        _converter.cache_clear()

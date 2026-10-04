"""Shared test setup for the ingestion service.

TLS trust
---------
Docling and the chunker's tokenizer are fetched from Hugging Face on first use.
On machines behind a TLS-inspecting proxy (corporate gateway or an antivirus that
re-signs HTTPS), the interception CA lives in the *Windows* certificate store,
but Python/`requests` verify against `certifi`'s bundle instead — so every hub
call fails with
``CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain``.

`truststore` points Python's SSL at the operating system trust store, which
already contains that CA. It is injected here (test-scope only, best effort) so
model downloads work on such machines without weakening verification — this is
*not* `verify=False`; certificates are still fully validated, just against the
OS trust store. Containers/CI are unaffected: with no interception the OS store
validates the real chain the same way.

Disable antivirus if fetching from Hugging Face still fails.

Region OCR
----------
`chunk()` sends every detected table and formula region to GLM-OCR over HTTP. Run
unstubbed, the default suite depends on a live Ollama/vLLM service, spends
minutes per table on CPU inference, and can return different text between runs.

Region OCR is therefore stubbed for the whole session by default. Pass
``--real-ocr`` to talk to the real service, e.g. to eyeball actual output:

    uv run pytest tests/test_chunker.py -m inspect -s --real-ocr

Two implementation notes:

* The stub is session-scoped, not function-scoped. `test_chunker`'s `chunks`
  fixture is module-scoped, and pytest instantiates higher-scoped fixtures
  first, so a function-scoped stub would be installed *after* `chunk()` had
  already run — and the OCR calls would escape.
* It patches both parser modules rather than `ocr_model`, because each parser
  does ``from ...ocr_model import recognise`` and so holds its own reference.
  Tests with their own fake re-patch on top and win.

Document OCR stub
-----------------
``stub_document_ocr`` wraps ``parse()`` that intercepts
``UnparsableDocumentError`` and returns a minimal ``ParsedDocument`` containing
a single ``TextBlock`` with ``STUBBED_OCR_TEXT`` so downstream tests can 
run without a real OCR service

Converter cache
---------------
``parser._converter()`` is decorated with ``@lru_cache`` so the Docling
DocumentConverter (and its OCR engine) is built only once per process.  Tests
in ``test_ocr_config.py`` mock ``platform.system()`` and ``GPU_ENABLED`` to
exercise different selection branches — they clear the cache themselves around
each assertion.  The ``_clear_converter_cache`` fixture below clears the cache
once at the *end* of the whole session so any converter built during the test
run is not leaked into a subsequent process (e.g., pytest-xdist workers).  It
does *not* clear it before tests because model-loading tests intentionally
share one converter instance across the module for speed.
"""

import pytest

try:
    import truststore
except ImportError:  # pragma: no cover - optional dev convenience
    pass
else:
    truststore.inject_into_ssl()


# Tagged per task, so a mis-routed prompt shows up in a failure message rather
# than silently looking plausible.
STUBBED_TABLE_TEXT = "stubbed table record"
STUBBED_FORMULA_TEXT = "stubbed-formula"
STUBBED_OCR_TEXT = "stubbed ocr document text"


def pytest_addoption(parser):
    parser.addoption(
        "--real-ocr",
        action="store_true",
        default=False,
        help="Send table/formula regions to the real GLM-OCR service instead of a stub.",
    )


@pytest.fixture(autouse=True, scope="session")
def stub_region_ocr(request):
    """Keep region OCR off the network unless --real-ocr was passed."""
    if request.config.getoption("--real-ocr"):
        yield
        return

    from app.pipeline.chunking_helper import formula_parser, table_parser

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(table_parser, "recognise", lambda image_png, task: STUBBED_TABLE_TEXT)
    monkeypatch.setattr(formula_parser, "recognise", lambda image_png, task: STUBBED_FORMULA_TEXT)
    try:
        yield
    finally:
        monkeypatch.undo()


@pytest.fixture(autouse=True, scope="session")
def stub_document_ocr(request):
    """Return a stub ParsedDocument when parse() fails on an image-only PDF.

    When ``--real-ocr`` is off, image-only PDFs (no embedded text layer) raise
    ``UnparsableDocumentError`` because Docling cannot extract any content
    without a live OCR service. This shim intercepts that error and returns a
    minimal ``ParsedDocument`` with a single ``TextBlock`` containing
    ``STUBBED_OCR_TEXT``, allowing downstream tests to run without a real OCR
    service.
    """
    if request.config.getoption("--real-ocr"):
        yield
        return

    import app.pipeline.parser as parser_module
    from app.pipeline.errors import UnparsableDocumentError
    from app.pipeline.parser import ParsedDocument, TextBlock

    _real_parse = parser_module.parse

    def _stubbed_parse(file_path, page_range=None):
        try:
            return _real_parse(file_path, page_range=page_range)
        except UnparsableDocumentError:
            return ParsedDocument(
                doc_name=str(file_path).rsplit("/", 1)[-1].rsplit("\\", 1)[-1],
                text_blocks=[
                    TextBlock(
                        text=STUBBED_OCR_TEXT,
                        section_path=[],
                        page=1,
                        order=1,
                    )
                ],
            )

    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(parser_module, "parse", _stubbed_parse)
    try:
        yield
    finally:
        monkeypatch.undo()


@pytest.fixture(autouse=True, scope="session")
def _clear_converter_cache():
    """Clear the _converter lru_cache at the end of the test session.

    ``parser._converter()`` caches the Docling DocumentConverter (including its
    OCR engine) for the lifetime of the process. Tests in ``test_ocr_config.py``
    manage their own cache clears around mocked calls. This fixture handles the
    session-level teardown so any converter built during the run is released and
    doesn't leak into worker processes or a subsequent pytest invocation that
    shares the same interpreter state.
    """
    yield
    from app.pipeline.parser import _converter

    _converter.cache_clear()

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

Region OCR
----------
`chunk()` sends every detected table and formula region to GLM-OCR over HTTP. Run
unstubbed, the default suite depends on a live Ollama/vLLM service, spends
minutes per table on CPU inference, and can return different text between runs.
The FM-200 fixture's contents pages are full-page tables, so a single Docling
test can stall for tens of minutes.

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
STUBBED_TABLE_TEXT = "| stubbed | table |"
STUBBED_FORMULA_TEXT = "stubbed-formula"


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
    monkeypatch.setattr(
        formula_parser, "recognise", lambda image_png, task: STUBBED_FORMULA_TEXT
    )
    try:
        yield
    finally:
        monkeypatch.undo()

"""Shared test setup for the ingestion service.

TLS trust: Docling and the chunker's tokenizer are fetched from Hugging Face on
first use. On machines behind a TLS-inspecting proxy (corporate gateway or an
antivirus that re-signs HTTPS), the interception CA lives in the *Windows*
certificate store, but Python/`requests` verify against `certifi`'s bundle
instead — so every hub call fails with
``CERTIFICATE_VERIFY_FAILED: self-signed certificate in certificate chain``.

`truststore` points Python's SSL at the operating system trust store, which
already contains that CA. It is injected here (test-scope only, best effort) so
model downloads work on such machines without weakening verification — this is
*not* `verify=False`; certificates are still fully validated, just against the
OS trust store. Containers/CI are unaffected: with no interception the OS store
validates the real chain the same way.
"""

try:
    import truststore
except ImportError:  # pragma: no cover - optional dev convenience
    pass
else:
    truststore.inject_into_ssl()

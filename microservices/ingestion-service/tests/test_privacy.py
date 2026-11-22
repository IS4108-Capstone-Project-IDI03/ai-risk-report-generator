"""ingestion's privacy-service client (PV-05): how long it waits for /mask."""

import json

import httpx

from app import privacy


def _waited(monkeypatch, texts: list[str]) -> float:
    """The read timeout the /mask request for `texts` was sent with."""
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["timeout"] = request.extensions["timeout"]["read"]
        return httpx.Response(200, json={"texts": texts, "spans": [], "mapping": {}})

    monkeypatch.setattr(
        privacy,
        "_client",
        lambda: httpx.Client(
            base_url="http://privacy.test", transport=httpx.MockTransport(handler)
        ),
    )
    privacy.session({"enabled": True}).mask(texts)
    return seen["timeout"]


def test_a_short_text_waits_the_base_timeout(monkeypatch):
    assert _waited(monkeypatch, ["Inspected by the site team."]) < privacy.PRIVACY_TIMEOUT + 1


def test_a_long_document_waits_longer(monkeypatch):
    # 20 dense pages took about 14 s to mask, past the flat 10 s.
    pages = ["x" * 3000] * 20
    assert _waited(monkeypatch, pages) >= privacy.PRIVACY_TIMEOUT + 60


def test_sends_the_admins_never_masked_list_only_when_the_gateway_sent_one(monkeypatch):
    # PV-09: until the gateway has seeded Settings' list, privacy-service uses its file.
    bodies = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"texts": ["x"], "spans": [[]], "mapping": {}})

    monkeypatch.setattr(
        privacy,
        "_client",
        lambda: httpx.Client(
            base_url="http://privacy.test", transport=httpx.MockTransport(handler)
        ),
    )
    privacy.session({"enabled": True, "never_masked": ["Hosereel"]}).mask(["x"])
    privacy.session({"enabled": True}).mask(["x"])

    assert bodies[0]["never_masked"] == ["Hosereel"]
    assert "never_masked" not in bodies[1]

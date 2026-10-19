"""Shared test setup for rag-service: no test may reach a paid API (Claude, OpenAI, Cohere).

Every test mocks its model and search calls; this guard makes a missed mock fail loudly
instead of quietly spending money. Only loopback connections (local test servers) pass.
"""

import ipaddress
import json
import re
import socket

import httpx
import pytest

_connect = socket.socket.connect


def _is_loopback(address) -> bool:
    host = address[0] if isinstance(address, tuple) else address
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host == "localhost"


def _guarded_connect(self, address):
    if self.family in (socket.AF_INET, socket.AF_INET6) and not _is_loopback(address):
        raise RuntimeError(f"Test tried a real network call to {address}; mock it instead.")
    return _connect(self, address)


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """Blocks outside network connections for every test (a missed mock would cost money)."""
    monkeypatch.setattr(socket.socket, "connect", _guarded_connect)


class FakePrivacy:
    """Stands in for privacy-service's POST /mask (PV-01's contract): swaps each known
    entity's names, a +65 number and an NRIC for typed placeholders, extending the mapping
    it is sent. `failure` makes it fail: an httpx exception to raise, or a status code."""

    def __init__(self):
        self.requests: list[dict] = []
        self.failure: Exception | int | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if isinstance(self.failure, Exception):
            raise self.failure
        if self.failure:
            return httpx.Response(self.failure, json={"detail": "boom"})
        body = json.loads(request.content)
        self.requests.append(body)
        mapping = dict(body.get("mapping") or {})

        def placeholder(kind: str, value: str) -> str:
            for key, mapped in mapping.items():
                if mapped == value:
                    return key
            key = f"[{kind}_{1 + sum(k.startswith(f'[{kind}_') for k in mapping)}]"
            mapping[key] = value
            return key

        texts = []
        for text in body["texts"]:
            for entity in body.get("known_entities") or []:
                for name in sorted(entity["names"], key=len, reverse=True):
                    if name in text:
                        text = text.replace(name, placeholder(entity["type"], entity["names"][0]))
            text = re.sub(r"\+65 \d{4} \d{4}", lambda m: placeholder("PHONE", m[0]), text)
            text = re.sub(r"\bS\d{7}[A-Z]\b", lambda m: placeholder("NRIC", m[0]), text)
            texts.append(text)
        return httpx.Response(200, json={"texts": texts, "mapping": mapping})


@pytest.fixture
def fake_privacy(monkeypatch):
    """privacy-service's /mask, served in-process; `.requests` holds each request body."""
    from app import privacy

    fake = FakePrivacy()
    monkeypatch.setattr(
        privacy,
        "_client",
        lambda: httpx.Client(
            base_url="http://privacy.test", transport=httpx.MockTransport(fake.handler)
        ),
    )
    return fake

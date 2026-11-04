"""Shared test setup for S5: privacy-service faked in-process (PV-04)."""

import base64
import io
import json
import re

import httpx
import pytest
from PIL import Image


class FakePrivacy:
    """Stands in for privacy-service (PV-01's and PV-04's contracts).

    `/mask` swaps each known entity's names, a +65 number, an NRIC, a Lower Kent Ridge Rd
    address and the plate PU 104 J for typed placeholders, extending the mapping it is sent.
    `/redact-image` turns every photo black, as a stand-in for a blurred face, and counts one
    face in each. `failure` makes both fail: an httpx
    exception to raise, or a status code. `.requests` holds each request, by path.
    """

    def __init__(self):
        self.requests: list[tuple[str, dict]] = []
        self.failure: Exception | int | None = None

    def handler(self, request: httpx.Request) -> httpx.Response:
        if isinstance(self.failure, Exception):
            raise self.failure
        if self.failure:
            return httpx.Response(self.failure, json={"detail": "boom"})
        body = json.loads(request.content)
        self.requests.append((request.url.path, body))
        if request.url.path == "/redact-image":
            return httpx.Response(
                200,
                json={
                    "images": [_black(image) for image in body["images"]],
                    "faces": [1 for _ in body["images"]],
                },
            )
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
            text = re.sub(
                r"\b\d+ Lower Kent Ridge Rd\b", lambda m: placeholder("ADDRESS", m[0]), text
            )
            text = re.sub(r"\bPU 104 J\b", lambda m: placeholder("VEHICLE", m[0]), text)
            texts.append(text)
        return httpx.Response(200, json={"texts": texts, "mapping": mapping})

    def paths(self) -> list[str]:
        return [path for path, _ in self.requests]


def _black(data: str) -> str:
    with Image.open(io.BytesIO(base64.b64decode(data))) as photo:
        out = io.BytesIO()
        Image.new("RGB", photo.size, "black").save(out, "JPEG")
    return base64.b64encode(out.getvalue()).decode("ascii")


@pytest.fixture
def fake_privacy(monkeypatch):
    """privacy-service, served in-process."""
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

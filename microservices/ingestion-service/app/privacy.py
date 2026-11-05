"""Client details masked before ingestion sends a document's text anywhere (PV-05), through
privacy-service. A copy of rag-service's and speech-ocr-service's client, as the epic allows."""

import os
import re

import httpx

PRIVACY_SERVICE_URL = os.getenv("PRIVACY_SERVICE_URL", "http://localhost:8004")
PRIVACY_TIMEOUT = float(os.getenv("PRIVACY_TIMEOUT", "10"))

# Copied from privacy-service/app/placeholders.py, as rag-service does (pure string work).
TYPES = (
    "CLIENT",
    "SITE",
    "ADDRESS",
    "PERSON",
    "NRIC",
    "PHONE",
    "EMAIL",
    "UEN",
    "POSTAL",
    "VEHICLE",
)

# Lenient: a model may drop the brackets or change the case ("person_1", "PERSON_1").
_PLACEHOLDER = re.compile(rf"\[?\b({'|'.join(TYPES)})_(\d+)\b\]?", re.IGNORECASE)
_LITERAL = re.compile(r"\[?\bLITERAL_(\d+)\b\]?", re.IGNORECASE)

# Text may already hold something shaped like a placeholder (a report quoting a template's
# "[PERSON_1]"). It is swapped for [LITERAL_n], and put back after (Rule 6), as in rag-service.
# Without this, putting the real words back would turn it into a real name.
_PLACEHOLDER_SHAPED = re.compile(
    rf"\[?\b({'|'.join((*TYPES, 'LITERAL'))})_(\d+)\b\]?", re.IGNORECASE
)


class PrivacyUnavailable(Exception):
    """privacy-service could not mask a document's text, so nothing was sent or indexed."""


def _client() -> httpx.Client:
    return httpx.Client(base_url=PRIVACY_SERVICE_URL, timeout=PRIVACY_TIMEOUT)


class Session:
    """One document's masking. Off (or no `privacy` sent): text passes unchanged."""

    def __init__(self, privacy: dict | None):
        self.enabled = bool(privacy and privacy.get("enabled"))
        self.known_entities = list((privacy or {}).get("known_entities") or [])
        self.detect = (privacy or {}).get("detect") or []
        self.mapping: dict[str, str] = {}
        self.literals: dict[str, str] = {}

    def escape(self, text: str) -> str:
        """`text` with anything shaped like a placeholder swapped for its [LITERAL_n]."""

        def swap(match: re.Match) -> str:
            for key, literal in self.literals.items():
                if literal == match[0]:
                    return key
            key = f"[LITERAL_{len(self.literals) + 1}]"
            self.literals[key] = match[0]
            return key

        return _PLACEHOLDER_SHAPED.sub(swap, text)

    def mask(self, texts: list[str]) -> list[str]:
        """`texts` with client details as typed placeholders, in one /mask call."""
        if not self.enabled:
            return list(texts)
        return self._mask([self.escape(t) for t in texts])["texts"]

    def mask_spans(self, texts: list[str]) -> list[list[dict]]:
        """Where each client detail in `texts` sits, `{start, end, placeholder}` per detail, in
        one /mask call. The caller escapes `texts` first (`escape`), keeping its offsets."""
        return self._mask(texts)["spans"]

    def unmask(self, text: str) -> str:
        """`text` with real values back. A placeholder the mapping doesn't hold is left as
        written, for the admin to see and correct."""
        if not self.enabled:
            return text

        def restore(match: re.Match) -> str:
            return self.mapping.get(f"[{match[1].upper()}_{match[2]}]", match[0])

        def restore_literal(match: re.Match) -> str:
            return self.literals.get(f"[LITERAL_{match[1]}]", match[0])

        return _LITERAL.sub(restore_literal, _PLACEHOLDER.sub(restore, text))

    def _mask(self, texts: list[str]) -> dict:
        """privacy-service's answer for `texts`. The mapping so far goes back, so one mapping
        covers the document (Rule 2)."""
        # Fail closed (Rule 3): on any failure the document fails; raw text is never the fallback.
        # The message names no value from the document (Rule 5), in rag-service's wording.
        try:
            with _client() as client:
                response = client.post(
                    "/mask",
                    json={
                        "texts": texts,
                        "known_entities": self.known_entities,
                        "mapping": self.mapping,
                        **({"detect": self.detect} if self.detect else {}),
                    },
                )
            response.raise_for_status()
        except httpx.TimeoutException as error:
            raise PrivacyUnavailable(
                "Client details couldn't be protected because the privacy service didn't "
                "respond in time, so nothing was sent or indexed. Try again in a moment."
            ) from error
        except httpx.HTTPError as error:
            raise PrivacyUnavailable(
                "Client details couldn't be protected because the privacy service isn't "
                "available, so nothing was sent or indexed. If this keeps happening, tell your "
                "administrator."
            ) from error
        body = response.json()
        self.mapping = body["mapping"]
        return body


def session(privacy: dict | None) -> Session:
    """`privacy` is the gateway's `{enabled, known_entities, detect?}` (the epic's Rule 1)."""
    return Session(privacy)

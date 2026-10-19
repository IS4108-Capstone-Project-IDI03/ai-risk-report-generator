"""Client details masked before any external AI call (PV-02), through privacy-service."""

import re

import httpx

from app import config
from app.generation.llm import GenerationFailed

# Copied from privacy-service/app/placeholders.py (pure string work, needed per call).
TYPES = ("CLIENT", "SITE", "ADDRESS", "PERSON", "NRIC", "PHONE", "EMAIL", "UEN", "POSTAL")

# Lenient: a model may drop the brackets or change the case ("person_1", "PERSON_1").
_PLACEHOLDER = re.compile(rf"\[?\b({'|'.join(TYPES)})_(\d+)\b\]?", re.IGNORECASE)

# Text may already hold something shaped like a placeholder (an engineer typing "[PERSON_1]").
# It is swapped for [LITERAL_n], a type unmask ignores, and put back after (Rule 6). Without
# this, unmasking would put a real name where the input never had one.
_PLACEHOLDER_SHAPED = re.compile(
    rf"\[?\b({'|'.join((*TYPES, 'LITERAL'))})_(\d+)\b\]?", re.IGNORECASE
)
_LITERAL = re.compile(r"\[?\bLITERAL_(\d+)\b\]?", re.IGNORECASE)


class PrivacyUnavailable(GenerationFailed):
    """privacy-service could not mask a request's text, so nothing was sent."""


def _client() -> httpx.Client:
    return httpx.Client(base_url=config.PRIVACY_SERVICE_URL, timeout=config.PRIVACY_TIMEOUT)


def _unmask(text: str, mapping: dict[str, str]) -> tuple[str, list[str]]:
    """Return `text` with each placeholder replaced, and the placeholders it could not resolve.

    An unresolved one is left as written, so the caller can flag what holds it.
    """
    unknown: list[str] = []

    def restore(match: re.Match) -> str:
        placeholder = f"[{match[1].upper()}_{match[2]}]"
        if placeholder in mapping:
            return mapping[placeholder]
        unknown.append(placeholder)
        return match[0]

    return _PLACEHOLDER.sub(restore, text), unknown


class Session:
    """One drafting request's masking. Off (or no `privacy` sent): text passes unchanged."""

    def __init__(self, privacy: dict | None):
        self.enabled = bool(privacy and privacy.get("enabled"))
        self.known_entities = (privacy or {}).get("known_entities") or []
        self.mapping: dict[str, str] = {}
        self.literals: dict[str, str] = {}

    def _escape(self, text: str) -> str:
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
        texts = [self._escape(t) for t in texts]
        # Fail closed (Rule 3): on any failure the draft fails; raw text is never the fallback.
        # The message names no value from the request (Rule 5).
        try:
            with _client() as client:
                # The mapping so far goes back, so one mapping covers the request (Rule 2).
                response = client.post(
                    "/mask",
                    json={
                        "texts": texts,
                        "known_entities": self.known_entities,
                        "mapping": self.mapping,
                    },
                )
            response.raise_for_status()
        except httpx.TimeoutException as error:
            raise PrivacyUnavailable(
                "The privacy service timed out, so nothing was sent to the drafting model. "
                "Try again in a moment."
            ) from error
        except httpx.HTTPError as error:
            raise PrivacyUnavailable(
                "The privacy service could not mask client details, so nothing was sent to "
                "the drafting model. Check that privacy-service is running."
            ) from error
        body = response.json()
        self.mapping = body["mapping"]
        return body["texts"]

    def provenance(self) -> dict:
        """What the draft's provenance records (Rule 8): never the mapping itself."""
        return {"enabled": self.enabled, "masked_count": len(self.mapping)}

    def unmask(self, text: str) -> tuple[str, list[str]]:
        """`text` with real values back, and any placeholder the mapping doesn't hold."""
        text, unknown = _unmask(text, self.mapping)

        def restore(match: re.Match) -> str:
            key = f"[LITERAL_{match[1]}]"
            if key in self.literals:
                return self.literals[key]
            unknown.append(key)
            return match[0]

        return _LITERAL.sub(restore, text), unknown


def session(privacy: dict | None) -> Session:
    """`privacy` is the gateway's `{enabled, known_entities}` (Rule 1), or None."""
    return Session(privacy)

"""Client details masked and faces blurred before photo reading (PV-04), through privacy-service."""

import re

import httpx

from app import config

# Copied from privacy-service/app/placeholders.py, as rag-service does (pure string work).
TYPES = ("CLIENT", "SITE", "ADDRESS", "PERSON", "NRIC", "PHONE", "EMAIL", "UEN", "POSTAL")

# Lenient: a model may drop the brackets or change the case ("person_1", "PERSON_1").
_PLACEHOLDER = re.compile(rf"\[?\b({'|'.join(TYPES)})_(\d+)\b\]?", re.IGNORECASE)

# Text may already hold something shaped like a placeholder (an engineer typing "[PERSON_1]").
# It is swapped for [LITERAL_n], a type unmask ignores, and put back after (Rule 6), as in
# rag-service. Without this, unmasking would put a real name where the input never had one.
_PLACEHOLDER_SHAPED = re.compile(
    rf"\[?\b({'|'.join((*TYPES, 'LITERAL'))})_(\d+)\b\]?", re.IGNORECASE
)
_LITERAL = re.compile(r"\[?\bLITERAL_(\d+)\b\]?", re.IGNORECASE)


class PrivacyUnavailable(Exception):
    """privacy-service could not protect a reading's text or photos, so nothing was sent."""


def _client() -> httpx.Client:
    return httpx.Client(base_url=config.PRIVACY_SERVICE_URL, timeout=config.PRIVACY_TIMEOUT)


def _post(path: str, body: dict) -> dict:
    """privacy-service's answer to `body`. Fails closed (Rule 3): on any failure the reading
    fails and raw text or photos are never the fallback. The message names no value from the
    request (Rule 5); it is rag-service's, so engineers read one wording everywhere."""
    try:
        with _client() as client:
            response = client.post(path, json=body)
        response.raise_for_status()
    except httpx.TimeoutException as error:
        raise PrivacyUnavailable(
            "Client details couldn't be protected because the privacy service didn't "
            "respond in time, so nothing was sent to the AI model. Try again in a moment."
        ) from error
    except httpx.HTTPError as error:
        raise PrivacyUnavailable(
            "Client details couldn't be protected because the privacy service isn't "
            "available, so nothing was sent to the AI model. If this keeps happening, "
            "tell your administrator."
        ) from error
    return response.json()


class Session:
    """One reading's masking. Off (or no `privacy` sent): text passes unchanged."""

    def __init__(self, privacy: dict | None):
        self.enabled = bool(privacy and privacy.get("enabled"))
        self.known_entities = (privacy or {}).get("known_entities") or []
        self.mapping: dict[str, str] = {}
        # Faces blurred in each photo, in the order sent.
        self.faces: list[int] = []
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
        # The mapping so far goes back, so one mapping covers the reading (Rule 2).
        body = _post(
            "/mask",
            {"texts": texts, "known_entities": self.known_entities, "mapping": self.mapping},
        )
        self.mapping = body["mapping"]
        return body["texts"]

    def redact_images(self, images: list[str]) -> list[str]:
        """`images` (base64 JPEG) with every face blurred, in one /redact-image call."""
        if not self.enabled or not images:
            return list(images)
        body = _post("/redact-image", {"images": images})
        self.faces = body["faces"]
        return body["images"]

    def provenance(self) -> dict:
        """What the proposal's provenance records (Rule 8): never the mapping itself."""
        return {
            "enabled": self.enabled,
            "masked_count": len(self.mapping),
            "faces_blurred": sum(self.faces),
        }

    def unmask(self, text: str) -> str:
        """`text` with real values back. A placeholder the mapping doesn't hold is left as
        written, for the engineer to see and edit."""
        if not self.enabled:
            return text

        def restore(match: re.Match) -> str:
            return self.mapping.get(f"[{match[1].upper()}_{match[2]}]", match[0])

        def restore_literal(match: re.Match) -> str:
            return self.literals.get(f"[LITERAL_{match[1]}]", match[0])

        return _LITERAL.sub(restore_literal, _PLACEHOLDER.sub(restore, text))


def session(privacy: dict | None) -> Session:
    """`privacy` is the gateway's `{enabled, known_entities}` (the epic's Rule 1), or None."""
    return Session(privacy)

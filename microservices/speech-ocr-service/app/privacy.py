"""Client details masked and faces blurred before photo reading (PV-04), through privacy-service."""

import re

import httpx

from app import config

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

# Text may already hold something shaped like a placeholder (an engineer typing "[PERSON_1]").
# It is swapped for [LITERAL_n], a type unmask ignores, and put back after (Rule 6), as in
# rag-service. Without this, unmasking would put a real name where the input never had one.
_PLACEHOLDER_SHAPED = re.compile(
    rf"\[?\b({'|'.join((*TYPES, 'LITERAL'))})_(\d+)\b\]?", re.IGNORECASE
)
_LITERAL = re.compile(r"\[?\bLITERAL_(\d+)\b\]?", re.IGNORECASE)

# What a detail Gemini added to its answer is replaced with: its kind, never its value.
_REMOVED = {
    "PERSON": "[name removed]",
    "PHONE": "[phone number removed]",
    "EMAIL": "[email address removed]",
    "NRIC": "[ID number removed]",
    "UEN": "[UEN removed]",
    "POSTAL": "[postal code removed]",
    "ADDRESS": "[address removed]",
    "VEHICLE": "[vehicle plate removed]",
}


class PrivacyUnavailable(Exception):
    """privacy-service could not protect a reading's text or photos, so nothing was sent."""


def _client() -> httpx.Client:
    return httpx.Client(base_url=config.PRIVACY_SERVICE_URL, timeout=config.PRIVACY_TIMEOUT)


# What failed, and what happened as a result, for each kind of call.
_PROTECTING = ("Client details couldn't be protected", "so nothing was sent to the AI model")
# By the time the answer is checked, Gemini has seen the request: nothing is saved instead.
_CHECKING = ("The AI's answer couldn't be checked for personal details", "so it wasn't saved")


def _post(path: str, body: dict, failure: tuple[str, str] = _PROTECTING) -> dict:
    """privacy-service's answer to `body`. Fails closed (Rule 3): on any failure the reading
    fails and raw text or photos are never the fallback. The message names no value from the
    request (Rule 5); protecting's is rag-service's, so engineers read one wording everywhere."""
    what, outcome = failure
    try:
        with _client() as client:
            response = client.post(path, json=body)
        response.raise_for_status()
    except httpx.TimeoutException as error:
        raise PrivacyUnavailable(
            f"{what} because the privacy service didn't respond in time, {outcome}. "
            "Try again in a moment."
        ) from error
    except httpx.HTTPError as error:
        raise PrivacyUnavailable(
            f"{what} because the privacy service isn't available, {outcome}. "
            "If this keeps happening, tell your administrator."
        ) from error
    return response.json()


class Session:
    """One reading's masking. Off (or no `privacy` sent): text passes unchanged."""

    def __init__(self, privacy: dict | None):
        self.enabled = bool(privacy and privacy.get("enabled"))
        self.known_entities = (privacy or {}).get("known_entities") or []
        self.check_answers = self.enabled and bool((privacy or {}).get("check_answers"))
        self.mapping: dict[str, str] = {}
        # Faces blurred in each photo, in the order sent.
        self.faces: list[int] = []
        # Details taken out of Gemini's answer, each counted once.
        self.removed = 0
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

    def check_answer(self, texts: list[str]) -> list[str]:
        """Gemini's `texts`, still masked, with each detail the reading never sent it (a name
        or number read off a photo) replaced by its kind, in one more /mask call. What was sent
        is a placeholder by now, so whatever /mask finds is new; a known client, site or
        person stays, as it would have in the input."""
        if not self.check_answers or not texts:
            return list(texts)
        body = _post(
            "/mask",
            {"texts": texts, "known_entities": self.known_entities, "mapping": self.mapping},
            _CHECKING,
        )
        known = {entity["names"][0] for entity in self.known_entities}
        checked = body["texts"]
        for key, value in body["mapping"].items():
            if key in self.mapping:
                continue
            if value in known:
                kept = value
            else:
                kept = _REMOVED.get(key[1:].rsplit("_", 1)[0], "[detail removed]")
                self.removed += 1
            checked = [text.replace(key, kept) for text in checked]
        return checked

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
            "removed_from_answer": self.removed,
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

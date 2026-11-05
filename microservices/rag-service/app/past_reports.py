"""Past-report passages as a prompt needs them (PV-05).

Ingestion stores a past report with its client details swapped for tags numbered per document
("[PERSON_1] inspected the pump"), and keeps each document's mapping in MongoDB
(`knowledge_documents.privacyMapping`), never in Chroma. A request numbers its own placeholders,
so a stored tag must not be read as the request's own: search puts the real words back here, and
the request's masking (PV-02, PV-03) tags them again in its own mapping.
"""

import os
import re
from functools import cache

from bson import ObjectId
from pymongo import MongoClient
from pymongo.errors import PyMongoError

from app.privacy import PrivacyUnavailable

# A tag as ingestion writes it: "[PERSON_1]", or "[LITERAL_1]" for text that only looked like one.
_TAG = re.compile(r"\[[A-Z]+_\d+\]")


@cache  # one client (and its connection pool) for the life of the service
def collection():
    """The `knowledge_documents` collection in MONGODB_URI's database."""
    client = MongoClient(os.environ["MONGODB_URI"], serverSelectionTimeoutMS=5000)
    return client.get_default_database()["knowledge_documents"]


def with_real_words(passages: list[dict], protection=None) -> list[dict]:
    """The passages with their real words back, from one read of their documents' mappings.

    A passage whose document has no mapping (a standard, or a report indexed before PV-05) is
    returned as stored. With the request's privacy `protection` (a `privacy.Session`), every
    value put back is added to what it masks, so the request's masking tags it again.
    """
    mappings = _mappings({p["metadata"].get("doc_id") for p in passages})
    if protection is not None:
        protection.know(
            [
                {"type": tag[1:].split("_")[0], "names": [value]}
                for mapping in mappings.values()
                for tag, value in mapping.items()
                # A literal is text that only looked like a tag, not a client detail.
                if not tag.startswith("[LITERAL_")
            ]
        )
    return [_restored(p, mappings.get(p["metadata"].get("doc_id"))) for p in passages]


def _mappings(doc_ids: set) -> dict[str, dict[str, str]]:
    ids = [ObjectId(i) for i in doc_ids if isinstance(i, str) and ObjectId.is_valid(i)]
    if not ids:
        return {}
    # Fail closed (Rule 3): without the mapping, a stored tag would be read as this request's own.
    # The message names neither the database nor any value (Rule 5).
    try:
        found = list(collection().find({"_id": {"$in": ids}}, {"privacyMapping": 1}))
    except PyMongoError as error:
        raise PrivacyUnavailable(
            "Past reports couldn't be read because the database isn't available, so nothing was "
            "sent to the AI model. Try again in a moment."
        ) from error
    return {str(d["_id"]): d["privacyMapping"] for d in found if d.get("privacyMapping")}


def _restored(passage: dict, mapping: dict[str, str] | None) -> dict:
    if not mapping:
        return passage

    def real(text: str) -> str:
        return _TAG.sub(lambda m: mapping.get(m[0], m[0]), text)

    metadata = dict(passage["metadata"])
    if metadata.get("headings"):
        metadata["headings"] = [real(h) for h in metadata["headings"]]
    return {**passage, "text": real(passage["text"]), "metadata": metadata}

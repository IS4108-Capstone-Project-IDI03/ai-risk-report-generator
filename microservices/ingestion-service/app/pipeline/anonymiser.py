"""Stage 3: anonymise chunks before they are embedded and stored.

Positioned AFTER chunking, so it is the last transform before `index_chunks`
embeds and upserts. A redacted report's details were already replaced in its PDF
(PV-05), so this is the epic's safety net (PV-06): with protection on, each chunk's
text goes through privacy-service's /mask once more, for details only the OCR model
saw (a phone number on a sign in a picture). Without protection it is a
pass-through. Ids and metadata are kept as they are.
"""

from app.privacy import Session


def anonymise(chunks: list[dict], protection: Session | None = None) -> list[dict]:
    """Return the chunk dicts with client details in their text masked.

    Args:
        chunks: index-ready chunk dicts (``{"id", "text", "metadata"}``).
        protection: the redacted report's privacy session, else None (unchanged).

    Returns:
        New chunk dicts; the input is not mutated. Raises PrivacyUnavailable, and
        nothing is indexed, if privacy-service fails.
    """
    if not protection or not chunks:
        return [dict(c) for c in chunks]
    texts = protection.mask_tagged([c["text"] for c in chunks])
    return [{**c, "text": text} for c, text in zip(chunks, texts)]

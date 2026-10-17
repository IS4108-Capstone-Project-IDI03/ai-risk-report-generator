"""Looks up one passage by id, for the citation panel (CB-02).

Called by app/api/routes.py (GET /passages/{id}). Reads Chroma only; no paid call.
"""

from chromadb.errors import NotFoundError

from app.retrieval_config import COLLECTION, chroma_client


def get_passage(passage_id: str) -> dict | None:
    """Return the passage as the citation panel shows it, or None when the id is unknown."""
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return None
    # No status filter: a withdrawn edition's passage must still open (CB-01 AC14).
    found = collection.get(ids=[passage_id], include=["documents", "metadatas"])
    if not found["ids"]:
        return None
    meta = found["metadatas"][0] or {}
    page_start = meta.get("page_start")
    return {
        "id": passage_id,
        "documentId": meta.get("doc_id"),
        "text": found["documents"][0],
        "headings": list(meta.get("headings") or []),
        "pageStart": page_start,
        "pageEnd": meta.get("page_end"),
        "boxes": _boxes(meta.get("bbox") or [], meta.get("bbox_pages"), page_start),
    }


# `bbox` is a flat list, 4 floats per box (l, t, r, b); `bbox_pages` gives each box's page.
# Older passages have no bbox_pages, so every box falls back to the passage's first page.
def _boxes(flat: list[float], pages: list[int] | None, fallback_page: int | None) -> list[dict]:
    boxes = []
    for i in range(0, len(flat) - 3, 4):
        page = pages[i // 4] if pages and i // 4 < len(pages) else fallback_page
        boxes.append(dict(zip(("page", "l", "t", "r", "b"), (page, *flat[i : i + 4]))))
    return boxes

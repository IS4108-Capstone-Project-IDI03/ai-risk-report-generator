"""Duplicate and newer-edition matching for a freshly ingested document (IN-07).

Called by app/worker.py (end of ingestion) and app/api/routes.py (POST
/documents/{id}/match, and the side-by-side comparison). Calls Chroma for
passage vectors and reads the `knowledge_documents` collection it is given.
No model calls: the vectors were made at indexing time.
"""

import os

import numpy as np
from chromadb.errors import NotFoundError

from app.labelling.config import STANDARDS
from app.labelling.decide import normalise
from app.retrieval_config import COLLECTION, chroma_client

TOP_N = 5  # nearest stored passages looked at for each new passage
MAX_QUERY_EMBEDDINGS = 20  # Chroma Cloud's per-request query quota


def similarity() -> float:
    """Return how alike two passages must be to count as a match (MATCH_PASSAGE_SIMILARITY)."""
    return float(os.getenv("MATCH_PASSAGE_SIMILARITY", "0.90"))


def min_share() -> float:
    """Return the share of passages that must match to flag a copy (MATCH_MIN_SHARE)."""
    # 0.58 is from eval/matching/results/2026-10-08.md.
    return float(os.getenv("MATCH_MIN_SHARE", "0.58"))


def passages_collection():
    """Return the Chroma collection of passages, or None if nothing was ever indexed."""
    try:
        return chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return None


def _known(doc: dict, field: str) -> bool:
    """Return whether a standard has a confirmed (non-Unconfirmed) value for `field`."""
    is_standard = (doc.get("metadata") or {}).get("source_type") in STANDARDS
    return bool(is_standard and doc.get(field) and field not in (doc.get("unconfirmed") or []))


def _edition_year(doc: dict) -> int | None:
    """Return the standard's edition year, or None if it is not a known standard edition."""
    if not _known(doc, "edition"):
        return None
    return int(doc["edition"]) if str(doc["edition"]).isdigit() else None


def _body(doc: dict) -> str | None:
    """Return the issuing body tidied for comparison, or None for a report."""
    return str(doc["issuingBody"]).casefold().strip() if _known(doc, "issuingBody") else None


def _number(doc: dict) -> str | None:
    """Return the standard number tidied (casefolded, no spaces), or None if unknown."""
    if not _known(doc, "standardNumber"):
        return None
    return "".join(str(doc["standardNumber"]).casefold().split())


def _same_standard(doc: dict, other: dict) -> bool:
    """Return whether both have an edition year and the same issuing body and standard number."""
    return (
        _edition_year(doc) is not None
        and _edition_year(other) is not None
        and _body(doc) is not None
        and _body(doc) == _body(other)
        and _number(doc) is not None
        and _number(doc) == _number(other)
    )


def _edition_of(doc: dict, other: dict) -> bool:
    """Return whether `other` is a different known edition of the same body, number unknown."""
    return (
        _edition_year(doc) is not None
        and _edition_year(other) is not None
        and _edition_year(doc) != _edition_year(other)
        and _body(doc) is not None
        and _body(doc) == _body(other)
        and (_number(doc) is None or _number(other) is None)
    )


def _edition_result(doc: dict, pool: list[dict], shared: dict[str, int]) -> dict | None:
    """Return {kind, doc} against the pool's reference edition, or None for the same year.

    The reference is a non-withdrawn member if any, else the newest. Two stored
    copies of that edition are told apart by `shared` (passages each shares with
    the new document), so the side-by-side view shows the closer one.
    """
    live = [c for c in pool if not c.get("withdrawn")]
    other = max(live or pool, key=lambda c: (_edition_year(c), shared.get(str(c["_id"]), 0)))
    if _edition_year(other) == _edition_year(doc):
        return None
    kind = "newer_edition" if _edition_year(doc) > _edition_year(other) else "earlier_edition"
    return {"kind": kind, "doc": other}


def _overlap(new_id: str, candidate_ids: list[str]) -> tuple[int, dict[str, dict]]:
    """Return the new passage count and, per candidate doc_id, which passages match.

    A new passage matches a document if one of that document's passages is
    within the similarity limit (Chroma cosine distance = 1 - similarity).
    """
    collection = passages_collection()
    if collection is None or not candidate_ids:
        return 0, {}
    new = collection.get(where={"doc_id": new_id}, include=["embeddings"])
    if len(new["ids"]) == 0:
        return 0, {}
    limit = 1 - similarity()
    hits: dict[str, dict] = {}
    embeddings = [list(v) for v in new["embeddings"]]
    for offset in range(0, len(embeddings), MAX_QUERY_EMBEDDINGS):
        found = collection.query(
            query_embeddings=embeddings[offset : offset + MAX_QUERY_EMBEDDINGS],
            n_results=TOP_N,
            where={"doc_id": {"$in": candidate_ids}},
            include=["distances", "metadatas"],
        )
        for i, (ids, distances, metas) in enumerate(
            zip(found["ids"], found["distances"], found["metadatas"])
        ):
            for stored_id, distance, meta in zip(ids, distances, metas):
                if distance <= limit:
                    entry = hits.setdefault(meta["doc_id"], {"new": set(), "stored": set()})
                    entry["new"].add(offset + i)
                    entry["stored"].add(stored_id)
    return len(new["ids"]), hits


def _count(collection, doc_id: str) -> int:
    return len(collection.get(where={"doc_id": doc_id}, include=[])["ids"])


def _counts(doc_id: str, candidate_ids: list[str], wanted: set[str] | None = None) -> dict:
    """Return per-candidate counts {newMatched, newTotal, storedMatched, storedTotal}."""
    new_total, overlap = _overlap(doc_id, candidate_ids)
    collection = passages_collection()
    counts = {}
    for other in set(overlap) | (wanted or set()):
        hit = overlap.get(other, {"new": set(), "stored": set()})
        counts[other] = {
            "newMatched": len(hit["new"]),
            "newTotal": new_total,
            "storedMatched": len(hit["stored"]),
            "storedTotal": _count(collection, other) if collection else 0,
        }
    return counts


def find_match(doc: dict, documents) -> dict | None:
    """Return the document's match against stored documents, or None.

    Titles are never compared. Rules in order (a copy candidate shares at least
    MATCH_MIN_SHARE of its passages either way round):
    1. a copy candidate with the same edition (same year, or both without one);
    2. another edition of the same body and standard number, whatever the share;
    3. a copy candidate that is another edition of the same body (number unknown);
    4. any other copy candidate; 5. nothing.
    Counts always come from the passage check (zeros when no passages are shared).
    `documents` is the `knowledge_documents` collection. Without the status filter
    a failed or half-ingested document could be flagged as the original.
    """
    family = doc.get("editionFamily")
    candidates = [
        c
        for c in documents.find({"status": "complete", "_id": {"$ne": doc["_id"]}})
        # Same edition family: an older edition must not re-flag its own family.
        if not (family and c.get("editionFamily") == family)
    ]
    by_id = {str(c["_id"]): c for c in candidates}
    # Counts first, so ties between copies of one edition go to the one sharing most passages.
    same_number = [c for c in candidates if _same_standard(doc, c)]
    counts = _counts(str(doc["_id"]), list(by_id), {str(c["_id"]) for c in same_number})
    shared = {o: c["newMatched"] for o, c in counts.items()}
    share = {
        o: max(c["newMatched"] / c["newTotal"], c["storedMatched"] / c["storedTotal"])
        for o, c in counts.items()
        if c["newTotal"] and c["storedTotal"]
    }
    copies = [by_id[o] for o, v in share.items() if v >= min_share()]

    def closest(pool: list[dict]) -> dict:
        return max(pool, key=lambda c: share[str(c["_id"])])

    same_edition = [c for c in copies if _edition_year(c) == _edition_year(doc)]
    if same_edition:  # 1
        other, kind = closest(same_edition), "possible_copy"
    elif same_number and (edition := _edition_result(doc, same_number, shared)):  # 2
        other, kind = edition["doc"], edition["kind"]
    elif pool := [c for c in copies if _edition_of(doc, c)]:  # 3
        edition = _edition_result(doc, pool, shared)
        other, kind = edition["doc"], edition["kind"]
    elif copies:  # 4
        other, kind = closest(copies), "possible_copy"
    else:  # 5
        return None
    return {"kind": kind, "documentId": other["_id"], **counts[str(other["_id"])]}


def _passages(doc_id: str) -> list[dict]:
    """Return a document's passages in reading order, with text, pages and vector."""
    collection = passages_collection()
    if collection is None:
        return []
    found = collection.get(
        where={"doc_id": doc_id}, include=["documents", "metadatas", "embeddings"]
    )
    rows = [
        {
            "id": id_,
            "text": text,
            "pageStart": meta.get("page_start"),
            "pageEnd": meta.get("page_end"),
            "vector": np.asarray(vector, dtype=float),
        }
        for id_, text, meta, vector in zip(
            found["ids"], found["documents"], found["metadatas"], found["embeddings"]
        )
    ]
    return sorted(rows, key=lambda r: int(r["id"].rsplit(":", 1)[1]))


def _public(passage: dict) -> dict:
    return {k: passage[k] for k in ("id", "text", "pageStart", "pageEnd")}


def _unit(passages: list[dict]) -> np.ndarray:
    """Return the passages' vectors scaled to length 1, one row each."""
    return np.array([p["vector"] / np.linalg.norm(p["vector"]) for p in passages])


def comparison_rows(new_id: str, other_id: str) -> list[dict]:
    """Return side-by-side rows {new, stored, differs} in the new document's order.

    A new passage pairs with its most similar stored passage if they are alike
    enough; it differs if unpaired or its tidied text changed.
    Stored passages nobody paired with are slotted in by their own order.
    """
    new, stored = _passages(new_id), _passages(other_id)
    pairs = []  # (new passage, index of its paired stored passage or None)
    if new and stored:
        # Unit-length vectors, so one matrix product gives every cosine similarity.
        sims = _unit(new) @ _unit(stored).T
    for i, passage in enumerate(new):
        best = None
        if stored:
            j = int(np.argmax(sims[i]))  # first of equally similar passages wins
            best = j if sims[i, j] >= similarity() else None
        pairs.append((passage, best))
    used = {j for _, j in pairs if j is not None}
    pending = [j for j in range(len(stored)) if j not in used]
    rows = []
    for passage, j in pairs:
        # Unpaired stored passages that come earlier than this pair go first.
        while j is not None and pending and pending[0] < j:
            rows.append({"new": None, "stored": _public(stored[pending.pop(0)]), "differs": True})
        # A paired passage still differs if its tidied text changed (e.g. "100 ft" to "120 ft").
        differs = j is None or normalise(passage["text"]) != normalise(stored[j]["text"])
        rows.append(
            {
                "new": _public(passage),
                "stored": _public(stored[j]) if j is not None else None,
                "differs": differs,
            }
        )
    rows += [{"new": None, "stored": _public(stored[j]), "differs": True} for j in pending]
    return rows

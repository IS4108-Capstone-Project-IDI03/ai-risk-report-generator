"""Keyword search over chosen documents' passages, for picking a checklist item's reference.

Story CP-32 (AC2): the engineer changes an item's standard reference by choosing a passage
from the standards in scope. Called by app/api/routes.py (POST /passages/search). Reads
Chroma only: no paid call, and the query never leaves the service, so nothing needs masking.

Passages are ranked by BM25 over the words they share with the query, so the search box can
start from the item's own wording and the closest passages come first.
"""

import math
import re
import time
from collections import Counter

from chromadb.errors import NotFoundError

from app.retrieval_config import COLLECTION, chroma_client

# Chroma Cloud returns at most 300 results per get, so a document is read in pages.
PAGE = 300
# A document's passages are kept this long, so the next search of it needs no read. A
# standard re-ingested meanwhile is read again after at most this long.
CACHE_SECONDS = 600
# Documents kept at once, the least recently read dropped first.
CACHE_DOCUMENTS = 24
# As app/generation/generator.MAX_HEADING_CHARS: a longer "heading" is body text misread.
MAX_HEADING_CHARS = 200
# BM25's usual constants: how fast repeats of a word stop counting, and how much a long
# passage is discounted.
K1 = 1.2
B = 0.75

_cache: dict[str, tuple[float, list[dict]]] = {}

# Words too common to say anything about a passage.
STOPWORDS = frozenset(
    """a an and are as at be been by can check confirm do does for from has have if in into is
    it its may must no not of on or shall should that the their there these this those to was
    were where which with within""".split()
)
_WORD = re.compile(r"[a-z0-9]+(?:[.\-][a-z0-9]+)*")


def words(text: str) -> list[str]:
    """The text's words, lower-cased, without stop words, a plural "s" dropped.

    "Sprinklers" finds "sprinkler"; a clause number such as "8.3.1" stays one word.
    """
    out = []
    for word in _WORD.findall(text.lower()):
        if word in STOPWORDS:
            continue
        if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
            word = word[:-1]
        out.append(word)
    return out


def _headings(meta: dict) -> list[str]:
    return [h for h in meta.get("headings") or [] if len(h) <= MAX_HEADING_CHARS]


def _document_passages(collection, doc_id: str) -> list[dict]:
    """The document's searchable passages: from the cache, else read from Chroma in pages.

    Withdrawn passages and those of a document with Unconfirmed details are left out, as in
    every search (retriever.label_filter).
    """
    now = time.monotonic()
    cached = _cache.get(doc_id)
    if cached and now - cached[0] < CACHE_SECONDS:
        return cached[1]
    where = {"$and": [{"doc_id": doc_id}, {"status": {"$nin": ["withdrawn", "needs_review"]}}]}
    passages: list[dict] = []
    offset = 0
    while True:
        page = collection.get(
            where=where, include=["documents", "metadatas"], limit=PAGE, offset=offset
        )
        for passage_id, text, meta in zip(page["ids"], page["documents"], page["metadatas"]):
            meta = meta or {}
            headings = _headings(meta)
            passages.append(
                {
                    "id": passage_id,
                    "documentId": meta.get("doc_id"),
                    "text": text,
                    "headings": headings,
                    "pageStart": meta.get("page_start"),
                    "pageEnd": meta.get("page_end"),
                    # Its words, counted once here rather than on every search.
                    "_words": Counter(words("\n".join([*headings, text]))),
                }
            )
        if len(page["ids"]) < PAGE:
            break
        offset += PAGE
    _cache[doc_id] = (now, passages)
    while len(_cache) > CACHE_DOCUMENTS:
        del _cache[min(_cache, key=lambda d: _cache[d][0])]
    return passages


def search_passages(query: str, document_ids: list[str], limit: int = 10) -> list[dict]:
    """Return the documents' passages that best match the query's words, best first.

    Each as GET /passages/{id} gives it, without page boxes. Empty when no word matches.
    """
    terms = set(words(query))
    if not terms or not document_ids:
        return []
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return []
    passages = [p for d in dict.fromkeys(document_ids) for p in _document_passages(collection, d)]
    if not passages:
        return []
    count = len(passages)
    average = sum(sum(p["_words"].values()) for p in passages) / count or 1
    holding = {t: sum(1 for p in passages if t in p["_words"]) for t in terms}
    scored = []
    for n, passage in enumerate(passages):
        counts = passage["_words"]
        length = sum(counts.values())
        score = 0.0
        for term in terms:
            seen = counts.get(term, 0)
            if not seen:
                continue
            rarity = math.log(1 + (count - holding[term] + 0.5) / (holding[term] + 0.5))
            score += rarity * seen * (K1 + 1) / (seen + K1 * (1 - B + B * length / average))
        if score > 0:
            # Ties keep the document's own order.
            scored.append((-score, n, passage))
    scored.sort(key=lambda s: (s[0], s[1]))
    return [
        {key: value for key, value in passage.items() if not key.startswith("_")}
        for _, _, passage in scored[:limit]
    ]

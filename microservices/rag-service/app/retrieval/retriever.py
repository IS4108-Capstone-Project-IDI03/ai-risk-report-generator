"""Cohere query embedding -> Chroma vector search -> Cohere reranking."""

import json
import logging
import os
import re
import time

import httpx
from chromadb.errors import NotFoundError
from cohere.errors import GatewayTimeoutError, ServiceUnavailableError, TooManyRequestsError

from app import usage
from app.retrieval.glossary import expand_query
from app.retrieval_config import (
    CHROMA_MAX_QUERY_EMBEDDINGS,
    COLLECTION,
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    chroma_client,
    cohere_client,
)

log = logging.getLogger("uvicorn.error")

# Waits before each retry of a Cohere call, in seconds. A trial key allows few calls a minute
# and a call can time out, so one slow or refused call should not fail a whole chat answer.
RETRY_DELAYS = (2.0, 5.0)
_RETRYABLE = (
    httpx.TransportError,
    TooManyRequestsError,
    ServiceUnavailableError,
    GatewayTimeoutError,
)


def _with_retries(call, what: str):
    """Return call(), trying again after a timeout, rate limit or outage; raise the last error.

    Any other error (a bad request, a bad key) is raised at once: retrying cannot fix it.
    """
    for attempt, delay in enumerate((*RETRY_DELAYS, None), start=1):
        try:
            return call()
        except _RETRYABLE as error:
            if delay is None:
                log.error("Cohere %s failed after %d tries: %r", what, attempt, error)
                raise
            log.warning(
                "Cohere %s failed (%r); retry %d of %d in %.0f s",
                what, error, attempt, len(RETRY_DELAYS), delay,
            )  # fmt: skip
            time.sleep(delay)


def _match(key: str, value: str | list[str]) -> str | dict:
    if isinstance(value, list):
        return {"$in": value}
    return value if key == "source_type" else {"$in": [value, "all"]}


def label_filter(filters: dict[str, str | list[str]], include_withdrawn: bool = False) -> dict:
    """Return the Chroma `where` clause (a metadata filter) for label filters.

    Source type matches exactly, or any one of a list of source types. Country and
    facility type also match passages labelled `all`, since such a document applies to
    every site.
    Withdrawn passages (KB-01 AC13) and passages of a document with Unconfirmed details
    (`needs_review`, IN-05 AC5) are always excluded. `$nin` also matches passages with no
    status label (checked against Chroma 1.5.5), so passages indexed before the status label
    existed stay retrievable.
    Chroma needs `$and` to combine two or more conditions. Minimal on purpose:
    RT-01 extends it for site applicability.
    `include_withdrawn` is for chat only, when the engineer names an edition (CB-01 AC14);
    report drafting never sets it, so a withdrawn edition can't reach a report.
    """
    conditions = [{key: _match(key, value)} for key, value in filters.items()]
    hidden = ["needs_review"] if include_withdrawn else ["withdrawn", "needs_review"]
    conditions.append({"status": {"$nin": hidden}})
    return {"$and": conditions} if len(conditions) > 1 else conditions[0]


def _record_embed(response, started: float) -> None:
    usage.record(
        "retrieval",
        "cohere-embed",
        EMBEDDING_MODEL,
        started,
        input_tokens=usage.billed(response, "input_tokens"),
    )


# Chat widens its best hits: a table is read whole, any other passage with its
# neighbours, so an answer cut across passages (a clause and its list, a table's
# row groups) reaches the model together. Extras are capped so context stays small.
EXPAND_HITS = 3
EXPAND_EXTRA = 3
EXPAND_CHARS = 3000
BREAK = "\n\n"


def retrieve(
    query: str,
    filters: dict[str, str | list[str]] | None = None,
    include_withdrawn: bool = False,
    candidates: int = 20,
    top_n: int | None = 5,
    expand: bool = False,
) -> list[dict]:
    """Return the reranked passages for a query: `candidates` from Chroma, best `top_n` kept.

    `top_n=None` keeps every candidate, reranked; chat's report search uses that with 40
    candidates to find every report. One rerank call either way (Cohere bills up to 100).
    `expand` widens the best few hits to their table or neighbours (`widen`).
    Short forms in the query ("EH2") are spelled out before it is embedded and reranked.
    """
    if not query.strip():
        raise ValueError("Query must not be blank")
    query = expand_query(query)
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return []
    count = collection.count()
    if not count:
        return []
    cohere = cohere_client()
    started = time.perf_counter()
    embedding = _with_retries(
        lambda: cohere.embed(
            model=EMBEDDING_MODEL,
            texts=[query],
            input_type="search_query",
            embedding_types=["float"],
            output_dimension=EMBEDDING_DIMENSION,
            truncate="NONE",
        ),
        "embed",
    )
    _record_embed(embedding, started)
    nearest = collection.query(
        query_embeddings=embedding.embeddings.float_,
        n_results=min(candidates, count),
        where=label_filter(filters or {}, include_withdrawn),
        include=["documents", "metadatas", "distances"],
    )
    hits = rerank(
        query,
        [
            {"id": id_, "text": text, "metadata": metadata, "distance": distance}
            for id_, text, metadata, distance in zip(
                nearest["ids"][0],
                nearest["documents"][0],
                nearest["metadatas"][0],
                nearest["distances"][0],
            )
        ],
        top_n=top_n,
    )
    return widen(hits, collection, include_withdrawn) if expand else hits


def rank_text(passage: dict) -> str:
    """The passage as the reranker reads it: heading trail, then text.

    Ingestion embeds the same string (`indexer.embedding_text`); change them together.
    """
    trail = " > ".join((passage.get("metadata") or {}).get("headings") or [])
    return f"{trail}\n{passage['text']}" if trail else passage["text"]


def _group(passage_id: str) -> int:
    """Row group number from an id like `doc:table:5:g2`; 0 for any other passage."""
    found = re.search(r":g(\d+)(?::part\d+)?$", passage_id)
    return int(found.group(1)) if found else 0


def _around(hit: dict, collection, include_withdrawn: bool) -> list[dict]:
    """The other passages of the hit's table, else its neighbours, in reading order."""
    meta = hit["metadata"]
    doc_id = meta.get("doc_id")
    position = meta.get("position")
    if doc_id is None:
        return []
    if meta.get("table_id"):
        where = [{"doc_id": doc_id}, {"table_id": meta["table_id"]}]
    elif isinstance(position, int):
        where = [{"doc_id": doc_id}, {"position": {"$in": [position - 1, position + 1]}}]
    else:
        return []
    hidden = ["needs_review"] if include_withdrawn else ["withdrawn", "needs_review"]
    found = collection.get(
        where={"$and": [*where, {"status": {"$nin": hidden}}]},
        include=["documents", "metadatas"],
    )
    others = [
        {"id": id_, "text": text, "metadata": metadata}
        for id_, text, metadata in zip(found["ids"], found["documents"], found["metadatas"])
        if id_ != hit["id"]
    ]
    others.sort(key=lambda p: (p["metadata"].get("position", 0), _group(p["id"])))
    return others


def widen(hits: list[dict], collection, include_withdrawn: bool = False) -> list[dict]:
    """Merge each of the best hits with its table or neighbours into one passage.

    The hit keeps its id, rank and score; its text becomes the whole table, or the
    neighbours before and after it, and its pages cover them all. At most
    `EXPAND_EXTRA` passages and `EXPAND_CHARS` characters are added per hit, nearest
    first, and withdrawn or unconfirmed passages are never added.
    """
    widened = []
    for rank, hit in enumerate(hits):
        if rank >= EXPAND_HITS:
            widened.append(hit)
            continue
        position, group = hit["metadata"].get("position", 0), _group(hit["id"])
        nearest = sorted(
            _around(hit, collection, include_withdrawn),
            key=lambda p: (
                abs(p["metadata"].get("position", 0) - position),
                abs(_group(p["id"]) - group),
            ),
        )
        extra, size = [], 0
        for other in nearest[:EXPAND_EXTRA]:
            if size + len(other["text"]) > EXPAND_CHARS:
                break
            extra.append(other)
            size += len(other["text"])
        if not extra:
            widened.append(hit)
            continue
        members = sorted(
            [hit, *extra], key=lambda p: (p["metadata"].get("position", 0), _group(p["id"]))
        )
        pages = [
            page
            for member in members
            for page in (member["metadata"].get("page_start"), member["metadata"].get("page_end"))
            if isinstance(page, int)
        ]
        meta = dict(hit["metadata"])
        if pages:
            meta["page_start"], meta["page_end"] = min(pages), max(pages)
        widened.append(
            {
                **hit,
                "text": BREAK.join(member["text"] for member in members),
                "metadata": {**meta, "widened_from": [member["id"] for member in members]},
            }
        )
    return widened


def rerank(query: str, passages: list[dict], top_n: int | None = None) -> list[dict]:
    """Reorder passages by Cohere Rerank, most relevant first, keeping the top `top_n`.

    A reranker reads the query and each passage together, so it judges whether a
    passage answers the query better than vector distance does. One Cohere call; the
    trial key allows 10 a minute. Each passage gains its `relevance_score`.
    """
    if not passages:
        return []
    model = os.getenv("RERANK_MODEL", "rerank-v3.5")
    started = time.perf_counter()
    ranked = _with_retries(
        lambda: cohere_client().rerank(
            model=model,
            query=query,
            documents=[rank_text(p) for p in passages],
            top_n=min(top_n or len(passages), len(passages)),
        ),
        "rerank",
    )
    usage.record(
        "retrieval",
        "cohere-rerank",
        model,
        started,
        search_units=usage.billed(ranked, "search_units"),
    )
    return [
        {**passages[hit.index], "relevance_score": hit.relevance_score} for hit in ranked.results
    ]


def search(requests: list[tuple[str, dict, int]]) -> list[list[dict]]:
    """Run several searches with one Cohere call, for drafting a section.

    Each request is `(query, filters, k)` and gets its `k` nearest passages, nearest
    first. All queries are embedded in one call, and requests sharing filters and `k`
    share one Chroma query. A Cohere trial key allows 10 calls a minute, so one search
    per subsection with `retrieve()` (embed and rerank each) would hit the limit on a
    large section, so callers rerank the combined hits once with `rerank()` (GN-01 AC14).
    """
    empty = [[] for _ in requests]
    if not requests:
        return empty
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return empty
    count = collection.count()
    if not count:
        return empty
    started = time.perf_counter()
    embedding = _with_retries(
        lambda: cohere_client().embed(
            model=EMBEDDING_MODEL,
            texts=[query for query, _, _ in requests],
            input_type="search_query",
            embedding_types=["float"],
            output_dimension=EMBEDDING_DIMENSION,
            truncate="NONE",
        ),
        "embed",
    )
    _record_embed(embedding, started)
    vectors = embedding.embeddings.float_
    groups: dict[tuple[str, int], list[int]] = {}
    for i, (_, filters, k) in enumerate(requests):
        groups.setdefault((json.dumps(filters, sort_keys=True), k), []).append(i)
    results = empty
    for (filters, k), group in groups.items():
        # Chroma Cloud allows CHROMA_MAX_QUERY_EMBEDDINGS per query, so a large group is
        # queried in batches (a section can search one query per observation).
        for start in range(0, len(group), CHROMA_MAX_QUERY_EMBEDDINGS):
            indexes = group[start : start + CHROMA_MAX_QUERY_EMBEDDINGS]
            found = collection.query(
                query_embeddings=[vectors[i] for i in indexes],
                n_results=min(k, count),
                where=label_filter(json.loads(filters)),
                include=["documents", "metadatas", "distances"],
            )
            for row, i in enumerate(indexes):
                results[i] = [
                    {
                        "id": found["ids"][row][n],
                        "text": found["documents"][row][n],
                        "metadata": found["metadatas"][row][n],
                        "distance": found["distances"][row][n],
                    }
                    for n in range(len(found["ids"][row]))
                ]
    return results

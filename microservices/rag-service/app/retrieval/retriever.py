"""Cohere query embedding -> Chroma vector search -> Cohere reranking."""

import json
import os

from chromadb.errors import NotFoundError

from app.retrieval_config import (
    COLLECTION,
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    chroma_client,
    cohere_client,
)


def _match(key: str, value: str | list[str]) -> str | dict:
    if isinstance(value, list):
        return {"$in": value}
    return value if key == "source_type" else {"$in": [value, "all"]}


def label_filter(filters: dict[str, str | list[str]]) -> dict:
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
    """
    conditions = [{key: _match(key, value)} for key, value in filters.items()]
    conditions.append({"status": {"$nin": ["withdrawn", "needs_review"]}})
    return {"$and": conditions} if len(conditions) > 1 else conditions[0]


def retrieve(query: str, filters: dict[str, str | list[str]] | None = None) -> list[dict]:
    if not query.strip():
        raise ValueError("Query must not be blank")
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return []
    count = collection.count()
    if not count:
        return []
    cohere = cohere_client()
    embedding = cohere.embed(
        model=EMBEDDING_MODEL,
        texts=[query],
        input_type="search_query",
        embedding_types=["float"],
        output_dimension=EMBEDDING_DIMENSION,
        truncate="NONE",
    )
    candidates = collection.query(
        query_embeddings=embedding.embeddings.float_,
        n_results=min(20, count),
        where=label_filter(filters or {}),
        include=["documents", "metadatas", "distances"],
    )
    return rerank(
        query,
        [
            {"id": id_, "text": text, "metadata": metadata, "distance": distance}
            for id_, text, metadata, distance in zip(
                candidates["ids"][0],
                candidates["documents"][0],
                candidates["metadatas"][0],
                candidates["distances"][0],
            )
        ],
        top_n=5,
    )


def rerank(query: str, passages: list[dict], top_n: int | None = None) -> list[dict]:
    """Reorder passages by Cohere Rerank, most relevant first, keeping the top `top_n`.

    A reranker reads the query and each passage together, so it judges whether a
    passage answers the query better than vector distance does. One Cohere call; the
    trial key allows 10 a minute. Each passage gains its `relevance_score`.
    """
    if not passages:
        return []
    ranked = cohere_client().rerank(
        model=os.getenv("RERANK_MODEL", "rerank-v3.5"),
        query=query,
        documents=[p["text"] for p in passages],
        top_n=min(top_n or len(passages), len(passages)),
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
    vectors = (
        cohere_client()
        .embed(
            model=EMBEDDING_MODEL,
            texts=[query for query, _, _ in requests],
            input_type="search_query",
            embedding_types=["float"],
            output_dimension=EMBEDDING_DIMENSION,
            truncate="NONE",
        )
        .embeddings.float_
    )
    groups: dict[tuple[str, int], list[int]] = {}
    for i, (_, filters, k) in enumerate(requests):
        groups.setdefault((json.dumps(filters, sort_keys=True), k), []).append(i)
    results = empty
    for (filters, k), indexes in groups.items():
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

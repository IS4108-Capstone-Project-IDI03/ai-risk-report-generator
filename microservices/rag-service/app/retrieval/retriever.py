"""Cohere query embedding -> Chroma vector search -> Cohere reranking."""

import os

from chromadb.errors import NotFoundError

from app.retrieval_config import (
    COLLECTION,
    EMBEDDING_DIMENSION,
    EMBEDDING_MODEL,
    chroma_client,
    cohere_client,
)


def label_filter(filters: dict[str, str]) -> dict:
    """Return the Chroma `where` clause (a metadata filter) for label filters.

    Source type matches exactly. Country and facility type also match
    passages labelled `all`, since such a document applies to every site.
    Withdrawn passages are always excluded (KB-02 AC2). `$ne` also matches
    passages with no status label, so passages indexed before KB-02 stay
    retrievable (checked against Chroma 1.5.5 on 2026-10-01).
    Chroma needs `$and` to combine two or more conditions. Minimal on purpose:
    RT-01 extends it for site applicability.
    """
    conditions = [
        {key: value if key == "source_type" else {"$in": [value, "all"]}}
        for key, value in filters.items()
    ]
    conditions.append({"status": {"$ne": "withdrawn"}})
    return {"$and": conditions} if len(conditions) > 1 else conditions[0]


def retrieve(query: str, filters: dict[str, str] | None = None) -> list[dict]:
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
    texts = candidates["documents"][0]
    if not texts:
        return []
    ranked = cohere.rerank(
        model=os.getenv("RERANK_MODEL", "rerank-v3.5"),
        query=query,
        documents=texts,
        top_n=min(5, len(texts)),
    )
    return [
        {
            "id": candidates["ids"][0][hit.index],
            "text": texts[hit.index],
            "metadata": candidates["metadatas"][0][hit.index],
            "distance": candidates["distances"][0][hit.index],
            "relevance_score": hit.relevance_score,
        }
        for hit in ranked.results
    ]

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


def retrieve(query: str) -> list[dict]:
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

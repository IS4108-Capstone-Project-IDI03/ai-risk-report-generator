"""Embed already anonymised chunks; indexer handles storage."""

from app.retrieval_config import EMBEDDING_DIMENSION, EMBEDDING_MODEL, cohere_client


def embed(chunks: list[str]) -> list[list[float]]:
    if not chunks:
        return []
    return (
        cohere_client()
        .embed(
            model=EMBEDDING_MODEL,
            texts=chunks,
            input_type="search_document",
            embedding_types=["float"],
            output_dimension=EMBEDDING_DIMENSION,
            truncate="NONE",
        )
        .embeddings.float_
    )

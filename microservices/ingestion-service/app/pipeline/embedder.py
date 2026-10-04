"""Embed already anonymised chunks; indexer handles storage."""

from app.retrieval_config import EMBEDDING_DIMENSION, EMBEDDING_MODEL, cohere_client

# Cohere /v2/embed accepts at most 96 texts per request.
_COHERE_BATCH_LIMIT = 96


def embed(chunks: list[str]) -> list[list[float]]:
    if not chunks:
        return []
    client = cohere_client()
    vectors: list[list[float]] = []
    for i in range(0, len(chunks), _COHERE_BATCH_LIMIT):
        batch = chunks[i : i + _COHERE_BATCH_LIMIT]
        result = client.embed(
            model=EMBEDDING_MODEL,
            texts=batch,
            input_type="search_document",
            embedding_types=["float"],
            output_dimension=EMBEDDING_DIMENSION,
            truncate="NONE",
        )
        vectors.extend(result.embeddings.float_)
    return vectors

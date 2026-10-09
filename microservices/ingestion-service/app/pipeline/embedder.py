"""Embed already anonymised chunks; indexer handles storage."""

import logging
import time

from cohere.errors import TooManyRequestsError

from app.retrieval_config import EMBEDDING_DIMENSION, EMBEDDING_MODEL, cohere_client

# Cohere /v2/embed accepts at most 96 texts per request.
_COHERE_BATCH_LIMIT = 96
_COHERE_RATE_LIMIT_DELAY_SECONDS = 70
_COHERE_RATE_LIMIT_RETRIES = 5

log = logging.getLogger(__name__)


def _embed_batch(client, batch: list[str]):
    rate_limit_retries = 0
    while True:
        try:
            return client.embed(
                model=EMBEDDING_MODEL,
                texts=batch,
                input_type="search_document",
                embedding_types=["float"],
                output_dimension=EMBEDDING_DIMENSION,
                truncate="NONE",
            )
        except TooManyRequestsError:
            if rate_limit_retries >= _COHERE_RATE_LIMIT_RETRIES:
                raise
            rate_limit_retries += 1
            log.warning(
                "Cohere embedding rate limit hit; retrying in %s seconds (%s/%s).",
                _COHERE_RATE_LIMIT_DELAY_SECONDS,
                rate_limit_retries,
                _COHERE_RATE_LIMIT_RETRIES,
            )
            time.sleep(_COHERE_RATE_LIMIT_DELAY_SECONDS)


def embed(chunks: list[str]) -> list[list[float]]:
    if not chunks:
        return []
    client = cohere_client()
    vectors: list[list[float]] = []
    for i in range(0, len(chunks), _COHERE_BATCH_LIMIT):
        batch = chunks[i : i + _COHERE_BATCH_LIMIT]
        result = _embed_batch(client, batch)
        vectors.extend(result.embeddings.float_)
    return vectors

"""Embed already anonymised chunks; indexer handles storage."""

import logging
import time

from cohere.errors import TooManyRequestsError

from app.retrieval_config import EMBEDDING_DIMENSION, EMBEDDING_MODEL, cohere_client

# Cohere /v2/embed accepts at most 96 texts per request.
_COHERE_BATCH_LIMIT = 96
# A trial key allows 100,000 tokens per minute; stay under it so one batch never
# uses the whole minute on its own.
_COHERE_TOKENS_PER_MINUTE = 80_000
# Rough count that errs high: English runs ~4 characters per token, but number-heavy
# table records can run near 1. Avoids loading a tokenizer just to pace requests;
# a batch that still overshoots is split in half on its 429 (see _embed_batch).
_CHARS_PER_TOKEN = 2
# A rate-limited batch of several texts waits out the minute, then goes in halves.
_COHERE_SPLIT_DELAY_SECONDS = 60
_COHERE_RATE_LIMIT_DELAY_SECONDS = 90
_COHERE_RATE_LIMIT_RETRIES = 10

log = logging.getLogger(__name__)


def _tokens(text: str) -> int:
    return len(text) // _CHARS_PER_TOKEN + 1


def _batches(chunks: list[str]):
    """Yield batches capped by text count and by the per-minute token budget.

    A single text over the budget gets a batch of its own.
    """
    batch, batch_tokens = [], 0
    for text in chunks:
        tokens = _tokens(text)
        if batch and (
            len(batch) == _COHERE_BATCH_LIMIT or batch_tokens + tokens > _COHERE_TOKENS_PER_MINUTE
        ):
            yield batch, batch_tokens
            batch, batch_tokens = [], 0
        batch.append(text)
        batch_tokens += tokens
    if batch:
        yield batch, batch_tokens


def _embed_batch(client, batch: list[str]) -> list[list[float]]:
    """Embed one batch, splitting it in half while Cohere rejects it as too big.

    A batch over the per-minute token budget fails on every retry however long
    the wait, so retries are kept for single texts.
    """
    rate_limit_retries = 0
    while True:
        try:
            result = client.embed(
                model=EMBEDDING_MODEL,
                texts=batch,
                input_type="search_document",
                embedding_types=["float"],
                output_dimension=EMBEDDING_DIMENSION,
                truncate="NONE",
            )
            return result.embeddings.float_
        except TooManyRequestsError as error:
            if len(batch) > 1:
                log.warning(
                    "Cohere embedding rate limit hit (%s); splitting %s texts in half "
                    "after %s seconds.",
                    getattr(error, "body", error),
                    len(batch),
                    _COHERE_SPLIT_DELAY_SECONDS,
                )
                time.sleep(_COHERE_SPLIT_DELAY_SECONDS)
                mid = len(batch) // 2
                first = _embed_batch(client, batch[:mid])
                time.sleep(_COHERE_SPLIT_DELAY_SECONDS)
                return first + _embed_batch(client, batch[mid:])
            if rate_limit_retries >= _COHERE_RATE_LIMIT_RETRIES:
                raise
            rate_limit_retries += 1
            log.warning(
                "Cohere embedding rate limit hit (%s); retrying in %s seconds (%s/%s).",
                getattr(error, "body", error),
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
    # Tokens sent since window_start; the next batch waits out the minute when it
    # would push the window over the budget.
    window_start, window_tokens = None, 0
    for batch, batch_tokens in _batches(chunks):
        if window_start is not None and window_tokens + batch_tokens > _COHERE_TOKENS_PER_MINUTE:
            wait = 60 - (time.monotonic() - window_start)
            if wait > 0:
                time.sleep(wait)
            window_start = None
        if window_start is None:
            window_start, window_tokens = time.monotonic(), 0
        window_tokens += batch_tokens
        vectors.extend(_embed_batch(client, batch))
    return vectors

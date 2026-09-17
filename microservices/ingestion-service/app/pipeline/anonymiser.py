"""Stage 3: anonymise chunks before they are embedded and stored.

Positioned AFTER chunking, so it is the last transform before `index_chunks`
embeds and upserts. For now this is a pass-through: it takes the chunk dicts and
returns them unchanged.

Real PII stripping/masking is future work. When it lands it must:
- rewrite each chunk's ``text`` to remove PII, and
- scrub PII from chunk metadata (e.g. headings/captions),
while keeping each chunk's ``id`` and remaining metadata intact. Running here
(post-chunk) guarantees no PII reaches the embedder or the vector store.
"""


def anonymise(chunks: list[dict]) -> list[dict]:
    """Return the chunk dicts unchanged (pass-through).

    Args:
        chunks: index-ready chunk dicts (``{"id", "text", "metadata"}``).

    Returns:
        The same chunks, untouched. A future implementation will mask PII in
        each chunk's text and metadata without altering ids.
    """
    return chunks

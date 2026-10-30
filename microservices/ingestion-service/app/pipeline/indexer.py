"""Stage 4: upsert anonymised chunks with stable IDs and citation metadata."""

import os

from chromadb.errors import NotFoundError

from app.pipeline.embedder import embed
from app.retrieval_config import COLLECTION, chroma_client

"""
Chunk (as produced by chunker.chunk and consumed here):
{
    "id":   str,              # stable unique id; also the Chroma record id
    "text": str,              # chunk text; embedded via Cohere and stored as the document
    "metadata": {             # forwarded to Chroma verbatim; scalars or a
    # non-empty homogeneous list of scalars
        "section":      str,  # report section, "Appendix" or "Undefined" (IN-05)
        "doc_id":       str,  # foreign key back to the source document
        "headings": list[str],# heading trail; key omitted when the chunk has none
        "page_start":   int,  # present only when known
        "page_end":     int,  # present only when known
        "bbox":         list[float], # flattened [l, t, r, b] values in page order
        "bbox_pages":   list[int],   # page of each 4-number box in bbox (IN-12)
        # A described picture's passage only (IN-13): its text holds a model's words.
        "generated_text": str,   # "picture_description"
        "generated_by":   str,   # "<provider>:<model>" that wrote it
        "prompt_version": str,   # picture prompt version, e.g. "pic-v1"
    },
}
Note: the embedding is NOT a chunk field — index_chunks computes it from `text`.
"""


# Chroma Cloud rejects a stored document over 16,384 bytes ("Document size
# (bytes)" quota). Kept a little under, for the UTF-8 newline joins.
MAX_DOCUMENT_BYTES = 16_000


# Chroma Cloud's per-request caps: "Maximum number of records per write" and
# "Maximum number of results returned" are both 300. The client's own pre-check
# (get_max_batch_size, 1000) is looser, so writes are cut to this size and
# reads are paged by it.
CHROMA_BATCH_SIZE = 300


def _batched(*columns: list):
    """Yield slices of equal-length lists, CHROMA_BATCH_SIZE rows at a time."""
    for start in range(0, len(columns[0]), CHROMA_BATCH_SIZE):
        yield [column[start : start + CHROMA_BATCH_SIZE] for column in columns]


def get_all(collection, where: dict, include: list) -> dict:
    """`collection.get` paged past the 300-result cap, with the results concatenated."""
    out = {"ids": [], **{field: [] for field in include}}
    offset = 0
    while True:
        page = collection.get(where=where, include=include, limit=CHROMA_BATCH_SIZE, offset=offset)
        for key, values in out.items():
            values.extend(page[key])
        if len(page["ids"]) < CHROMA_BATCH_SIZE:
            return out
        offset += CHROMA_BATCH_SIZE


def _size(text: str) -> int:
    return len(text.encode("utf-8"))


def _split_long_line(line: str, limit: int) -> list[str]:
    """Split one over-limit line at spaces (last resort; records are short)."""
    parts, current = [], ""
    for word in line.split(" "):
        candidate = f"{current} {word}" if current else word
        if current and _size(candidate) > limit:
            parts.append(current)
            current = word
        else:
            current = candidate
    return parts + [current] if current else parts


def split_for_storage(text: str, limit: int = MAX_DOCUMENT_BYTES) -> list[str]:
    """`text` in parts of at most `limit` bytes, split between lines.

    A table chunk is one "Heading: value; ..." record per line, each carrying
    its own headings, so a part boundary between lines loses nothing.
    """
    if _size(text) <= limit:
        return [text]
    lines = []
    for line in text.split("\n"):
        lines += _split_long_line(line, limit) if _size(line) > limit else [line]
    parts, current = [], ""
    for line in lines:
        candidate = f"{current}\n{line}" if current else line
        if current and _size(candidate) > limit:
            parts.append(current)
            current = line
        else:
            current = candidate
    return parts + [current] if current else parts


def _storable(chunks: list[dict]) -> list[dict]:
    """Chunks too big for one stored document become `<id>:partN`, same metadata."""
    out = []
    for chunk in chunks:
        parts = split_for_storage(chunk["text"])
        if len(parts) == 1:
            out.append(chunk)
            continue
        out += [
            {**chunk, "id": f"{chunk['id']}:part{n}", "text": part}
            for n, part in enumerate(parts, start=1)
        ]
    return out


def embedding_text(chunk: dict) -> str:
    """What a passage is embedded as: its heading trail, then its text.

    The trail ("Chapter 20 > 20.15 Water Supply") says what a passage is about when
    its own words don't, e.g. a table whose title is a heading. Search shows and
    quotes the plain text, so only the vector sees the trail. The rag-service
    reranker builds the same string (`retriever.rank_text`); change them together.
    """
    trail = " > ".join((chunk.get("metadata") or {}).get("headings") or [])
    return f"{trail}\n{chunk['text']}" if trail else chunk["text"]


def index_chunks(chunks: list[dict], reporter=None, page_total: int | None = None) -> int:
    """Embed and upsert chunks; return how many passages were stored.

    reporter: an optional ProgressReporter, told the page reached after each
        embedding batch against `page_total`. Chunks arrive in reading order, so
        the furthest `page_end` embedded so far is the page reached.
    """
    chunks = _storable(chunks)
    texts = [chunk["text"] for chunk in chunks]
    # Furthest page_end among the first n chunks, for each n.
    page_reached, furthest = [0], 0
    for chunk in chunks:
        page_end = (chunk.get("metadata") or {}).get("page_end")
        if isinstance(page_end, int):
            furthest = max(furthest, page_end)
        page_reached.append(furthest)

    def on_batch(embedded: int) -> None:
        if reporter and page_reached[embedded]:
            reporter.update_pages(page_reached[embedded], page_total)

    vectors = embed([embedding_text(chunk) for chunk in chunks], on_batch=on_batch)
    index_type = "spann" if os.getenv("CHROMA_MODE", "local").strip().lower() == "cloud" else "hnsw"
    collection = chroma_client().get_or_create_collection(
        name=COLLECTION,
        embedding_function=None,
        configuration={index_type: {"space": "cosine"}},
    )
    columns = (
        [chunk["id"] for chunk in chunks],
        texts,
        vectors,
        [chunk["metadata"] for chunk in chunks],
    )
    for ids, documents, embeddings, metadatas in _batched(*columns):
        collection.upsert(ids=ids, documents=documents, embeddings=embeddings, metadatas=metadatas)
        if reporter:
            reporter.check_cancelled()
    # Trailing pages with no passage never move the counter; indexing is done with them.
    if reporter and page_total and furthest < page_total:
        reporter.update_pages(page_total, page_total)
    return len(chunks)


def relabel(doc_id: str, labels: dict) -> int:
    """Return how many of the document's passages got the new labels (KB-01).

    Rewrites only metadata, so a corrected label reaches search without
    re-embedding. The merge happens here rather than relying on Chroma's
    update semantics, so headings, pages and bbox are always kept.
    """
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:  # nothing indexed yet
        return 0
    found = get_all(collection, where={"doc_id": doc_id}, include=["metadatas"])
    if not found["ids"]:
        return 0
    merged = [{**metadata, **labels} for metadata in found["metadatas"]]
    for ids, metadatas in _batched(found["ids"], merged):
        collection.update(ids=ids, metadatas=metadatas)
    return len(found["ids"])


def delete_passages(doc_id: str) -> int:
    """Delete all indexed passages for a document; return the number removed."""
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return 0
    ids = get_all(collection, where={"doc_id": doc_id}, include=[])["ids"]
    for (batch,) in _batched(ids):
        collection.delete(ids=batch)
    return len(ids)

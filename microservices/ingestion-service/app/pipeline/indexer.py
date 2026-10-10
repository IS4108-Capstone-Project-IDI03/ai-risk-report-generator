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
    },
}
Note: the embedding is NOT a chunk field — index_chunks computes it from `text`.
"""


# Chroma Cloud rejects a stored document over 16,384 bytes ("Document size
# (bytes)" quota). Kept a little under, for the UTF-8 newline joins.
MAX_DOCUMENT_BYTES = 16_000


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


def index_chunks(chunks: list[dict]) -> int:
    """Embed and upsert chunks; return how many passages were stored."""
    chunks = _storable(chunks)
    texts = [chunk["text"] for chunk in chunks]
    vectors = embed(texts)
    index_type = "spann" if os.getenv("CHROMA_MODE", "local").strip().lower() == "cloud" else "hnsw"
    collection = chroma_client().get_or_create_collection(
        name=COLLECTION,
        embedding_function=None,
        configuration={index_type: {"space": "cosine"}},
    )
    collection.upsert(
        ids=[chunk["id"] for chunk in chunks],
        documents=texts,
        embeddings=vectors,
        metadatas=[chunk["metadata"] for chunk in chunks],
    )
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
    found = collection.get(where={"doc_id": doc_id}, include=["metadatas"])
    if not found["ids"]:
        return 0
    collection.update(
        ids=found["ids"],
        metadatas=[{**metadata, **labels} for metadata in found["metadatas"]],
    )
    return len(found["ids"])


def delete_passages(doc_id: str) -> int:
    """Delete all indexed passages for a document; return the number removed."""
    try:
        collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    except NotFoundError:
        return 0
    found = collection.get(where={"doc_id": doc_id}, include=[])
    ids = found["ids"]
    if ids:
        collection.delete(ids=ids)
    return len(ids)

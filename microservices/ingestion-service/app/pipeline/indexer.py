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
        "doc_id":       str,  # foreign key back to the source document
        "headings": list[str],# heading trail; key omitted when the chunk has none
        "page_start":   int,  # present only when known
        "page_end":     int,  # present only when known
        "bbox":         list[float], # flattened [l, t, r, b] values in page order
    },
}
Note: the embedding is NOT a chunk field — index_chunks computes it from `text`.
"""


def index_chunks(chunks: list[dict]) -> int:
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

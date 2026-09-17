"""Stage 4: upsert anonymised chunks with stable IDs and citation metadata."""

import os

from app.pipeline.embedder import embed
from app.retrieval_config import COLLECTION, chroma_client

"""
Chunk (as produced by chunker.chunk and consumed here):
{
    "id":   str,              # stable unique id; also the Chroma record id
    "text": str,              # chunk text; embedded via Cohere and stored as the document
    "metadata": {             # forwarded to Chroma verbatim; values MUST be scalars
        "doc_id":       str,  # foreign key back to the source document
        "section_path": str,  # heading trail, " > "-joined (Chroma needs scalars)
        "page_start":   int,  # present only when known
        "page_end":     int,  # present only when known
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

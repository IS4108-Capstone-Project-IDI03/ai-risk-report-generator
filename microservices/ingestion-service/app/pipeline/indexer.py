"""Upsert already anonymised chunks with stable IDs and citation metadata."""

import os

from app.pipeline.embedder import embed
from app.retrieval_config import COLLECTION, chroma_client


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

"""Environment contract shared by independently deployed ingestion and RAG services."""

import os
from functools import lru_cache
from pathlib import Path

import chromadb
import cohere
from dotenv import load_dotenv

# Use the root .env locally; Compose supplies environment variables in containers.
load_dotenv(Path(__file__).resolve().parent / "../../../.env")

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "embed-v4.0")
EMBEDDING_DIMENSION = 1024
# Chroma Cloud's quota on query embeddings in one query call ("Number of query embeddings").
CHROMA_MAX_QUERY_EMBEDDINGS = 20
# A new model gets a new collection: vectors from different models cannot be mixed.
COLLECTION = f"{os.getenv('CHROMA_COLLECTION', 'risk_chunks')}_{EMBEDDING_MODEL}_1024"


@lru_cache
def cohere_client():
    key = os.getenv("COHERE_API_KEY", "").strip()
    if not key or key == "REPLACE_ME":
        raise RuntimeError("Set COHERE_API_KEY in the root .env before indexing or retrieving")
    return cohere.ClientV2(api_key=key, timeout=30)


@lru_cache
def chroma_client():
    mode = os.getenv("CHROMA_MODE", "local").strip().lower()
    if mode == "cloud":
        names = ("CHROMA_API_KEY", "CHROMA_TENANT", "CHROMA_DATABASE")
        values = [os.getenv(name, "").strip() for name in names]
        missing = [name for name, value in zip(names, values) if not value or value == "REPLACE_ME"]
        if missing:
            raise RuntimeError("Chroma Cloud requires: " + ", ".join(missing))
        return chromadb.CloudClient(
            api_key=values[0],
            tenant=values[1],
            database=values[2],
            cloud_host=os.getenv("CHROMA_CLOUD_HOST", "api.trychroma.com"),
        )
    if mode != "local":
        raise RuntimeError("CHROMA_MODE must be local or cloud")
    return chromadb.HttpClient(
        host=os.getenv("CHROMA_HOST", "localhost"),
        port=int(os.getenv("CHROMA_PORT", "8000")),
    )


@lru_cache
def qdrant_client():
    """The Qdrant client from QDRANT_URL (":memory:" for tests) and QDRANT_API_KEY (QD-01)."""
    from qdrant_client import QdrantClient

    url = os.getenv("QDRANT_URL", "").strip()
    if not url or url == "REPLACE_ME":
        raise RuntimeError("VECTOR_STORE=qdrant requires QDRANT_URL")
    if url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=url, api_key=os.getenv("QDRANT_API_KEY", "").strip() or None, timeout=30
    )


def vector_store() -> str:
    """Which vector store VECTOR_STORE names: "chroma" (the default) or "qdrant" (QD-01)."""
    store = os.getenv("VECTOR_STORE", "chroma").strip().lower()
    if store not in ("chroma", "qdrant"):
        # Fail closed: a typo must never quietly search the other store.
        raise RuntimeError("VECTOR_STORE must be chroma or qdrant")
    return store


def vector_collection(create: bool = False):
    """The passage collection in the chosen store; `create` makes it on Chroma if missing.

    Both stores answer the same calls (get, query, upsert, update, delete, count); see
    qdrant_collection.py. Raises Chroma's NotFoundError when Chroma has no collection yet.
    """
    if vector_store() == "qdrant":
        from app.qdrant_collection import QdrantCollection

        return QdrantCollection(qdrant_client(), COLLECTION, EMBEDDING_DIMENSION)
    if not create:
        return chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    # Chroma Cloud indexes with SPANN, a local Chroma with HNSW; both by cosine distance.
    index_type = "spann" if os.getenv("CHROMA_MODE", "local").strip().lower() == "cloud" else "hnsw"
    return chroma_client().get_or_create_collection(
        name=COLLECTION, embedding_function=None, configuration={index_type: {"space": "cosine"}}
    )

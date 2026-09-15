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

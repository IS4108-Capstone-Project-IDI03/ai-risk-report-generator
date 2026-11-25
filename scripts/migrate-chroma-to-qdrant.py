"""QD-01: copy every passage from Chroma to Qdrant, vectors included (no re-embedding).

Run: cd microservices/ingestion-service && uv run python ../../scripts/migrate-chroma-to-qdrant.py
Reads Chroma (never writes it), upserts by id so a second run changes nothing, and exits 1 if
the two counts differ. Calls the ingestion-service app's chroma_client, qdrant_client and
QdrantCollection, whatever VECTOR_STORE says.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "microservices/ingestion-service"))

from app.qdrant_collection import QdrantCollection  # noqa: E402
from app.retrieval_config import (  # noqa: E402
    COLLECTION,
    EMBEDDING_DIMENSION,
    chroma_client,
    qdrant_client,
)

PAGE = 300  # Chroma Cloud's read limit


def migrate(source, destination, page: int = PAGE) -> tuple[int, int]:
    """Copy all passages from source to destination; return (source count, destination count)."""
    include = ["documents", "metadatas", "embeddings"]
    for offset in range(0, source.count(), page):
        got = source.get(limit=page, offset=offset, include=include)
        destination.upsert(
            ids=got["ids"],
            documents=got["documents"],
            embeddings=[list(map(float, v)) for v in got["embeddings"]],
            metadatas=got["metadatas"],
        )
    return source.count(), destination.count()


if __name__ == "__main__":
    src = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    dst = QdrantCollection(qdrant_client(), COLLECTION, EMBEDDING_DIMENSION)
    copied_from, copied_to = migrate(src, dst)
    print(f"Chroma passages: {copied_from}\nQdrant passages: {copied_to}")
    sys.exit(0 if copied_from == copied_to else 1)

"""QD-01: the Chroma to Qdrant copy keeps text, metadata and the same vectors."""

import importlib.util
from math import cos, sin
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from app.qdrant_collection import QdrantCollection

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "migrate-chroma-to-qdrant.py"
spec = importlib.util.spec_from_file_location("migrate_script", SCRIPT)
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)

N = 7


class FakeSource:
    """The two Chroma calls the copy makes."""

    def __init__(self):
        self.ids = [f"doc:{i}" for i in range(N)]
        # Unit length: Qdrant's cosine store scales vectors to length 1.
        self.vectors = [[cos(i), sin(i), 0.0, 0.0] for i in range(N)]

    def count(self):
        return N

    def get(self, limit, offset, include):
        assert set(include) == {"documents", "metadatas", "embeddings"}
        rows = slice(offset, offset + limit)
        return {
            "ids": self.ids[rows],
            "documents": [f"text {i}" for i in range(N)][rows],
            "metadatas": [{"doc_id": "doc", "page_start": i} for i in range(N)][rows],
            "embeddings": self.vectors[rows],
        }


def test_copies_everything_and_is_safe_to_run_twice():
    source = FakeSource()
    destination = QdrantCollection(QdrantClient(location=":memory:"), "t", 4)

    for _ in range(2):
        assert script.migrate(source, destination, page=3) == (N, N)

    found = destination.get(include=["documents", "metadatas", "embeddings"])
    by_id = dict(
        zip(found["ids"], zip(found["documents"], found["metadatas"], found["embeddings"]))
    )
    assert len(by_id) == N
    for i, key in enumerate(source.ids):
        text, meta, vector = by_id[key]
        assert text == f"text {i}"
        assert meta == {"doc_id": "doc", "page_start": i}
        assert list(vector) == pytest.approx(source.vectors[i], abs=1e-6)

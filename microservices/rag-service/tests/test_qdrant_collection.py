"""QD-01: the Qdrant adapter answers each Chroma call the way Chroma does.

Runs on Qdrant's in-memory mode, so no container is needed. Each expectation is Chroma's own
behaviour, which the callers (retriever.py, indexer.py, ...) were written against.
"""

from pathlib import Path

import pytest
from qdrant_client import QdrantClient

from app.qdrant_collection import QdrantCollection, point_id, to_filter

DIM = 4


def vec(*xs):
    return [*xs, *[0.0] * (DIM - len(xs))]


@pytest.fixture
def store():
    s = QdrantCollection(QdrantClient(location=":memory:"), "t", dimension=DIM)
    s.upsert(
        ids=["a:1", "a:2", "b:1", "c:1"],
        embeddings=[vec(1), vec(0.9, 0.1), vec(0, 1), vec(0, 0, 1)],
        documents=["sprinklers", "pumps", "hot work", "unlabelled"],
        metadatas=[
            {"doc_id": "a", "status": "approved", "page_start": 3},
            {"doc_id": "a", "status": "approved", "page_start": 9},
            {"doc_id": "b", "status": "withdrawn", "page_start": 1},
            # No status yet: an admin has not filled its labels in (IN-05).
            {"doc_id": "c"},
        ],
    )
    return s


def test_count_and_get_by_id_return_chroma_shapes_in_the_asked_order(store):
    assert store.count() == 4
    got = store.get(ids=["b:1", "missing", "a:1"])
    assert got["ids"] == ["b:1", "a:1"]
    assert got["documents"] == ["hot work", "sprinklers"]
    assert got["metadatas"][1] == {"doc_id": "a", "status": "approved", "page_start": 3}
    assert got["embeddings"] is None
    assert store.get(ids=["a:1"], include=["embeddings"])["embeddings"][0][:2] == [1.0, 0.0]


def test_query_returns_nearest_first_with_cosine_distance(store):
    found = store.query(query_embeddings=[vec(1)], n_results=2)
    assert found["ids"] == [["a:1", "a:2"]]
    assert found["distances"][0][0] == pytest.approx(0.0, abs=1e-6)
    # Chroma's cosine distance: 1 - cos(angle).
    assert found["distances"][0][1] == pytest.approx(1 - 0.9 / (0.82**0.5), abs=1e-6)


def test_filters_match_chroma_including_missing_keys(store):
    def ids(where):
        return sorted(store.get(where=where)["ids"])

    assert ids({"doc_id": "a"}) == ["a:1", "a:2"]
    assert ids({"status": {"$in": ["withdrawn"]}}) == ["b:1"]
    # $ne and $nin never match a passage without the key, as in Chroma.
    assert ids({"status": {"$ne": "withdrawn"}}) == ["a:1", "a:2"]
    assert ids({"status": {"$nin": ["withdrawn", "needs_review"]}}) == ["a:1", "a:2"]
    assert ids({"$and": [{"doc_id": "a"}, {"page_start": {"$gte": 5}}]}) == ["a:2"]
    assert ids({"$or": [{"doc_id": "b"}, {"doc_id": "c"}]}) == ["b:1", "c:1"]
    withdrawn_left_out = store.query(
        query_embeddings=[vec(0, 1)], n_results=4, where={"status": {"$ne": "withdrawn"}}
    )
    assert "b:1" not in withdrawn_left_out["ids"][0]


def test_an_unknown_operator_is_refused_never_ignored():
    with pytest.raises(ValueError, match=r"\$contains"):
        to_filter({"doc_id": {"$contains": "a"}})


def test_update_merges_labels_and_keeps_the_vector(store):
    store.update(ids=["b:1"], metadatas=[{"status": "approved"}])
    got = store.get(ids=["b:1"], include=["metadatas", "embeddings"])
    assert got["metadatas"][0] == {"doc_id": "b", "status": "approved", "page_start": 1}
    assert got["embeddings"][0][:2] == [0.0, 1.0]


def test_upsert_twice_replaces_and_delete_removes(store):
    store.upsert(ids=["a:1"], embeddings=[vec(1)], documents=["new"], metadatas=[{"doc_id": "a"}])
    assert store.count() == 4
    assert store.get(ids=["a:1"])["documents"] == ["new"]
    store.delete(ids=["a:1", "a:2"])
    assert store.count() == 2 and store.get(where={"doc_id": "a"})["ids"] == []


def test_numbered_pages_read_every_passage_once(store):
    pages, offset = [], 0
    while True:
        page = store.get(where={"doc_id": {"$in": ["a", "b", "c"]}}, limit=3, offset=offset)
        if not page["ids"]:
            break
        pages += page["ids"]
        offset += len(page["ids"])
    assert sorted(pages) == ["a:1", "a:2", "b:1", "c:1"]
    # A fresh adapter (no remembered page) still finds page 2 by number.
    fresh = QdrantCollection(store.client, "t", dimension=DIM)
    assert len(fresh.get(limit=3, offset=3)["ids"]) == 1


def test_point_ids_are_stable_and_the_two_services_ship_the_same_adapter():
    assert point_id("a:1") == point_id("a:1") != point_id("a:2")
    here = Path(__file__).resolve().parents[1] / "app" / "qdrant_collection.py"
    there = here.parents[2] / "ingestion-service" / "app" / "qdrant_collection.py"
    assert here.read_text() == there.read_text()

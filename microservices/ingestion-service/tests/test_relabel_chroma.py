"""KB-01 AC8 against the real local Chroma: a corrected label reaches search.

The mocked tests can't prove Chroma itself applies the metadata update or the
`$in` filter, so this one uses the running server. Opt in with:
    uv run pytest -m chroma
"""

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.pipeline import indexer
from app.retrieval_config import COLLECTION, chroma_client

pytestmark = pytest.mark.chroma

DOC_ID = "kb01-ac8-test"
LABELS = {
    "source_type": "marsh_report",
    "jurisdiction": "MY",
    "facility_type": "Cold store",
    "effective_date": "2024-03-12",
}


def found(jurisdiction: str) -> list[str]:
    """Return the test document's passages a country-filtered search matches.

    The country condition is the clause rag-service's `label_filter` builds.
    """
    where = {"$and": [{"doc_id": DOC_ID}, {"jurisdiction": {"$in": [jurisdiction, "all"]}}]}
    collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    return collection.get(where=where)["ids"]


@pytest.fixture
def indexed(monkeypatch):
    # Skip, not error, without a server: CI's own `-m` replaces the `not chroma`
    # in pyproject.toml's addopts, so this test is selected there with no Chroma.
    try:
        chroma_client()
    except ValueError as error:  # chromadb: "Could not connect to a Chroma server"
        pytest.skip(f"needs the local Chroma server: {error}")
    # A fixed vector stands in for Cohere: this test is about labels, not meaning.
    monkeypatch.setattr(indexer, "embed", lambda texts: [[0.1] * 1024 for _ in texts])
    chunk = {"id": f"{DOC_ID}:0", "text": "Cold room doors.", "metadata": {"doc_id": DOC_ID}}
    indexer.index_chunks([{**chunk, "metadata": {**chunk["metadata"], **LABELS}}])
    yield
    chroma_client().get_collection(name=COLLECTION, embedding_function=None).delete(
        where={"doc_id": DOC_ID}
    )


def test_a_corrected_country_is_found_under_the_new_value_and_not_the_old(indexed):
    assert found("MY") == [f"{DOC_ID}:0"]

    response = TestClient(app).put(
        f"/documents/{DOC_ID}/labels", json={**LABELS, "jurisdiction": "SG"}
    )

    assert response.json() == {"passagesUpdated": 1}
    assert found("SG") == [f"{DOC_ID}:0"]
    assert found("MY") == []


def test_a_relabel_keeps_the_passages_own_section_and_a_missing_detail(indexed):
    # IN-05 AC11: no section in the request, and an omitted detail stays as it was.
    collection = chroma_client().get_collection(name=COLLECTION, embedding_function=None)
    collection.update(ids=[f"{DOC_ID}:0"], metadatas=[{"section": "Fire Protection"}])

    TestClient(app).put(f"/documents/{DOC_ID}/labels", json={"status": "needs_review"})

    metadata = collection.get(ids=[f"{DOC_ID}:0"], include=["metadatas"])["metadatas"][0]
    assert metadata["section"] == "Fire Protection"
    assert metadata["jurisdiction"] == "MY"
    assert metadata["status"] == "needs_review"

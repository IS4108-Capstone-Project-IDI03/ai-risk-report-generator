"""POST /retrieve: label filters (KB-01 AC8), no withdrawn passages (KB-01 AC13); Chroma faked."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from starlette.testclient import TestClient

from app.main import app
from app.retrieval import retriever

client = TestClient(app)


@pytest.fixture
def collection(monkeypatch):
    chroma, cohere = Mock(), Mock()
    found = chroma.get_collection.return_value
    found.count.return_value = 1
    empty = [[]]
    found.query.return_value = {
        "ids": empty,
        "documents": empty,
        "metadatas": empty,
        "distances": empty,
    }
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.3]]))
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    return found


def where_for(collection, filters):
    response = client.post("/retrieve", json={"query": "sprinkler spacing", "filters": filters})
    assert response.status_code == 200
    return collection.query.call_args.kwargs["where"]


ACTIVE_ONLY = {"status": {"$ne": "withdrawn"}}


def test_no_filters_still_skips_withdrawn_passages(collection):
    assert where_for(collection, {}) == ACTIVE_ONLY


def test_source_type_matches_exactly(collection):
    assert where_for(collection, {"source_type": "fm_standard"}) == {
        "$and": [{"source_type": "fm_standard"}, ACTIVE_ONLY]
    }


def test_country_and_facility_type_also_match_documents_labelled_all(collection):
    assert where_for(collection, {"jurisdiction": "SG"}) == {
        "$and": [{"jurisdiction": {"$in": ["SG", "all"]}}, ACTIVE_ONLY]
    }
    assert where_for(collection, {"facility_type": "Cold store", "jurisdiction": "SG"}) == {
        "$and": [
            {"jurisdiction": {"$in": ["SG", "all"]}},
            {"facility_type": {"$in": ["Cold store", "all"]}},
            ACTIVE_ONLY,
        ]
    }


def test_an_unknown_filter_is_refused(collection):
    response = client.post("/retrieve", json={"query": "sprinkler", "filters": {"colour": "red"}})
    assert response.status_code == 422

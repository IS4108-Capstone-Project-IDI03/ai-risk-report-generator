"""POST /retrieve narrowed by label filters (KB-01 AC8), with Chroma and Cohere faked."""

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


def test_no_filters_searches_everything(collection):
    assert where_for(collection, {}) is None


def test_source_type_matches_exactly(collection):
    assert where_for(collection, {"source_type": "fm_standard"}) == {"source_type": "fm_standard"}


def test_country_and_facility_type_also_match_documents_labelled_all(collection):
    assert where_for(collection, {"jurisdiction": "SG"}) == {"jurisdiction": {"$in": ["SG", "all"]}}
    assert where_for(collection, {"facility_type": "Cold store", "jurisdiction": "SG"}) == {
        "$and": [
            {"jurisdiction": {"$in": ["SG", "all"]}},
            {"facility_type": {"$in": ["Cold store", "all"]}},
        ]
    }


def test_an_unknown_filter_is_refused(collection):
    response = client.post("/retrieve", json={"query": "sprinkler", "filters": {"colour": "red"}})
    assert response.status_code == 422

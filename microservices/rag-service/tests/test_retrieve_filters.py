"""POST /retrieve: label filters (KB-01 AC8), no withdrawn (KB-01 AC13) or needs-review
(IN-05 AC5) passages; Chroma faked."""

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


ACTIVE_ONLY = {"status": {"$nin": ["withdrawn", "needs_review"]}}


def test_no_filters_still_skips_withdrawn_and_needs_review_passages(collection):
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


# CB-01 AC14: only chat may reach a withdrawn edition, and only when it asks to.
def test_label_filter_excludes_withdrawn_unless_asked():
    assert retriever.label_filter({}) == ACTIVE_ONLY
    assert retriever.label_filter({}, include_withdrawn=True) == {
        "status": {"$nin": ["needs_review"]}
    }


def test_retrieve_passes_include_withdrawn_to_the_filter(collection):
    retriever.retrieve("sprinkler spacing", {}, include_withdrawn=True)
    assert collection.query.call_args.kwargs["where"] == {"status": {"$nin": ["needs_review"]}}

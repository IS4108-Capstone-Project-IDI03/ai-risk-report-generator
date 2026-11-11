"""POST /passages/search (CP-32 AC2): keyword search for a checklist item's reference.

Chroma is faked, so no database or paid call is involved.
"""

from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.retrieval import keyword_search

client = TestClient(app)

RACKS = (
    "nfpa13:118",
    "In-rack sprinklers shall be provided for rack storage over 7.6 m in height.",
    {"doc_id": "nfpa13", "headings": ["Rack Storage"], "page_start": 118, "page_end": 118},
)
ROOF = (
    "nfpa13:40",
    "Roof decks of combustible construction shall be protected.",
    {"doc_id": "nfpa13", "headings": ["Construction"], "page_start": 40},
)
HYDRANTS = (
    "ss575:12",
    "Hydrants shall be within 50 m of every building entrance.",
    {"doc_id": "ss575", "headings": ["Hydrants", "x" * 300], "page_start": 12},
)


@pytest.fixture(autouse=True)
def empty_cache():
    keyword_search._cache.clear()
    yield
    keyword_search._cache.clear()


def fake_chroma(monkeypatch, passages, page=300):
    """A fake Chroma holding the passages, answering `get` by doc_id a page at a time."""
    monkeypatch.setattr(keyword_search, "PAGE", page)

    def get(where, include, limit, offset):
        doc_id = where["$and"][0]["doc_id"]
        rows = [p for p in passages if p[2]["doc_id"] == doc_id][offset : offset + limit]
        return {
            "ids": [r[0] for r in rows],
            "documents": [r[1] for r in rows],
            "metadatas": [r[2] for r in rows],
        }

    chroma = Mock()
    chroma.get_collection.return_value.get.side_effect = get
    monkeypatch.setattr(keyword_search, "chroma_client", lambda: chroma)
    return chroma.get_collection.return_value.get


def search(query, document_ids, **extra):
    return client.post(
        "/passages/search", json={"query": query, "document_ids": document_ids, **extra}
    )


def test_ranks_the_passages_sharing_the_most_telling_words_first(monkeypatch):
    fake_chroma(monkeypatch, [RACKS, ROOF, HYDRANTS])

    response = search("Check in-rack sprinkler protection for rack storage", ["nfpa13", "ss575"])

    assert response.status_code == 200
    results = response.json()["results"]
    # "sprinkler" finds "sprinklers"; the roof shares only "protected" (no plural match).
    assert [r["id"] for r in results] == ["nfpa13:118"]
    assert results[0] == {
        "id": "nfpa13:118",
        "documentId": "nfpa13",
        "text": RACKS[1],
        "headings": ["Rack Storage"],
        "pageStart": 118,
        "pageEnd": 118,
    }


def test_searches_only_the_documents_named_and_matches_headings(monkeypatch):
    fake_chroma(monkeypatch, [RACKS, ROOF, HYDRANTS])

    results = search("hydrants", ["nfpa13"]).json()["results"]
    assert results == []
    results = search("Construction", ["nfpa13", "ss575"]).json()["results"]
    assert [r["id"] for r in results] == ["nfpa13:40"]
    # A heading too long to be one is left out.
    assert search("hydrants", ["ss575"]).json()["results"][0]["headings"] == ["Hydrants"]


def test_reads_past_chromas_page_cap_and_reuses_what_it_read(monkeypatch):
    many = [(f"nfpa13:{n}", f"Passage {n} on sprinklers.", {"doc_id": "nfpa13"}) for n in range(5)]
    get = fake_chroma(monkeypatch, many, page=2)

    assert len(search("sprinklers", ["nfpa13"], limit=30).json()["results"]) == 5
    assert get.call_count == 3
    # Withdrawn and unconfirmed passages are left out, as in every search.
    assert get.call_args.kwargs["where"]["$and"][1] == {
        "status": {"$nin": ["withdrawn", "needs_review"]}
    }
    search("passage", ["nfpa13"])
    assert get.call_count == 3


def test_a_query_of_stop_words_only_finds_nothing_and_reads_nothing(monkeypatch):
    get = fake_chroma(monkeypatch, [RACKS])
    assert search("check the", ["nfpa13"]).json()["results"] == []
    assert get.call_count == 0


def test_refuses_a_search_without_words_or_documents():
    assert search("", ["nfpa13"]).status_code == 422
    assert search("sprinklers", []).status_code == 422
    assert search("sprinklers", ["nfpa13"], limit=100).status_code == 422


def test_words_keep_clause_numbers_and_drop_plurals():
    assert keyword_search.words("Sprinklers per 8.3.1, glass") == [
        "sprinkler",
        "per",
        "8.3.1",
        "glass",
    ]

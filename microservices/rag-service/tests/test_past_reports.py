"""PV-05: past reports are stored with tags numbered per document ("[PERSON_1] inspected the
pump"), and search puts the real words back from the document's mapping before anything reads
them. Chroma and Cohere are faked; MongoDB is conftest's `stored_mappings`."""

from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from pymongo.errors import ServerSelectionTimeoutError

from app.privacy import PrivacyUnavailable
from app.retrieval import retriever

REPORT = "6abb28ae16068a0793e9962a"
STANDARD = "6abb28ae16068a0793e9962b"


def stored(monkeypatch, rows):
    """Chroma holding `rows` of (id, text, metadata); every query finds all of them."""

    class Collection:
        def count(self):
            return len(rows)

        def query(self, query_embeddings, **_):
            each = range(len(query_embeddings))
            return {
                "ids": [[r[0] for r in rows] for _ in each],
                "documents": [[r[1] for r in rows] for _ in each],
                "metadatas": [[dict(r[2]) for r in rows] for _ in each],
                "distances": [[0.2 for _ in rows] for _ in each],
            }

    cohere = SimpleNamespace(
        embed=lambda texts, **_: SimpleNamespace(
            embeddings=SimpleNamespace(float_=[[0.1] for _ in texts])
        )
    )
    monkeypatch.setattr(
        retriever, "chroma_client", lambda: SimpleNamespace(get_collection=lambda **_: Collection())
    )
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)


def test_a_stored_passage_reads_in_real_words(monkeypatch, stored_mappings):
    stored_mappings[REPORT] = {"[PERSON_1]": "John Tan", "[CLIENT_1]": "Acme Pte Ltd"}
    stored(
        monkeypatch,
        [
            (
                "r:1",
                "[PERSON_1] inspected the pump.",
                {"doc_id": REPORT, "headings": ["[CLIENT_1]"]},
            ),
            ("s:1", "Test pumps weekly.", {"doc_id": STANDARD, "headings": ["Pumps"]}),
        ],
    )

    [found] = retriever.search([("pump tests", {}, 5), ("hydrants", {}, 5)])[:1]

    assert [p["text"] for p in found] == ["John Tan inspected the pump.", "Test pumps weekly."]
    assert [p["metadata"]["headings"] for p in found] == [["Acme Pte Ltd"], ["Pumps"]]
    # Both requests' passages are restored from one read.
    assert stored_mappings.reads == 1


def test_chat_search_restores_before_the_reranker_and_widening(monkeypatch, stored_mappings):
    # Chat's retrieve reads Chroma itself, then widens its best hits to their neighbours.
    stored_mappings[REPORT] = {"[PERSON_1]": "John Tan", "[CLIENT_1]": "Acme Pte Ltd"}
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 2
    collection.query.return_value = {
        "ids": [["r:1"]],
        "documents": [["[PERSON_1] inspected the pump."]],
        "metadatas": [[{"doc_id": REPORT, "position": 1}]],
        "distances": [[0.1]],
    }
    collection.get.return_value = {
        "ids": ["r:2"],
        "documents": ["[CLIENT_1] agreed to fix it."],
        "metadatas": [{"doc_id": REPORT, "position": 2}],
    }
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.3]]))
    cohere.rerank.return_value = SimpleNamespace(
        results=[SimpleNamespace(index=0, relevance_score=0.9)]
    )
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)

    [hit] = retriever.retrieve("who inspected the pump", expand=True)

    assert cohere.rerank.call_args.kwargs["documents"] == ["John Tan inspected the pump."]
    assert hit["text"] == "John Tan inspected the pump.\n\nAcme Pte Ltd agreed to fix it."


def test_a_mapping_that_cannot_be_read_fails_the_request(monkeypatch, stored_mappings):
    # Without it, tags would reach the draft as if they were words, or be read as this request's.
    def unreachable(*_, **__):
        raise ServerSelectionTimeoutError("mongo:27017: timed out")

    monkeypatch.setattr(stored_mappings, "find", unreachable)
    stored(monkeypatch, [("r:1", "[PERSON_1] inspected the pump.", {"doc_id": REPORT})])

    with pytest.raises(PrivacyUnavailable) as raised:
        retriever.search([("pump tests", {}, 5)])

    assert "mongo" not in str(raised.value)

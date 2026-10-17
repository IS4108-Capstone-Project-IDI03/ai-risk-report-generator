"""Tables and two-column pages in search (CB-01, issues 01 and 02).

The reranker reads a passage's heading trail with its text, short forms in the
question are spelled out, and chat widens its best hits to their whole table or
their neighbours, so an answer cut across passages reaches the model together.
Chroma and Cohere are mocked, as in test_retrieval.py.
"""

from types import SimpleNamespace
from unittest.mock import Mock

from app.chat.quotes import quote_found
from app.retrieval import retriever
from app.retrieval.glossary import expand_query

TRAIL = ["NFPA 13", "Chapter 20", "20.15 Water Supply"]


def _search_with(monkeypatch, documents, metadatas):
    """A mocked Chroma + Cohere whose search returns `documents` in the order given."""
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 50
    collection.query.return_value = {
        "ids": [[f"doc:{n}" for n in range(len(documents))]],
        "documents": [documents],
        "metadatas": [metadatas],
        "distances": [[0.1] * len(documents)],
    }
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.3]]))
    cohere.rerank.return_value = SimpleNamespace(
        results=[SimpleNamespace(index=0, relevance_score=0.9)]
    )
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)
    return collection, cohere


def _hit(id_, text, **meta):
    return {"id": id_, "text": text, "metadata": {"doc_id": "doc", **meta}, "relevance_score": 0.9}


def _stored(*passages):
    """A Chroma collection whose `get` returns the (id, text, metadata) triples given."""
    collection = Mock()
    collection.get.return_value = {
        "ids": [p[0] for p in passages],
        "documents": [p[1] for p in passages],
        "metadatas": [p[2] for p in passages],
    }
    return collection


# --- what the reranker and the search read -------------------------------------


def test_the_reranker_reads_the_heading_trail_with_the_text(monkeypatch):
    # A table whose subject is only in its heading can't win a question that uses
    # the heading's words unless the reranker sees them too.
    _, cohere = _search_with(
        monkeypatch,
        ["Extra hazard | Duration (minutes): 90 or 120", "plain"],
        [{"headings": TRAIL}, {}],
    )

    retriever.retrieve("hose stream allowance for extra hazard")

    assert cohere.rerank.call_args.kwargs["documents"] == [
        "NFPA 13 > Chapter 20 > 20.15 Water Supply\nExtra hazard | Duration (minutes): 90 or 120",
        "plain",
    ]


def test_a_short_form_in_the_question_is_spelled_out_before_searching(monkeypatch):
    # Example 2: "EH2" never appears in the standard, which prints "Extra Group 2".
    _, cohere = _search_with(monkeypatch, ["x"], [{}])

    retriever.retrieve("What density and area do I use for an EH2 area on a new system?")

    asked = cohere.rerank.call_args.kwargs["query"]
    assert asked.startswith("What density and area do I use for an EH2 area")
    assert "Extra Hazard Group 2 (Extra Group 2)" in asked
    assert cohere.embed.call_args.kwargs["texts"] == [asked]


def test_a_question_without_short_forms_is_searched_as_asked():
    question = "How often do we trip test the dry pipe valve?"

    assert expand_query(question) == question
    assert "Ordinary Hazard Group 1" in expand_query("OH-1 hose stream")


# --- widening a hit -------------------------------------------------------------


def test_a_table_hit_is_widened_to_the_rest_of_its_table():
    # Example 4: the answer row is in one group; the other groups complete the table.
    hit = _hit(
        "doc:table:9:g1",
        "Table 1\n13 | Partial-flow trip test: Annually",
        table_id="doc:table:9",
        position=9,
        page_start=10,
        page_end=10,
    )
    collection = _stored(
        (
            "doc:table:9:g2",
            "Table 1\n14 | Full-flow trip test: Every 3 years",
            {"table_id": "doc:table:9", "position": 9, "page_start": 10, "page_end": 11},
        ),
        (
            "doc:table:9:g0",
            "Table 1\n10 | Air leakage rate: Annually",
            {"table_id": "doc:table:9", "position": 9, "page_start": 10, "page_end": 10},
        ),
    )

    (widened,) = retriever.widen([hit], collection)

    assert widened["id"] == "doc:table:9:g1"  # the hit keeps its identity and score
    assert widened["relevance_score"] == 0.9
    text = widened["text"]
    assert text.index("10 | Air leakage") < text.index("13 | Partial-flow")
    assert text.index("13 | Partial-flow") < text.index("14 | Full-flow")
    assert (widened["metadata"]["page_start"], widened["metadata"]["page_end"]) == (10, 11)
    assert {"table_id": "doc:table:9"} in collection.get.call_args.kwargs["where"]["$and"]


def test_a_passage_hit_is_widened_to_the_passages_either_side_of_it():
    # Example 2: the nameplate intro and its list are separate passages.
    intro = _hit("doc:40", "29.4.3 The sign shall include the following information:", position=40)
    collection = _stored(
        ("doc:41", "(1) Location of the design area\n(2) Size of the design area", {"position": 41})
    )

    (widened,) = retriever.widen([intro], collection)

    assert widened["text"] == (
        "29.4.3 The sign shall include the following information:\n\n"
        "(1) Location of the design area\n(2) Size of the design area"
    )
    assert {"position": {"$in": [39, 41]}} in collection.get.call_args.kwargs["where"]["$and"]


def test_widening_never_adds_a_withdrawn_or_unconfirmed_passage():
    collection = _stored()
    hit = _hit("doc:40", "text", position=40)

    retriever.widen([hit], collection)
    retriever.widen([hit], collection, include_withdrawn=True)

    first, second = (call.kwargs["where"]["$and"][-1] for call in collection.get.call_args_list)
    assert first == {"status": {"$nin": ["withdrawn", "needs_review"]}}
    assert second == {"status": {"$nin": ["needs_review"]}}


def test_widening_adds_at_most_three_passages_and_three_thousand_characters():
    hit = _hit("doc:40", "hit", position=40)
    collection = _stored(*[(f"doc:{n}", "x" * 1200, {"position": 40 + n}) for n in range(1, 5)])

    (widened,) = retriever.widen([hit], collection)

    added = [i for i in widened["metadata"]["widened_from"] if i != "doc:40"]
    assert len(added) == 2  # a third 1,200-character passage would pass 3,000
    assert len(widened["text"]) <= len("hit") + 3000 + 2 * len("\n\n")


def test_only_the_best_hits_are_widened_and_old_passages_are_left_alone():
    hits = [_hit(f"doc:{n}", f"hit {n}", position=n) for n in range(10, 15)]
    collection = _stored(("doc:99", "neighbour", {"position": 99}))

    widened = retriever.widen(hits, collection)

    assert collection.get.call_count == retriever.EXPAND_HITS
    assert widened[3]["text"] == "hit 13"
    assert widened[0]["text"].endswith("neighbour")
    # A passage indexed before `position` existed has nothing to widen from.
    collection.get.reset_mock()
    old = {"id": "doc:7", "text": "old", "metadata": {"doc_id": "doc"}}
    assert retriever.widen([old], collection) == [old]
    collection.get.assert_not_called()


def test_a_quote_from_a_widened_passage_passes_the_quote_check():
    intro = _hit("doc:40", "29.4.3 The sign shall include the following information:", position=40)
    collection = _stored(("doc:41", "(1) Location of the design area or areas", {"position": 41}))

    (widened,) = retriever.widen([intro], collection)

    assert quote_found("Location of the design area or areas", widened["text"])
    assert quote_found("The sign shall include the following information", widened["text"])


def test_retrieve_widens_only_when_asked(monkeypatch):
    collection, _ = _search_with(monkeypatch, ["a"], [{"doc_id": "doc", "position": 3}])
    collection.get.return_value = {
        "ids": ["doc:4"],
        "documents": ["b"],
        "metadatas": [{"doc_id": "doc", "position": 4}],
    }

    assert retriever.retrieve("q")[0]["text"] == "a"
    assert retriever.retrieve("q", expand=True)[0]["text"] == "a\n\nb"

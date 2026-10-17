"""A passage is embedded with its heading trail, but stored and quoted as plain text (CB-01).

Before this, search compared the question with the passage text alone, so a table
whose subject lived only in its heading ("Hose Stream Allowance") could not match
a question that used those words.
"""

from types import SimpleNamespace
from unittest.mock import Mock

from app.pipeline import embedder, indexer

TRAIL = ["NFPA 13", "Chapter 20 Installation Requirements", "20.15 Water Supply"]


def test_embedding_text_puts_the_heading_trail_before_the_text():
    chunk = {
        "text": "Extra hazard | Duration (minutes): 90 or 120",
        "metadata": {"headings": TRAIL},
    }

    assert indexer.embedding_text(chunk) == (
        "NFPA 13 > Chapter 20 Installation Requirements > 20.15 Water Supply\n"
        "Extra hazard | Duration (minutes): 90 or 120"
    )


def test_embedding_text_is_the_text_when_there_is_no_trail():
    assert indexer.embedding_text({"text": "plain", "metadata": {"page_start": 1}}) == "plain"
    assert indexer.embedding_text({"text": "plain"}) == "plain"


def test_the_vector_sees_the_trail_but_the_stored_document_is_the_plain_text(monkeypatch):
    cohere, chroma = Mock(), Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(indexer, "chroma_client", lambda: chroma)
    chunk = {"id": "nfpa13:table:5", "text": "Extra hazard | 500", "metadata": {"headings": TRAIL}}

    indexer.index_chunks([chunk])

    assert cohere.embed.call_args.kwargs["texts"] == [indexer.embedding_text(chunk)]
    stored = chroma.get_or_create_collection.return_value.upsert
    assert stored.call_args.kwargs["documents"] == ["Extra hazard | 500"]

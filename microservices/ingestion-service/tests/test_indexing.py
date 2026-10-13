"""Indexing contract without external API calls."""

import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from cohere.errors import TooManyRequestsError
from starlette.testclient import TestClient as TestClient

from app.main import app
from app.pipeline import embedder, indexer
from app.retrieval_config import cohere_client

client = TestClient(app)


@pytest.mark.parametrize("mode,index_type", [("local", "hnsw"), ("cloud", "spann")])
def test_index_preserves_ids_and_metadata_and_rejects_invalid_input(monkeypatch, mode, index_type):
    monkeypatch.setenv("CHROMA_MODE", mode)
    cohere, chroma = Mock(), Mock()
    cohere.embed.return_value = SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.1]]))
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(indexer, "chroma_client", lambda: chroma)
    chunk = {
        "id": "synthetic:1",
        "text": "Flood barriers protect the warehouse.",
        "metadata": {
            "document_id": "synthetic",
            "source_type": "survey",
            "jurisdiction": "SG",
            "facility_type": "warehouse",
            "section": "Fire Protection",
            "effective_date": "2026-09-13",
            "page": 1,
        },
    }
    for _ in range(2):
        response = client.post("/index", json={"chunks": [chunk]})
        assert response.status_code == 200
        assert response.json()["chunks_indexed"] == 1
    assert cohere.embed.call_args.kwargs["input_type"] == "search_document"
    assert cohere.embed.call_args.kwargs["truncate"] == "NONE"
    assert chroma.get_or_create_collection.call_args.kwargs["configuration"] == {
        index_type: {"space": "cosine"}
    }
    stored = chroma.get_or_create_collection.return_value.upsert
    assert stored.call_args.kwargs == {
        "ids": [chunk["id"]],
        "documents": [chunk["text"]],
        "embeddings": [[0.1]],
        # KB-01: /index fills status active when the caller omits it.
        "metadatas": [{**chunk["metadata"], "status": "active"}],
    }
    assert client.post("/index", json={"chunks": [chunk, chunk]}).status_code == 422
    chunk["text"] = "   "
    assert client.post("/index", json={"chunks": [chunk]}).status_code == 422
    assert client.post("/index", json={"chunks": []}).status_code == 422
    cohere.embed.side_effect = RuntimeError("upstream failed")
    with pytest.raises(RuntimeError, match="upstream failed"):
        indexer.index_chunks([{"text": "new text"}])
    assert stored.call_count == 2  # Failed embedding never overwrites stored evidence.


def test_embed_single_call_and_skips_empty(monkeypatch):
    cohere = Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    assert embedder.embed([]) == []
    assert cohere.embed.call_count == 0
    chunks = ["chunk"] * 96
    assert embedder.embed(chunks) == [[0.1]] * 96
    assert cohere.embed.call_count == 1
    assert cohere.embed.call_args.kwargs["texts"] == chunks


@pytest.mark.model
def test_embed_waits_out_the_minute_and_retries_rate_limited_batch(monkeypatch):
    cohere = Mock()
    cohere.embed.side_effect = [
        TooManyRequestsError({"message": "rate limited"}),
        SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.1]])),
    ]
    sleep = Mock()
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(time, "sleep", sleep)

    assert embedder.embed(["chunk"]) == [[0.1]]

    assert cohere.embed.call_count == 2
    sleep.assert_called_once_with(90)  # past the per-minute window


def test_embed_reraises_rate_limit_after_retry_limit(monkeypatch):
    cohere = Mock()
    error = TooManyRequestsError({"message": "rate limited"})
    cohere.embed.side_effect = error
    sleep = Mock()
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(time, "sleep", sleep)

    with pytest.raises(TooManyRequestsError):
        embedder.embed(["chunk"])

    assert cohere.embed.call_count == 11
    assert sleep.call_count == 10
    sleep.assert_called_with(90)


def test_embed_splits_batches_by_token_budget_and_waits_out_the_minute(monkeypatch):
    cohere = Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    sleep = Mock()
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(time, "sleep", sleep)
    # ~30k estimated tokens each: two fit the 80k budget, a third does not.
    chunks = ["x" * 60_000] * 3

    assert embedder.embed(chunks) == [[0.1]] * 3

    assert [len(c.kwargs["texts"]) for c in cohere.embed.call_args_list] == [2, 1]
    sleep.assert_called_once()
    assert 0 < sleep.call_args.args[0] <= 60


def test_embed_sends_an_over_budget_text_on_its_own(monkeypatch):
    cohere = Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(time, "sleep", Mock())

    embedder.embed(["short", "x" * 200_000, "short"])

    assert [len(c.kwargs["texts"]) for c in cohere.embed.call_args_list] == [1, 1, 1]


def test_missing_key_has_actionable_error(monkeypatch):
    cohere_client.cache_clear()
    monkeypatch.delenv("COHERE_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="Set COHERE_API_KEY"):
        cohere_client()


# --- passages over Chroma Cloud's size limit (IN-12) ----------------------------
# Chroma Cloud rejects a stored document over 16,384 bytes. Table chunks are kept
# whole and their records repeat every heading, so long tables exceed it. Each
# record line carries its own headings, so splitting between lines loses nothing.


def _stored(monkeypatch):
    cohere, chroma = Mock(), Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(indexer, "chroma_client", lambda: chroma)
    return chroma.get_or_create_collection.return_value.upsert


def test_a_table_over_the_size_limit_is_stored_as_parts_split_between_records(monkeypatch):
    upsert = _stored(monkeypatch)
    row = "Temp: {t}; Design Concentration (% per volume) 7: " + "0.0391 " * 1000
    rows = [row.format(t=t) for t in (10, 20, 30)]  # ~7 kB each, ~21 kB in all
    meta = {"doc_id": "fm200", "page_start": 48, "page_end": 48, "bbox": [1.0, 2.0, 3.0, 4.0]}
    small = {"id": "fm200:3", "text": "Short passage.", "metadata": {"doc_id": "fm200"}}
    table = {"id": "fm200:table:7", "text": "\n".join(rows), "metadata": meta}

    assert indexer.index_chunks([small, table]) == 3

    stored = upsert.call_args.kwargs
    assert stored["ids"] == ["fm200:3", "fm200:table:7:part1", "fm200:table:7:part2"]
    assert stored["documents"] == ["Short passage.", "\n".join(rows[:2]), rows[2]]
    assert stored["metadatas"] == [{"doc_id": "fm200"}, meta, meta]
    assert all(len(d.encode("utf-8")) <= 16384 for d in stored["documents"])


def test_a_single_line_over_the_limit_is_split_at_spaces():
    # No line breaks to split at (e.g. a giant record): fall back to word boundaries.
    line = " ".join(f"value{n:05d}" for n in range(3000))  # ~33 kB, one line

    parts = indexer.split_for_storage(line)

    assert len(parts) == 3
    assert all(len(p.encode("utf-8")) <= 16384 for p in parts)
    assert " ".join(parts) == line


def test_embed_splits_a_rate_limited_batch_in_half(monkeypatch):
    # A batch whose real token count exceeds the limit fails however long the
    # wait, so it is halved instead of retried as is.
    def embed(**kw):
        if len(kw["texts"]) > 2:
            raise TooManyRequestsError({"message": "trial token rate limit exceeded"})
        return SimpleNamespace(
            embeddings=SimpleNamespace(float_=[[float(len(t))] for t in kw["texts"]])
        )

    cohere = Mock()
    cohere.embed.side_effect = embed
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(time, "sleep", Mock())
    chunks = ["a", "bb", "ccc", "dddd", "eeeee"]

    assert embedder.embed(chunks) == [[1.0], [2.0], [3.0], [4.0], [5.0]]  # order kept
    assert [len(c.kwargs["texts"]) for c in cohere.embed.call_args_list] == [5, 2, 3, 1, 2]


# --- Chroma Cloud's 300-record cap per write and per read ----------------------


def test_upsert_is_split_into_writes_of_at_most_300_records(monkeypatch):
    upsert = _stored(monkeypatch)
    chunks = [{"id": f"big:{n}", "text": f"Passage {n}.", "metadata": {}} for n in range(650)]

    assert indexer.index_chunks(chunks) == 650

    sizes = [len(call.kwargs["ids"]) for call in upsert.call_args_list]
    assert sizes == [300, 300, 50]
    stored_ids = [i for call in upsert.call_args_list for i in call.kwargs["ids"]]
    assert stored_ids == [chunk["id"] for chunk in chunks]
    assert all(
        len(call.kwargs["embeddings"]) == len(call.kwargs["ids"]) for call in upsert.call_args_list
    )


class PageRecorder:
    def __init__(self):
        self.page_updates = []

    def update_pages(self, current, total):
        self.page_updates.append((current, total))


def _passage(n, page):
    return {
        "id": f"doc:{n}",
        "text": f"passage {n}",
        "metadata": {"page_start": page, "page_end": page},
    }


def test_index_reports_the_page_reached_after_each_embedding_batch(monkeypatch):
    # Two texts per Cohere call: pages [1, 1] then [2, 4]; page 5 has no
    # passage, but indexing is done with it, so the counter ends at 5 / 5.
    monkeypatch.setattr(embedder, "_COHERE_BATCH_LIMIT", 2)
    cohere = Mock()
    cohere.embed.side_effect = lambda **kw: SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[0.1]] * len(kw["texts"]))
    )
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    monkeypatch.setattr(indexer, "chroma_client", lambda: Mock())
    reporter = PageRecorder()

    indexer.index_chunks(
        [_passage(0, 1), _passage(1, 1), _passage(2, 2), _passage(3, 4)],
        reporter=reporter,
        page_total=5,
    )

    assert reporter.page_updates == [(1, 5), (4, 5), (5, 5)]

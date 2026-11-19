"""IN-18: a standard typed in clause by clause. Saving a clause indexes its passages."""

from types import SimpleNamespace

import pytest
from fakes import FakeDocuments, FakePassages, stored_doc
from fastapi.testclient import TestClient

from app import manual, matching, worker
from app.main import app
from app.pipeline import embedder, indexer

client = TestClient(app)


@pytest.fixture
def store(monkeypatch):
    """A manual draft, an in-memory index, and a fake Cohere that records what it embeds."""
    passages = FakePassages()
    doc = stored_doc(
        edition="2025",
        status="draft",
        entryMethod="manual",
        metadata={
            "source_type": "nfpa_standard",
            "jurisdiction": "SG",
            "facility_type": "all",
            "effective_date": None,
        },
    )
    documents = FakeDocuments(doc)
    embedded: list[str] = []

    def embed(**kwargs):
        embedded.extend(kwargs["texts"])
        return SimpleNamespace(
            embeddings=SimpleNamespace(float_=[[0.1, 0.2]] * len(kwargs["texts"])),
            meta=SimpleNamespace(billed_units=SimpleNamespace(input_tokens=7)),
        )

    cohere = SimpleNamespace(embed=embed)
    monkeypatch.setattr(embedder, "cohere_client", lambda: cohere)
    chroma = SimpleNamespace(get_or_create_collection=lambda **_: passages)
    monkeypatch.setattr(indexer, "chroma_client", lambda: chroma)
    monkeypatch.setattr(matching, "passages_collection", lambda: passages)
    monkeypatch.setattr(worker, "documents", lambda: documents)
    # One token a word, so the tests can say where a clause splits.
    monkeypatch.setattr(manual, "count_tokens", lambda text: len(text.split()))
    return SimpleNamespace(doc=doc, id=str(doc["_id"]), passages=passages, embedded=embedded)


def clause(seq=1, **over) -> dict:
    return {
        "seq": seq,
        "order": seq * 10,
        "clause": f"8.{seq}",
        "headings": ["Chapter 8 Installation", f"8.{seq} Sprinklers"],
        "text": "Sprinklers shall be installed throughout.",
        "images": [],
        **over,
    }


def put(store, section_id="s1", **over):
    return client.put(f"/documents/{store.id}/manual-sections/{section_id}", json=clause(**over))


def test_saving_a_clause_indexes_it_with_the_documents_labels_kept_out_of_search(store):
    response = put(store)

    assert response.status_code == 200
    assert response.json()["passagesIndexed"] == 1
    row = store.passages.rows[f"{store.id}:1"]
    assert row["text"] == "Sprinklers shall be installed throughout."
    assert row["meta"] == {
        "source_type": "nfpa_standard",
        "jurisdiction": "SG",
        "facility_type": "all",
        # A draft is not searchable until it is published.
        "status": "needs_review",
        "section": "Not applicable",
        "doc_id": store.id,
        "entry_method": "manual",
        "section_id": "s1",
        "seq": 1,
        "order": 10,
        "clause": "8.1",
        "headings": ["Chapter 8 Installation", "8.1 Sprinklers"],
    }


def test_the_embedding_is_returned_as_usage_for_the_document(store):
    usage = put(store).json()["usage"]

    assert [(u["feature"], u["document_id"], u["input_tokens"]) for u in usage] == [
        ("embed-document", store.id, 7)
    ]


def test_a_clause_over_the_token_limit_becomes_several_passages_each_with_its_trail(
    store, monkeypatch
):
    monkeypatch.setattr(manual, "MAX_CHUNK_TOKENS", 12)
    text = "one two three four five\n\nsix seven eight nine ten\n\neleven twelve"

    response = put(store, text=text)

    # The trail is 6 words, so 6 are left for the text: one paragraph a passage.
    assert response.json()["passagesIndexed"] == 3
    ids = sorted(i for i in store.passages.rows)
    assert ids == [f"{store.id}:1:part{n}" for n in (1, 2, 3)]
    assert store.passages.rows[f"{store.id}:1:part2"]["text"] == "six seven eight nine ten"
    assert all(t.startswith("Chapter 8 Installation > 8.1 Sprinklers\n") for t in store.embedded)


def test_amending_a_clause_replaces_its_passages_and_leaves_the_others(store, monkeypatch):
    monkeypatch.setattr(manual, "MAX_CHUNK_TOKENS", 12)
    put(store, text="one two three four five\n\nsix seven eight nine ten")
    put(store, section_id="s2", seq=2)

    put(store, text="Amended.")

    assert sorted(store.passages.rows) == [f"{store.id}:1", f"{store.id}:2"]
    assert store.passages.rows[f"{store.id}:1"]["text"] == "Amended."


def test_deleting_a_clause_removes_only_its_passages(store):
    put(store)
    put(store, section_id="s2", seq=2)

    response = client.delete(f"/documents/{store.id}/manual-sections/s1")

    assert response.json() == {"passagesDeleted": 1}
    assert list(store.passages.rows) == [f"{store.id}:2"]


def test_a_screenshot_gives_the_passage_its_kind_and_image_but_no_region(store):
    images = [{"key": "knowledge/x/sections/1.png", "kind": "table"}]

    put(store, images=images)

    meta = store.passages.rows[f"{store.id}:1"]["meta"]
    assert meta["image_keys"] == ["knowledge/x/sections/1.png"]
    assert meta["region_kind"] == "table"
    assert "region_bbox" not in meta


def test_a_published_document_s_clause_is_searchable_at_once(store):
    store.doc.update(status="complete")

    put(store)

    assert store.passages.rows[f"{store.id}:1"]["meta"]["status"] == "active"


def test_a_document_that_was_uploaded_takes_no_clauses(store):
    store.doc.pop("entryMethod")

    assert put(store).status_code == 409
    assert client.delete(f"/documents/{store.id}/manual-sections/s1").status_code == 409


def test_an_unknown_document_answers_404(store):
    response = client.put("/documents/6abb28ae16068a0793e99999/manual-sections/s1", json=clause())

    assert response.status_code == 404


@pytest.mark.parametrize(
    "over", [{"text": "  "}, {"clause": ""}, {"seq": 0}, {"images": [{"key": "k", "kind": "x"}]}]
)
def test_a_clause_without_text_or_number_is_refused(store, over):
    assert put(store, **over).status_code == 422

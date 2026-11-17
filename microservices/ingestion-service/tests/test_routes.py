"""Contract tests for S3's HTTP surface.

The pipeline stages are still stubs, so these assert the request/response
*shape* the gateway depends on — not the placeholder values, which change
once real logic lands.
"""

from starlette.testclient import TestClient as TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ingestion"}


def test_ingest_echoes_filename():
    response = client.post("/ingest", json={"filename": "report.pdf"})
    assert response.status_code == 200
    assert response.json()["file"] == "report.pdf"
    assert "status" in response.json()


def test_ingest_requires_filename():
    assert client.post("/ingest", json={}).status_code == 422


def _pdf(password: str | None = None) -> bytes:
    import pymupdf

    doc = pymupdf.open()
    doc.new_page()
    if password:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw=password)
    return doc.tobytes()


def test_inspect_accepts_a_pdf_that_opens():
    response = client.post("/inspect", content=_pdf(), headers={"Content-Type": "application/pdf"})
    assert response.status_code == 200
    assert response.json() == {"pages": 1}


def test_inspect_rejects_bytes_that_are_not_a_pdf():
    response = client.post(
        "/inspect", content=b"%PDF-1.7 broken", headers={"Content-Type": "application/pdf"}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "The file is not a valid PDF and cannot be opened."}


def test_inspect_rejects_a_password_protected_pdf():
    response = client.post(
        "/inspect", content=_pdf(password="secret"), headers={"Content-Type": "application/pdf"}
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "The PDF is password-protected."}


# --- IN-07: match, delete passages, comparison (Chroma and MongoDB faked).

from bson import ObjectId  # noqa: E402
from fakes import FakeDocuments, FakePassages, stored_doc  # noqa: E402

from app import matching, worker  # noqa: E402


def in07_fakes(monkeypatch, *docs):
    passages = FakePassages()
    store = FakeDocuments(*docs)
    monkeypatch.setattr(matching, "passages_collection", lambda: passages)
    monkeypatch.setattr(worker, "documents", lambda: store)
    relabelled = []
    monkeypatch.setattr(worker, "relabel_passages", lambda doc: relabelled.append(doc) or 1)
    return passages, store, relabelled


def test_match_saves_the_match_relabels_and_returns_it_with_a_string_id(monkeypatch):
    old, new = stored_doc(edition="2019"), stored_doc(edition="2022")
    _, store, relabelled = in07_fakes(monkeypatch, old, new)

    response = client.post(f"/documents/{new['_id']}/match")

    assert response.status_code == 200
    assert response.json()["match"]["kind"] == "newer_edition"
    assert response.json()["match"]["documentId"] == str(old["_id"])
    assert store.find_one({"_id": new["_id"]})["match"]["documentId"] == old["_id"]
    assert relabelled[0]["match"]["kind"] == "newer_edition"


def test_match_with_nothing_to_match_returns_null_and_clears_the_saved_match(monkeypatch):
    new = stored_doc(match={"kind": "possible_copy"})
    _, store, relabelled = in07_fakes(monkeypatch, new)

    response = client.post(f"/documents/{new['_id']}/match")

    assert response.json() == {"match": None}
    assert store.find_one({"_id": new["_id"]})["match"] is None
    assert relabelled[0]["match"] is None


def test_match_for_an_unknown_or_malformed_id_is_404(monkeypatch):
    in07_fakes(monkeypatch)

    assert client.post(f"/documents/{ObjectId()}/match").status_code == 404
    assert client.post("/documents/not-an-id/match").status_code == 404


def test_deleting_passages_removes_only_that_documents_and_counts_them(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    passages.add("gone", [[1, 0, 0], [0, 1, 0]])
    passages.add("kept", [[1, 0, 0]])

    response = client.delete("/documents/gone/passages")

    assert response.json() == {"passagesDeleted": 2}
    assert list(passages.rows) == ["kept:0"]


def test_comparison_returns_rows_with_passage_shapes(monkeypatch):
    old, new = stored_doc(), stored_doc()
    passages, _, _ = in07_fakes(monkeypatch, old, new)
    passages.add(str(new["_id"]), [[1, 0, 0], [0, 0, 1]], ["same", "added"])
    passages.add(str(old["_id"]), [[1, 0, 0]], ["same"])

    response = client.get(f"/documents/{new['_id']}/comparison/{old['_id']}")

    rows = response.json()["rows"]
    assert [r["differs"] for r in rows] == [False, True]
    assert rows[1] == {
        "new": {"id": f"{new['_id']}:1", "text": "added", "pageStart": 2, "pageEnd": 2},
        "stored": None,
        "differs": True,
    }


def test_comparison_with_a_missing_document_is_404(monkeypatch):
    new = stored_doc()
    in07_fakes(monkeypatch, new)

    assert client.get(f"/documents/{new['_id']}/comparison/{ObjectId()}").status_code == 404


def test_match_is_409_unless_the_document_is_complete(monkeypatch):
    new = stored_doc(status="processing")
    in07_fakes(monkeypatch, new)

    assert client.post(f"/documents/{new['_id']}/match").status_code == 409


# --- IN-17: list a document's passages for the knowledge base browser.


def test_listing_passages_returns_only_that_documents_passages_in_reading_order(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    passages.add("other", [[1, 0, 0]])
    for passage_id, text, meta in [
        ("doc:10", "Ten", {"headings": ["Chapter 8", "8.15"], "status": "active"}),
        ("doc:2:part1", "Two, second part", {"status": "active"}),
        ("doc:2", "Two", {"section": "Not applicable", "status": "needs_review"}),
    ]:
        passages.rows[passage_id] = {
            "text": text,
            "meta": {"doc_id": "doc", "page_start": 3, "page_end": 4, **meta},
            "vector": [1, 0, 0],
        }

    response = client.get("/documents/doc/passages")

    assert response.status_code == 200
    assert response.json()["total"] == 3
    listed = response.json()["passages"]
    assert [p["id"] for p in listed] == ["doc:2", "doc:2:part1", "doc:10"]
    assert listed[0] == {
        "id": "doc:2",
        "position": 1,
        "text": "Two",
        "headings": [],
        "section": "Not applicable",
        "pageStart": 3,
        "pageEnd": 4,
        "status": "needs_review",
    }
    assert listed[2]["headings"] == ["Chapter 8", "8.15"]


def test_listing_passages_of_a_document_with_none_returns_an_empty_list(monkeypatch):
    in07_fakes(monkeypatch)

    response = client.get("/documents/nothing-indexed/passages")

    assert response.json() == {
        "total": 0,
        "passages": [],
        "outline": {"by": "section", "chapters": [], "sections": []},
    }


def seed_passages(passages, count, doc="doc"):
    """`count` passages of `doc`, one per page, stored out of reading order."""
    for n in reversed(range(count)):
        passages.rows[f"{doc}:{n}"] = {
            "text": f"Passage {n}",
            "meta": {"doc_id": doc, "page_start": n + 1, "page_end": n + 1},
            "vector": [1, 0, 0],
        }


def test_listing_passages_pages_through_them_in_reading_order(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_passages(passages, 30)

    response = client.get("/documents/doc/passages?offset=25&limit=10")

    body = response.json()
    assert body["total"] == 30
    assert [p["id"] for p in body["passages"]] == [f"doc:{n}" for n in range(25, 30)]
    assert [p["position"] for p in body["passages"]] == [26, 27, 28, 29, 30]
    assert body["passages"][0]["text"] == "Passage 25"


def test_listing_passages_shows_25_at_a_time_unless_asked(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_passages(passages, 30)

    body = client.get("/documents/doc/passages").json()

    assert [p["position"] for p in body["passages"]] == list(range(1, 26))


def test_listing_passages_reads_text_only_for_the_page_shown(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_passages(passages, 30)

    client.get("/documents/doc/passages?offset=10&limit=5")

    text_reads = [ids for ids, include in passages.gets if "documents" in include]
    assert text_reads == [[f"doc:{n}" for n in range(10, 15)]]


def test_listing_passages_refuses_a_page_size_over_100_or_a_negative_offset(monkeypatch):
    in07_fakes(monkeypatch)

    assert client.get("/documents/doc/passages?limit=101").status_code == 422
    assert client.get("/documents/doc/passages?offset=-1").status_code == 422


# A standard's passages as NFPA 25 stores them: a junk trail (page header, watermark, edition
# mark) before the one real heading, clause numbers with change markers (Δ, N, *).
JUNK = ["25 NFPA ®", "EDUFIRE", "3e"]
STANDARD = [
    ("std:0", "Contents", 1, 1),
    ("std:1", "Chapter  1      Administration", 2, 2),
    ("std:2", "1.1 Scope.", 2, 2),
    ("std:3", "Δ 1.2.3* Purpose.", 3, 3),
    ("std:4", "Notes:", 3, 3),
    ("std:5", "N8.6.1 Component  Replacement.", 5, 6),
    ("std:6", "A.8.6.1 Explanatory material.", 9, 9),
    ("std:7", "Δ Table  A.8.6.1 Continued", None, None),
]


def seed_standard(passages):
    for passage_id, heading, start, end in STANDARD:
        meta = {"doc_id": "std", "headings": [*JUNK, heading]}
        if start is not None:
            meta |= {"page_start": start, "page_end": end}
        passages.rows[passage_id] = {"text": heading, "meta": meta, "vector": [1, 0, 0]}


def listed_ids(query=""):
    return [p["id"] for p in client.get(f"/documents/std/passages{query}").json()["passages"]]


def test_the_outline_lists_chapters_from_clause_numbers_in_reading_order(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_standard(passages)

    outline = client.get("/documents/std/passages").json()["outline"]

    # Before the first chapter is front matter (""); a heading without a clause number
    # ("Notes:", a table continued) stays in the clause before it.
    assert outline == {
        "by": "clause",
        "chapters": [
            {"name": "", "count": 1},
            {"name": "1", "count": 4},
            {"name": "8", "count": 1},
            {"name": "A", "count": 2},
        ],
        "sections": [],
    }


def test_a_chapter_narrows_the_list_and_lists_its_sections(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_standard(passages)

    body = client.get("/documents/std/passages?chapter=1").json()

    assert body["total"] == 4
    assert [p["id"] for p in body["passages"]] == ["std:1", "std:2", "std:3", "std:4"]
    # The chapter's heading itself comes before its first section ("").
    assert body["outline"]["sections"] == [
        {"name": "", "count": 1},
        {"name": "1.1", "count": 1},
        {"name": "1.2", "count": 2},
    ]
    assert listed_ids("?chapter=1&section=1.2") == ["std:3", "std:4"]
    assert listed_ids("?chapter=A&section=A.8") == ["std:6", "std:7"]


def test_a_page_range_keeps_passages_that_overlap_it(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_standard(passages)

    # std:5 runs over pages 5 and 6, so either edge finds it; std:7 has no page.
    assert listed_ids("?pageFrom=3&pageTo=5") == ["std:3", "std:4", "std:5"]
    assert listed_ids("?pageFrom=6") == ["std:5", "std:6"]
    assert listed_ids("?pageTo=1") == ["std:0"]
    assert listed_ids("?chapter=1&pageFrom=3") == ["std:3", "std:4"]


def test_a_page_range_that_ends_before_it_starts_is_refused(monkeypatch):
    in07_fakes(monkeypatch)

    assert client.get("/documents/std/passages?pageFrom=5&pageTo=4").status_code == 422
    assert client.get("/documents/std/passages?pageFrom=0").status_code == 422


def test_a_document_without_clause_numbers_is_outlined_by_its_report_sections(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    for n, section in enumerate(["Purpose and Scope", "Fire Protection", "Fire Protection"]):
        passages.rows[f"rep:{n}"] = {
            "text": f"Report text {n}",
            "meta": {"doc_id": "rep", "section": section, "headings": ["Site visit"]},
            "vector": [1, 0, 0],
        }

    body = client.get("/documents/rep/passages").json()
    narrowed = client.get("/documents/rep/passages?chapter=Fire%20Protection").json()

    assert body["outline"] == {
        "by": "section",
        "chapters": [
            {"name": "Purpose and Scope", "count": 1},
            {"name": "Fire Protection", "count": 2},
        ],
        "sections": [],
    }
    assert [p["id"] for p in narrowed["passages"]] == ["rep:1", "rep:2"]

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
        "kind": "text",
        "generated": False,
        "images": [],
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
    # ("Notes:", a table continued) stays in the clause before it. Only a chapter's own
    # heading names it: chapter 8 and annex A open with a sub-clause, so have no title.
    assert outline == {
        "by": "clause",
        "chapters": [
            {"name": "", "count": 1, "title": None},
            {"name": "1", "count": 4, "title": "Administration"},
            {"name": "8", "count": 1, "title": None},
            {"name": "A", "count": 2, "title": None},
        ],
        "sections": [],
    }


def test_a_chapter_narrows_the_list_and_lists_its_sections(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_standard(passages)

    body = client.get("/documents/std/passages?chapter=1").json()

    assert body["total"] == 4
    assert [p["id"] for p in body["passages"]] == ["std:1", "std:2", "std:3", "std:4"]
    # The chapter's heading itself comes before its first section (""). 1.2 opens with the
    # sub-clause "1.2.3* Purpose.", which names 1.2.3, not 1.2: no title beats a wrong one.
    assert body["outline"]["sections"] == [
        {"name": "", "count": 1, "title": None},
        {"name": "1.1", "count": 1, "title": "Scope"},
        {"name": "1.2", "count": 2, "title": None},
    ]
    assert listed_ids("?chapter=1&section=1.2") == ["std:3", "std:4"]
    assert listed_ids("?chapter=A&section=A.8") == ["std:6", "std:7"]


def test_chapters_and_sections_are_named_by_their_own_headings(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    # As FM data sheets number them: "2.0" opens chapter 2; a section's own heading may come
    # after its first sub-clause.
    for n, heading in enumerate(
        [
            "2.0 LOSS PREVENTION  RECOMMENDATIONS",
            "2.4.1 General.",
            "2.4 Fire Protection System Inspection",
            "Δ 2.5* Valves.",
            "Annex B  Bibliography",
        ]
    ):
        passages.rows[f"fm:{n}"] = {
            "text": heading,
            "meta": {"doc_id": "fm", "headings": [heading]},
            "vector": [1, 0, 0],
        }

    outline = client.get("/documents/fm/passages?chapter=2").json()["outline"]

    assert outline["chapters"] == [
        {"name": "2", "count": 4, "title": "LOSS PREVENTION RECOMMENDATIONS"},
        {"name": "B", "count": 1, "title": "Bibliography"},
    ]
    assert outline["sections"] == [
        {"name": "2.0", "count": 1, "title": "LOSS PREVENTION RECOMMENDATIONS"},
        {"name": "2.4", "count": 2, "title": "Fire Protection System Inspection"},
        {"name": "2.5", "count": 1, "title": "Valves"},
    ]


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
            {"name": "Purpose and Scope", "count": 1, "title": None},
            {"name": "Fire Protection", "count": 2, "title": None},
        ],
        "sections": [],
    }
    assert [p["id"] for p in narrowed["passages"]] == ["rep:1", "rep:2"]


def test_each_passage_says_what_kind_it_is_and_whether_ai_wrote_it(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    for passage_id, extra in [
        ("kinds:0", {}),
        ("kinds:table:1", {}),
        ("kinds:table:1:picture", {"generated_text": "picture_description"}),
        ("kinds:picture:2", {"generated_text": "picture_description"}),
        ("kinds:3", {"region_kind": "formula"}),
        ("kinds:4", {"region_kind": "table"}),
    ]:
        passages.rows[passage_id] = {
            "text": passage_id,
            "meta": {"doc_id": "kinds", **extra},
            "vector": [1, 0, 0],
        }

    listed = client.get("/documents/kinds/passages").json()["passages"]

    assert {p["id"]: (p["kind"], p["generated"]) for p in listed} == {
        "kinds:0": ("text", False),
        "kinds:table:1": ("table", False),
        "kinds:table:1:picture": ("picture", True),
        "kinds:picture:2": ("picture", True),
        "kinds:3": ("formula", False),
        "kinds:4": ("table", False),
    }


def test_given_ids_lists_only_those_in_the_order_given_with_their_place_in_the_document(
    monkeypatch,
):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_standard(passages)

    body = client.get("/documents/std/passages?ids=std:6&ids=std:2&ids=std:3").json()
    in_chapter = client.get("/documents/std/passages?ids=std:6&ids=std:2&chapter=1").json()

    # A search's ranked ids keep their rank; "position" is the place in the whole document.
    assert [(p["id"], p["position"]) for p in body["passages"]] == [
        ("std:6", 7),
        ("std:2", 3),
        ("std:3", 4),
    ]
    assert body["total"] == 3
    assert [p["id"] for p in in_chapter["passages"]] == ["std:2"]


def test_position_is_the_place_in_the_whole_document_when_filtered(monkeypatch):
    passages, _, _ = in07_fakes(monkeypatch)
    seed_standard(passages)

    listed = client.get("/documents/std/passages?chapter=8").json()["passages"]

    assert [(p["id"], p["position"]) for p in listed] == [("std:5", 6)]


def test_more_than_50_ids_are_refused(monkeypatch):
    in07_fakes(monkeypatch)

    query = "&".join(f"ids=std:{n}" for n in range(51))

    assert client.get(f"/documents/std/passages?{query}").status_code == 422

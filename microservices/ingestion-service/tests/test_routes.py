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

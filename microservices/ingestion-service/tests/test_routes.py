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

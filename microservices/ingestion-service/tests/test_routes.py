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

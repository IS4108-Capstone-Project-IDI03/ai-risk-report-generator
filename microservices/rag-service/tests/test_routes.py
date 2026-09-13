"""Contract tests for S4's HTTP surface.

Retrieval is mocked; generation/guardrails remain stubs. These assert the
response *shape* the gateway and the eval harness depend on — not the
placeholder text, which changes once real logic lands.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "rag"}


def test_generate_returns_text_and_guardrail(monkeypatch):
    monkeypatch.setattr("app.orchestrator.orchestrator.retrieve", lambda query: [])
    response = client.post("/generate", json={"query": "flood risk"})
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["text"], str)
    assert "passed" in body["guardrail"]


def test_retrieve_returns_results_list(monkeypatch):
    monkeypatch.setattr("app.api.routes.retrieve", lambda query: [])
    response = client.post("/retrieve", json={"query": "flood risk"})
    assert response.status_code == 200
    assert isinstance(response.json()["results"], list)


def test_generate_requires_query():
    assert client.post("/generate", json={}).status_code == 422


def test_retrieve_rejects_blank_query():
    assert client.post("/retrieve", json={"query": "   "}).status_code == 422

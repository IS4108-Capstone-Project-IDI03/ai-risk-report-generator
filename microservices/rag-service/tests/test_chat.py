"""POST /chat placeholder (CB-01 Step 0): the stream's event shape, not its wording.

The chat screen and stored conversations are built on this shape before real
answers exist. Search is mocked.
"""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def no_word_delay(monkeypatch):
    monkeypatch.setattr("app.chat.placeholder.WORD_DELAY_SECONDS", 0)

PASSAGE = {
    "id": "doc1:4",
    "text": "Sprinklers shall be installed throughout.",
    "metadata": {"doc_id": "doc1", "page_start": 12, "page_end": 12, "headings": ["8.1"]},
    "distance": 0.2,
}


def _ask(question: str, context: list | None = None) -> list[dict]:
    body = {
        "threadId": "t1",
        "runId": "r1",
        "tools": [],
        "context": context or [],
        "messages": [{"id": "m1", "role": "user", "content": question}],
    }
    response = client.post("/chat", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


def _answer(events: list[dict]) -> str:
    return "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")


def _sources(events: list[dict]) -> list[dict]:
    result = next(e for e in events if e["type"] == "TOOL_CALL_RESULT")
    return json.loads(result["content"])["passages"]


def test_searches_then_answers_citing_the_passage_found(monkeypatch):
    monkeypatch.setattr("app.chat.placeholder.search", lambda requests: [[PASSAGE]])
    events = _ask("Where are sprinklers needed?")
    types = [e["type"] for e in events]
    assert (
        types.index("TOOL_CALL_START")
        < types.index("TOOL_CALL_RESULT")
        < types.index("TEXT_MESSAGE_START")
    )
    assert types[-1] == "TEXT_MESSAGE_END"
    assert _sources(events)[0]["id"] == "doc1:4"
    assert "[1]" in _answer(events)


def test_declines_an_unanswerable_question_and_cites_nothing(monkeypatch):
    monkeypatch.setattr("app.chat.placeholder.search", lambda requests: [[PASSAGE]])
    events = _ask("This is unanswerable")
    assert _sources(events) == []
    assert "[1]" not in _answer(events)


def test_each_retry_gives_a_different_answer(monkeypatch):
    monkeypatch.setattr("app.chat.placeholder.search", lambda requests: [[PASSAGE]])
    assert _answer(_ask("Same question")) != _answer(_ask("Same question"))


def test_echoes_extra_context(monkeypatch):
    monkeypatch.setattr("app.chat.placeholder.search", lambda requests: [[]])
    events = _ask("Hi", context=[{"description": "memory", "value": "I survey Singapore offices"}])
    assert "I survey Singapore offices" in _answer(events)


def test_still_answers_when_search_is_down(monkeypatch):
    def down(requests):
        raise ConnectionError("chroma unreachable")

    monkeypatch.setattr("app.chat.placeholder.search", down)
    events = _ask("Where are sprinklers needed?")
    assert _sources(events) == []
    assert _answer(events)


def test_requires_a_user_message():
    assert client.post("/chat", json={"messages": []}).status_code == 422

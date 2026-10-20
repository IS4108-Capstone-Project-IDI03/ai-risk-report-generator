"""PV-03: knowledge-base chat (CB-01) with PII protection on. The planner, the answer model and
search are faked (`fake` from test_chat); privacy-service's /mask is faked in-process (conftest
`fake_privacy`)."""

import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from tests import test_chat
from tests.test_chat import _program, _result

client = TestClient(app)
# test_chat's fakes for the plan model, search and the answer model, as a fixture here too.
fake = test_chat.fake

SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}
# An earlier answer, as the chat screen sends it back: the program with its statements.
EARLIER_ANSWER = 'root = Answer([s1])\ns1 = Statement("Acme Holdings has a wet system.", [])\n'


def leaked(texts) -> list[str]:
    return [s for s in SEEDED if any(s in t for t in texts)]


def ask(*turns: str, privacy=PRIVACY, context=()) -> list[dict]:
    """POST /chat with the turns (user, assistant, user, …) and `privacy`; returns the events."""
    roles = ["user", "assistant"] * len(turns)
    body = {
        "messages": [{"role": r, "content": t} for r, t in zip(roles, turns)],
        "context": [{"description": "note", "value": c} for c in context],
    }
    if privacy is not None:
        body["privacy"] = privacy
    response = client.post("/chat", json=body)
    assert response.status_code == 200
    return [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


def test_the_planner_sees_placeholders_not_names(fake, fake_privacy):
    ask(
        "Who maintains the sprinklers at Acme Holdings?",
        EARLIER_ANSWER,
        "Did John Tan (NRIC S1234567D, +65 9123 4567) agree to test them?",
    )

    planned = fake["calls"]["plan"][0]
    assert leaked([planned]) == [], planned
    assert "[CLIENT_1]" in planned and "[PERSON_1]" in planned


# A past report's passage, stored unredacted, that names the client's people.
REPORT = {
    "id": "rep:9",
    "text": "As John Tan of Acme Holdings agreed, the fire pump is tested weekly.",
    "metadata": {
        "doc_id": "rep",
        "page_start": 4,
        "page_end": 4,
        "headings": ["Acme Holdings Tower", "Fire Protection"],
    },
    "relevance_score": 0.9,
}


def test_the_answer_model_sees_placeholders_not_names(fake, fake_privacy):
    fake["passages"] = [REPORT]

    ask(
        "Who maintains the sprinklers at Acme Holdings?",
        EARLIER_ANSWER,
        "Did John Tan (NRIC S1234567D) agree to test them?",
        context=["Site contact: +65 9123 4567"],
    )

    system, messages = fake["calls"]["answer"][0]
    sent = [system, *(m["content"] for m in messages)]
    assert leaked(sent) == [], sent
    # One mapping for the whole request: John Tan is [PERSON_1] to both models.
    assert "[PERSON_1]" in fake["calls"]["plan"][0]
    assert "[PERSON_1] of [CLIENT_1] agreed" in messages[-1]["content"]


def test_the_result_records_protection_but_never_the_names(fake, fake_privacy):
    events = ask("Did John Tan agree to test the sprinklers at Acme Holdings?")

    result = _result(events)
    assert result["privacy"] == {"enabled": True, "masked_count": 2}
    assert leaked([json.dumps(result)]) == []


def test_the_result_records_protection_off(fake):
    events = ask("Did John Tan agree?", privacy=None)

    assert _result(events)["privacy"] == {"enabled": False, "masked_count": 0}


@pytest.mark.parametrize(
    "failure",
    [httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), 500],
    ids=["down", "timeout", "error"],
)
def test_nothing_is_sent_when_privacy_service_fails(fake, fake_privacy, failure):
    fake_privacy.failure = failure

    events = ask("Did John Tan agree to test the sprinklers?")

    assert "plan" not in fake["calls"] and fake["calls"]["answer"] == []
    assert fake["calls"]["search"] == []
    error = _result(events)["error"]
    assert "privacy service" in error.lower()
    assert "privacy service" in _program(events).lower()
    assert leaked([error]) == []

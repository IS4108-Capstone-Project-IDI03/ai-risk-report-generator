"""PV-03: knowledge-base chat (CB-01) with PII protection on. The planner, the answer model and
search are faked (`fake` from test_chat); privacy-service's /mask is faked in-process (conftest
`fake_privacy`)."""

import json
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from app.chat import answer
from app.generation.generator import PLACEHOLDER_RULE
from app.main import app
from app.retrieval import retriever
from tests import test_chat, test_leak
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


def ask(*turns: str, privacy=PRIVACY, context=(), documents=()) -> list[dict]:
    """POST /chat with the turns (user, assistant, user, …) and `privacy`; returns the events."""
    roles = ["user", "assistant"] * len(turns)
    body = {
        "messages": [{"role": r, "content": t} for r, t in zip(roles, turns)],
        "context": [{"description": "note", "value": c} for c in context],
        "documents": list(documents),
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


def test_the_answer_reaches_the_screen_with_real_names(fake, fake_privacy):
    fake["passages"] = [REPORT]
    fake["chunks"] = [
        "root = Answer([s1])\n",
        's1 = Statement("[PER',
        'SON_1] of [CLIENT_1] agreed to weekly tests.", [])\n',
    ]

    events = ask("Did John Tan of Acme Holdings agree to test the pump?")

    program = _program(events)
    assert 's1 = Statement("John Tan of Acme Holdings agreed to weekly tests.", [])' in program
    deltas = [e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert not any("PER" in d or "CLIENT_" in d for d in deltas), deltas


def test_a_quote_with_placeholders_is_checked_on_real_text(fake, fake_privacy):
    fake["passages"] = [REPORT]
    fake["chunks"] = [
        "root = Answer([s1])\n",
        's1 = Statement("[PERSON_1] agreed to weekly tests.", [c1])\n',
        'c1 = Cite("P1", "[PERSON_1] of [CLIENT_1] agreed")\n',
    ]

    events = ask("Did John Tan agree to test the pump?")

    [citation] = _result(events)["citations"]
    assert citation["quote"] == "John Tan of Acme Holdings agreed"
    assert citation["verified"] is True


def test_a_placeholder_the_engineer_types_comes_back_as_typed(fake, fake_privacy):
    fake["chunks"] = [
        "root = Answer([s1])\n",
        's1 = Statement("[LITERAL_1] is a template field; [PERSON_1] is the contact.", [])\n',
    ]

    events = ask("In the template, is [PERSON_1] the same as John Tan?")

    planned = fake["calls"]["plan"][0]
    assert "[LITERAL_1]" in planned and "[PERSON_1]" in planned  # typed one escaped
    assert "[PERSON_1] is a template field; John Tan is the contact." in _program(events)


def test_the_planners_own_reply_is_shown_with_real_names(fake, fake_privacy):
    fake["plan"] = answer.Plan(
        kind="clarify", query="", reply="Do you mean [CLIENT_1]'s sprinklers or the fire pump?"
    )

    events = ask("Acme Holdings asked about the system. Is it tested?")

    assert "Do you mean Acme Holdings's sprinklers or the fire pump?" in _program(events)


# A past report's title can name the client.
DOCUMENTS = [
    {"id": "rep", "title": "Acme Holdings Tower survey 2024"},
    {"id": "fm", "title": "FM 2-81", "issuingBody": "FM Global", "standardNumber": "2-81"},
]


def test_a_document_the_planner_names_by_placeholder_still_limits_the_search(fake, fake_privacy):
    fake["plan"] = answer.Plan(
        kind="search",
        query="fire pump tests",
        filters=answer.Filters(document="[CLIENT_1] Tower survey 2024"),
        extra_searches=[
            answer.ExtraSearch(
                query="pump tests", filters=answer.Filters(document="[CLIENT_1] Tower survey 2024")
            )
        ],
        reply="",
    )

    ask("What did the Acme Holdings Tower survey say about fire pump tests?", documents=DOCUMENTS)

    planned = fake["calls"]["plan"][0]
    assert leaked([planned]) == [], planned
    assert "- [CLIENT_1] Tower survey 2024" in planned
    assert [filters.get("doc_id") for _, filters, _ in fake["calls"]["search"]] == [
        ["rep"],
        ["rep"],
    ]


def test_the_search_shows_real_names_but_searches_with_placeholders(fake, fake_privacy):
    fake["plan"] = answer.Plan(
        kind="search",
        query="fire pump tests agreed by [PERSON_1]",
        filters=answer.Filters(document="[CLIENT_1] Tower survey 2024"),
        extra_searches=[answer.ExtraSearch(query="[CLIENT_1] pump impairments")],
        reply="",
    )

    events = ask("What did John Tan agree in the Acme Holdings Tower survey?", documents=DOCUMENTS)

    shown = json.loads(next(e for e in events if e["type"] == "TOOL_CALL_ARGS")["delta"])
    assert shown == {
        "query": "fire pump tests agreed by John Tan",
        "filters": {"document": "Acme Holdings Tower survey 2024"},
        "also": ["Acme Holdings pump impairments"],
    }
    searched = json.loads(next(e for e in events if e["type"] == "TOOL_CALL_RESULT")["content"])
    assert searched["filters"] == {"document": "Acme Holdings Tower survey 2024"}
    assert _result(events)["filters"] == {"document": "Acme Holdings Tower survey 2024"}
    queries = [query for query, _, _ in fake["calls"]["search"]]
    assert queries == ["fire pump tests agreed by [PERSON_1]", "[CLIENT_1] pump impairments"]


def test_past_reports_reach_the_reranker_masked(fake, fake_privacy, monkeypatch):
    # The real search, against test_leak's recording Cohere and in-memory Chroma, whose
    # past reports name John Tan of Acme Holdings.
    recorder = test_leak.Recorder(parsed=None)
    chroma = SimpleNamespace(get_collection=lambda **_: test_leak.Collection())
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: recorder)
    monkeypatch.setattr(answer, "retrieve", retriever.retrieve)
    fake["plan"] = answer.Plan(
        kind="search",
        query="impairment handling",
        filters=answer.Filters(source_type="marsh_report"),
        reply="",
    )

    ask("How did past reports handle impairments?")

    assert any("[PERSON_1]" in p for p in recorder.payloads), recorder.payloads
    assert leaked(recorder.payloads) == [], recorder.payloads


def test_both_chat_models_are_told_to_copy_placeholders_exactly(fake):
    # In the prompt with protection off too, so the off and on evals differ only in masking.
    events = ask("Did John Tan agree?", privacy=None)

    system, _ = fake["calls"]["answer"][0]
    assert PLACEHOLDER_RULE in system
    assert PLACEHOLDER_RULE in answer.PLAN_SYSTEM
    assert _result(events)["prompt_version"] == "cb01-v17"

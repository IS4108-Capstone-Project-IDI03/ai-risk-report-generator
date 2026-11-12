"""AS-06: MarshBot's wording of its turns. The model is mocked; the route keeps only programs it
can draw."""

from fastapi.testclient import TestClient

from app.assistant.wording import Program, WordingResult
from app.generation.llm import GenerationFailed
from app.main import app

client = TestClient(app)

REQUEST = {
    "viewer": {"first_name": "Mei", "role": "engineer"},
    "messages": [
        {
            "id": "t1",
            "text": "",
            "parts": [
                {"type": "say", "text": "A recording failed to transcribe.", "tone": "normal"},
                {"type": "card", "id": "t1-todo", "card": "tasks"},
            ],
        },
        {
            "id": "t2",
            "text": "",
            "parts": [{"type": "say", "text": "All is quiet.", "tone": "good"}],
        },
    ],
}
GOOD = (
    'root = Reply([a, b])\na = Say("One recording could not be transcribed.")\nb = Card("t1-todo")'
)


def run(monkeypatch, programs, request=REQUEST):
    sent = []

    def complete(system, user, schema, effort, feature=None, model=None):
        sent.append({"system": system, "user": user, "feature": feature, "model": model})
        if isinstance(programs, Exception):
            raise programs
        return WordingResult(programs=[Program(message_id=k, program=v) for k, v in programs]), "m"

    monkeypatch.setattr("app.assistant.wording.complete", complete)
    return client.post("/assistant/wording", json=request), sent


def test_returns_a_program_per_turn(monkeypatch):
    response, sent = run(
        monkeypatch, [("t1", GOOD), ("t2", 'root = Reply([a])\na = Say("Quiet.", "good")')]
    )

    body = response.json()
    assert response.status_code == 200
    assert body["programs"]["t1"] == GOOD
    assert set(body["programs"]) == {"t1", "t2"}
    assert body["provenance"]["prompt_version"] == "as06-word-v3"
    assert sent[0]["feature"] == "assistant-wording"
    assert "- Say: A recording failed to transcribe." in sent[0]["user"]
    assert '- Card("t1-todo"), a tasks card' in sent[0]["user"]
    assert 'Say(text, "good")' in sent[0]["user"]
    assert "root = Reply(" in sent[0]["system"]


def test_programs_with_unknown_components_roots_or_turns_are_dropped(monkeypatch):
    bad = [("t2", 'root = Reply([a])\na = ActionRow("x")'), ("ghost", GOOD)]

    assert run(monkeypatch, bad)[0].json()["programs"] == {}
    assert run(monkeypatch, [("t2", 'a = Say("x")')])[0].json()["programs"] == {}


def test_card_ids_are_left_to_the_gateway(monkeypatch):
    # The gateway (wording.service.ts) is the one full check: card ids, numbers, names.
    unknown = GOOD.replace('Card("t1-todo")', 'Card("t9")')

    assert run(monkeypatch, [("t1", unknown)])[0].json()["programs"] == {"t1": unknown}


def test_a_bad_escape_still_answers_with_the_usage(monkeypatch):
    bad = r"root = Reply([a])" + "\n" + r'a = Say("It\'s quiet.")'

    response, _ = run(monkeypatch, [("t2", bad), ("t1", GOOD)])

    assert response.status_code == 200
    assert response.json()["programs"]["t1"] == GOOD
    assert "usage" in response.json()


def test_the_components_come_from_the_generated_prompt():
    from app.assistant.wording import COMPONENTS

    assert COMPONENTS == {"Reply", "Say", "Card"}


def test_a_component_name_inside_a_string_is_only_text(monkeypatch):
    program = 'root = Reply([a])\na = Say("Check Valve(s) now")'

    assert run(monkeypatch, [("t2", program)])[0].json()["programs"] == {"t2": program}


def test_code_fences_are_removed(monkeypatch):
    program = 'root = Reply([a])\na = Say("Hi.")'

    body = run(monkeypatch, [("t2", f"```\n{program}\n```")])[0].json()

    assert body["programs"] == {"t2": program}


def test_a_model_failure_is_a_502(monkeypatch):
    response, _ = run(monkeypatch, GenerationFailed("The language model could not be reached."))

    assert response.status_code == 502


def test_no_messages_makes_no_call(monkeypatch):
    response, sent = run(monkeypatch, GenerationFailed("never"), {**REQUEST, "messages": []})

    assert response.json()["programs"] == {}
    assert sent == []

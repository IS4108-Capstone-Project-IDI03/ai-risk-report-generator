"""AS-06: MarshBot's wording. The model is mocked; the route keeps only programs it can draw."""

from fastapi.testclient import TestClient

from app.assistant.wording import Program, WordingResult
from app.generation.llm import GenerationFailed
from app.main import app

client = TestClient(app)

REQUEST = {
    "viewer": {"first_name": "Mei", "role": "engineer"},
    "messages": [
        {
            "id": "m1",
            "text": "A recording failed to transcribe.",
            "parts": [
                {"type": "actions", "itemIds": ["i1"]},
                {
                    "type": "link",
                    "label": "Open observations",
                    "link": {"tab": "observations"},
                    "icon": "x",
                },
                {
                    "type": "replies",
                    "replies": [
                        {"id": "not-now", "label": "Not now", "primary": False, "picksDate": False}
                    ],
                },
            ],
        },
        {"id": "m2", "text": "All is quiet.", "parts": []},
    ],
    "items": [
        {
            "id": "i1",
            "title": "Loading Bay 2",
            "detail": "1:48",
            "kind": "failed",
            "weight": "fix_now",
        }
    ],
}
GOOD = (
    'root = Reply([a, b, c, d])\na = Say("One recording could not be transcribed.")\n'
    'b = ActionRow("i1")\nc = LinkButton("Open observations", "link-1")\nd = QuickReply("not-now")'
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


def test_returns_a_program_per_message(monkeypatch):
    response, sent = run(
        monkeypatch, [("m1", GOOD), ("m2", 'root = Reply([a])\na = Say("Quiet.")')]
    )

    body = response.json()
    assert response.status_code == 200
    assert body["programs"]["m1"] == GOOD
    assert set(body["programs"]) == {"m1", "m2"}
    assert body["provenance"]["prompt_version"] == "as06-word-v2"
    assert sent[0]["feature"] == "assistant-wording"
    assert "ActionRow, one per item id: i1" in sent[0]["user"]
    assert 'LinkButton, label "Open observations", id "link-1"' in sent[0]["user"]
    assert "root = Reply(" in sent[0]["system"]


def test_programs_with_unknown_components_roots_or_messages_are_dropped(monkeypatch):
    bad = [("m2", 'root = Reply([a])\na = Chart("x")'), ("ghost", GOOD)]

    assert run(monkeypatch, bad)[0].json()["programs"] == {}
    assert run(monkeypatch, [("m2", 'a = Say("x")')])[0].json()["programs"] == {}


def test_ids_are_left_to_the_gateway(monkeypatch):
    # The gateway (wording.service.ts) is the one full check: ids, numbers, required controls.
    unknown = GOOD.replace('ActionRow("i1")', 'ActionRow("i9")')

    assert run(monkeypatch, [("m1", unknown)])[0].json()["programs"] == {"m1": unknown}


def test_a_bad_escape_still_answers_with_the_usage(monkeypatch):
    bad = r"root = Reply([a])" + "\n" + r'a = Say("It\'s quiet.")'

    response, _ = run(monkeypatch, [("m2", bad), ("m1", GOOD)])

    assert response.status_code == 200
    assert response.json()["programs"]["m1"] == GOOD
    assert "usage" in response.json()


def test_the_components_come_from_the_generated_prompt():
    from app.assistant.wording import COMPONENTS

    assert {"Reply", "Say", "ActionRow", "QuickReply", "LinkButton"} <= COMPONENTS


def test_a_component_name_inside_a_string_is_only_text(monkeypatch):
    program = 'root = Reply([a])\na = Say("Check Valve(s) now")'

    assert run(monkeypatch, [("m2", program)])[0].json()["programs"] == {"m2": program}


def test_code_fences_are_removed(monkeypatch):
    program = 'root = Reply([a])\na = Say("Hi.")'

    body = run(monkeypatch, [("m2", f"```\n{program}\n```")])[0].json()

    assert body["programs"] == {"m2": program}


def test_a_model_failure_is_a_502(monkeypatch):
    response, _ = run(monkeypatch, GenerationFailed("The language model could not be reached."))

    assert response.status_code == 502


def test_no_messages_makes_no_call(monkeypatch):
    response, sent = run(monkeypatch, GenerationFailed("never"), {**REQUEST, "messages": []})

    assert response.json()["programs"] == {}
    assert sent == []

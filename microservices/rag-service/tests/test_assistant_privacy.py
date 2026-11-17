"""AS-06: MarshBot's two AI calls with PII protection on. Client details are masked before the
model call and restored in the output (conftest `fake_privacy`); the model is mocked."""

import json

from fastapi.testclient import TestClient

from app.assistant.coverage import CoverageResult, ThinFlag
from app.assistant.wording import Program, WordingResult
from app.main import app

client = TestClient(app)

SEEDED = ["Acme Holdings", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Holdings"]},
        {"type": "PERSON", "names": ["John Tan"]},
        {"type": "PERSON", "names": ['Mary "Mo" Tan']},
    ],
}
COVERAGE = {
    "assessment": {"reference": "RPT-1", "jurisdiction": "SG", "facility_type": "Warehouse"},
    "checklist": [{"id": "c1", "area": "Fire", "text": "Ask John Tan about Acme Holdings valves"}],
    "observations": [
        {
            "id": "o1",
            "COPE_dimension": ["Protection"],
            "note": "John Tan (S1234567D) says valve shut; call +65 9123 4567.",
            "location": "Acme Holdings pump room",
        }
    ],
    "sections": [{"section_id": "6", "title": "Fire", "cope_dimensions": ["Protection"]}],
    "privacy": PRIVACY,
}
WORDING = {
    "viewer": {"first_name": "John Tan", "role": "engineer"},
    "messages": [
        {
            "id": "m1",
            "text": "",
            "parts": [
                {"type": "say", "text": "Acme Holdings has one open issue.", "tone": "normal"},
                {"type": "say", "text": "John Tan noted it in the pump room.", "tone": "normal"},
                {"type": "card", "id": "m1-rest", "card": "rows"},
            ],
        }
    ],
    "privacy": PRIVACY,
}


def mock(monkeypatch, where, result):
    prompts = []

    def complete(system, user, schema, effort, feature=None, model=None):
        prompts.append(system + "\n" + user)
        return result, "m"

    monkeypatch.setattr(f"app.assistant.{where}.complete", complete)
    return prompts


def test_coverage_sends_no_client_detail_and_unmasks_the_reason(monkeypatch, fake_privacy):
    prompts = mock(
        monkeypatch,
        "coverage",
        CoverageResult(
            uncovered=["c1"],
            thin=[ThinFlag(observation_id="o1", section_id="6", reason="[PERSON_1] said little.")],
        ),
    )

    response = client.post("/assistant/coverage", json=COVERAGE)

    assert response.status_code == 200
    assert len(fake_privacy.requests) == 1
    assert not [s for s in SEEDED if s in prompts[0]], prompts[0]
    assert "[PERSON_1] ([NRIC_1]) says valve shut" in prompts[0]
    assert response.json()["thin"][0]["reason"] == "John Tan said little."
    assert response.json()["provenance"]["privacy"]["enabled"] is True


def test_coverage_with_privacy_down_is_a_503_and_sends_nothing(monkeypatch, fake_privacy):
    fake_privacy.failure = 503
    prompts = mock(monkeypatch, "coverage", CoverageResult(uncovered=[], thin=[]))

    response = client.post("/assistant/coverage", json=COVERAGE)

    assert response.status_code == 503
    assert prompts == []


def test_wording_masks_in_and_unmasks_out_keeping_quotes_valid(monkeypatch, fake_privacy):
    program = (
        'root = Reply([a, b])\na = Say("[CLIENT_1] has one open issue, [PERSON_1].")\n'
        'b = Card("m1-rest")'
    )
    prompts = mock(
        monkeypatch,
        "wording",
        WordingResult(programs=[Program(message_id="m1", program=program)]),
    )

    response = client.post("/assistant/wording", json=WORDING)

    assert response.status_code == 200
    assert len(fake_privacy.requests) == 1
    assert not [s for s in SEEDED if s in prompts[0]], prompts[0]
    shown = response.json()["programs"]["m1"]
    assert 'Say("Acme Holdings has one open issue, John Tan.")' in shown


def test_a_real_name_with_a_quote_stays_a_valid_string_literal(monkeypatch, fake_privacy):
    # Mary "Mo" Tan is [PERSON_1] here: the first-named person in this request.
    request = {**WORDING, "viewer": {"first_name": 'Mary "Mo" Tan', "role": "engineer"}}
    program = 'root = Reply([a])\na = Say("Hello [PERSON_1].")'
    mock(
        monkeypatch,
        "wording",
        WordingResult(programs=[Program(message_id="m1", program=program)]),
    )

    shown = client.post("/assistant/wording", json=request).json()["programs"]["m1"]

    literal = shown.split("a = Say(")[1].removesuffix(")")
    assert json.loads(literal) == 'Hello Mary "Mo" Tan.'


def test_a_program_with_an_unknown_placeholder_is_dropped(monkeypatch, fake_privacy):
    program = 'root = Reply([a])\na = Say("Hello [PERSON_9].")'
    mock(
        monkeypatch,
        "wording",
        WordingResult(programs=[Program(message_id="m1", program=program)]),
    )

    assert client.post("/assistant/wording", json=WORDING).json()["programs"] == {}


def test_wording_with_privacy_down_is_a_503_and_sends_nothing(monkeypatch, fake_privacy):
    fake_privacy.failure = 503
    prompts = mock(monkeypatch, "wording", WordingResult(programs=[]))

    response = client.post("/assistant/wording", json=WORDING)

    assert response.status_code == 503
    assert prompts == []


def _turn(turn_id, text):
    return {"id": turn_id, "text": "", "parts": [{"type": "say", "text": text, "tone": "normal"}]}


# The masker read "Alex! Capture" as one name: a value that runs across a sentence end.
MISREAD = {
    "enabled": True,
    "known_entities": [
        {"type": "PERSON", "names": ["Alex! Capture"]},
        {"type": "CLIENT", "names": ["Acme Holdings"]},
    ],
}


def test_a_turn_with_a_value_across_a_sentence_end_is_not_sent_for_wording(
    monkeypatch, fake_privacy
):
    request = {
        "viewer": {"first_name": "Sam", "role": "engineer"},
        "messages": [
            _turn("m1", "Good morning, Alex! Capture the pump room."),
            _turn("m2", "Acme Holdings has one open issue."),
        ],
        "privacy": MISREAD,
    }
    program = 'root = Reply([a])\na = Say("[CLIENT_1] has one open issue.")'
    prompts = mock(
        monkeypatch,
        "wording",
        WordingResult(
            programs=[
                Program(message_id="m1", program='root = Reply([a])\na = Say("Hi.")'),
                Program(message_id="m2", program=program),
            ]
        ),
    )

    programs = client.post("/assistant/wording", json=request).json()["programs"]

    assert list(programs) == ["m2"]
    # The system prompt has its own examples, so look at the turns part only.
    sent = prompts[0].split("Turns:")[1]
    assert "### Turn m1" not in sent and "Capture" not in sent
    assert "### Turn m2" in sent


def test_wording_with_every_turn_filtered_out_does_not_call_the_model(monkeypatch, fake_privacy):
    request = {
        "viewer": {"first_name": "Sam", "role": "engineer"},
        "messages": [_turn("m1", "Good morning, Alex! Capture the pump room.")],
        "privacy": MISREAD,
    }
    prompts = mock(monkeypatch, "wording", WordingResult(programs=[]))

    response = client.post("/assistant/wording", json=request)

    assert response.status_code == 200
    assert response.json()["programs"] == {}
    assert prompts == []


def test_a_name_inside_one_sentence_is_still_worded(monkeypatch, fake_privacy):
    request = {
        "viewer": {"first_name": "Sam", "role": "engineer"},
        "messages": [_turn("m1", "Good morning, John Tan! Capture the pump room.")],
        "privacy": PRIVACY,
    }
    program = 'root = Reply([a])\na = Say("Morning, [PERSON_1]! Capture the pump room.")'
    prompts = mock(
        monkeypatch,
        "wording",
        WordingResult(programs=[Program(message_id="m1", program=program)]),
    )

    programs = client.post("/assistant/wording", json=request).json()["programs"]

    assert "John Tan" not in prompts[0]
    assert (
        programs["m1"] == 'root = Reply([a])\na = Say("Morning, John Tan! Capture the pump room.")'
    )

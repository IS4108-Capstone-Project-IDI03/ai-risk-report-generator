"""CP-35: /split-note with the model mocked (privacy served by conftest's fake_privacy)."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.site_walk.note_split import ModelPart, SplitResult

client = TestClient(app)
PRIVACY = {"enabled": True, "known_entities": [{"type": "PERSON", "names": ["John Tan"]}]}


def part(line, kind, text, shorthand, unknown=()):
    return ModelPart(
        line=line, kind=kind, text=text, shorthand=shorthand, unknown_terms=list(unknown)
    )


def mock(monkeypatch, parts):
    prompts = []

    def complete(system, user, schema, effort, feature=None, model=None):
        prompts.append(system + "\n" + user)
        return SplitResult(parts=parts), "m"

    monkeypatch.setattr("app.site_walk.note_split.complete", complete)
    return prompts


def post(lines, glossary=(), privacy=None):
    return client.post(
        "/split-note", json={"lines": lines, "glossary": list(glossary), "privacy": privacy}
    )


def test_parts_are_typed_and_keep_their_line(monkeypatch):
    mock(
        monkeypatch,
        [
            part(0, "info_request", "Hydrant test report not provided", "no hydrant test report"),
            part(1, "recommendation", "Replace the pump", "replace pump"),
        ],
    )
    body = post(["no hydrant test report", "replace pump"]).json()
    assert [(p["kind"], p["line"]) for p in body["parts"]] == [
        ("info_request", 0),
        ("recommendation", 1),
    ]
    assert body["provenance"]["prompt_version"] == "cp35-v2"
    assert "usage" in body


def test_numbers_and_units_kept_are_not_flagged(monkeypatch):
    mock(
        monkeypatch,
        [part(0, "fact", "Sprinkler pipe of 150 mm at 7.5 bar", "spk pipe 150mm @ 7.5 bar")],
    )
    assert post(["spk pipe 150mm @ 7.5 bar"]).json()["parts"][0]["flags"] == []


def test_a_dropped_number_is_flagged(monkeypatch):
    mock(monkeypatch, [part(0, "fact", "Sprinkler pipe of 100 mm", "spk pipe 150mm")])
    flags = post(["spk pipe 150mm"]).json()["parts"][0]["flags"]
    assert flags == [{"type": "number_changed", "detail": "150mm"}]


def test_unknown_term_is_flagged_only_when_not_known(monkeypatch):
    mock(
        monkeypatch,
        [part(0, "fact", "zxq valve shut, sprinkler ok", "zxq valve shut spk ok", ["zxq", "spk"])],
    )
    flags = post(["zxq valve shut spk ok"]).json()["parts"][0]["flags"]
    assert flags == [{"type": "unknown_term", "detail": "zxq"}]


def test_a_glossary_term_suppresses_the_flag(monkeypatch):
    mock(monkeypatch, [part(0, "fact", "Zone xq valve shut", "zxq valve shut", ["ZXQ"])])
    glossary = [{"term": "zxq", "meaning": "zone xq"}]
    assert post(["zxq valve shut"], glossary).json()["parts"][0]["flags"] == []


def test_a_line_with_no_split_is_one_fact_part(monkeypatch):
    mock(monkeypatch, [part(0, "fact", "Roof in good condition", "roof good")])
    parts = post(["roof good"]).json()["parts"]
    assert [(p["kind"], p["text"]) for p in parts] == [("fact", "Roof in good condition")]


def test_empty_model_output_falls_back_to_one_fact_per_line(monkeypatch):
    mock(monkeypatch, [part(0, "fact", "  ", "a")])
    parts = post(["a", "b"]).json()["parts"]
    assert [(p["kind"], p["text"], p["line"]) for p in parts] == [
        ("fact", "a", 0),
        ("fact", "b", 1),
    ]


def test_privacy_down_is_a_503_and_the_model_is_not_called(monkeypatch, fake_privacy):
    fake_privacy.failure = 503
    prompts = mock(monkeypatch, [])
    assert post(["John Tan says ok"], privacy=PRIVACY).status_code == 503
    assert prompts == []


def test_raw_client_text_never_reaches_the_model_and_is_restored(monkeypatch, fake_privacy):
    prompts = mock(
        monkeypatch,
        [part(0, "fact", "[PERSON_1] said the valve is shut", "[PERSON_1] says valve shut")],
    )
    response = post(["John Tan says valve shut"], privacy=PRIVACY)
    assert response.status_code == 200
    assert "John Tan" not in prompts[0]
    assert response.json()["parts"][0]["text"] == "John Tan said the valve is shut"


# Found by code review: the unknown-term and number checks were too loose.
def flags_of(monkeypatch, shorthand, text, unknown=()):
    mock(monkeypatch, [part(0, "fact", text, shorthand, unknown)])
    return post([shorthand]).json()["parts"][0]["flags"]


def test_a_term_with_one_unknown_word_is_still_flagged(monkeypatch):
    flags = flags_of(monkeypatch, "xyz pump noisy", "The xyz pump is noisy.", ["xyz pump"])
    assert {"type": "unknown_term", "detail": "xyz pump"} in flags


def test_a_spelled_out_unit_is_not_a_change(monkeypatch):
    assert flags_of(monkeypatch, "refuge 2 hr rating", "The refuge has a 2 hours rating.") == []
    assert flags_of(monkeypatch, "spacing 4.5 m", "Spacing is 4.5 metres.") == []


def test_a_changed_number_or_unit_is_flagged(monkeypatch):
    assert flags_of(monkeypatch, "pipe 10 mm", "The pipe is 100 mm.") != []
    assert flags_of(monkeypatch, "pipe 10 mm", "The pipe is 10 cm.") != []
    assert flags_of(monkeypatch, "tank 20000 L", "The tank is 20000 L.") == []


# Number formats found by the swarm: same value written another way is not a change.
@pytest.mark.parametrize(
    "shorthand,text",
    [
        ("tank 1,000 L", "The tank holds 1000 L."),
        ("tank 1000 L", "The tank holds 1,000 L."),
        ("tank 20000 L", "The tank holds 20 000 L."),
        ("run 4,5 m", "The run is 4.5 m."),
        ("fill 50% full", "The tank is 50 percent full."),
        ("pipe 1.5 m", "The pipe is 1.50 m."),
    ],
)
def test_the_same_value_in_another_format_is_not_flagged(monkeypatch, shorthand, text):
    assert flags_of(monkeypatch, shorthand, text) == []


@pytest.mark.parametrize(
    "shorthand,text",
    [
        ("temp -5 C", "The temperature is 5 C."),
        ("pressure 100 kPa", "The pressure is 10 kPa."),
        ("tank 1000 L", "The tank holds 100 L."),
    ],
)
def test_a_lost_sign_or_a_changed_value_is_flagged(monkeypatch, shorthand, text):
    assert flags_of(monkeypatch, shorthand, text) != []


def test_an_unknown_term_is_flagged_on_every_part_that_uses_it(monkeypatch):
    mock(
        monkeypatch,
        [
            part(0, "fact", "The zxq unit is loud.", "zxq loud", ["zxq"]),
            part(0, "recommendation", "Service the zxq unit.", "service zxq"),
        ],
    )
    out = post(["zxq loud, service zxq"]).json()["parts"]
    assert [p["flags"] for p in out] == [
        [{"type": "unknown_term", "detail": "zxq"}],
        [{"type": "unknown_term", "detail": "zxq"}],
    ]


def test_the_prompt_says_a_code_in_the_middle_of_a_line_starts_a_new_part(monkeypatch):
    prompts = mock(monkeypatch, [part(0, "fact", "x", "x")])
    post(["F: a; IR: b"])
    assert "anywhere in a line" in prompts[0]

"""CP-35: /split-note with the model mocked (privacy served by conftest's fake_privacy)."""

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
    assert body["provenance"]["prompt_version"] == "cp35-v1"
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

"""allow_list.json: words, patterns and names privacy-service never masks (PV-05). Like
detectors.json, it is read when the service starts, so an admin can add one without a release."""

import json

import pytest
from fastapi.testclient import TestClient

from app import allow_list
from app.main import app

client = TestClient(app)


@pytest.fixture
def allowing(monkeypatch, tmp_path):
    """Writes the allow-list file privacy-service reads, and has it read again."""

    def write(settings: dict):
        path = tmp_path / "allow_list.json"
        path.write_text(json.dumps(settings))
        monkeypatch.setenv("PRIVACY_ALLOW_LIST_FILE", str(path))
        allow_list.lists.cache_clear()

    yield write
    allow_list.lists.cache_clear()


def mask(texts):
    response = client.post("/mask", json={"texts": texts, "known_entities": []})
    assert response.status_code == 200, response.text
    return response.json()["texts"]


EQUIVALENCIES = "Walls are rated firewalls or equivalent. (Equivalencies must be well defined.)"


def test_a_word_added_to_the_file_is_never_read_as_a_person(allowing):
    allowing({"never_a_person": {"report wording": []}})
    assert mask([EQUIVALENCIES]) != [EQUIVALENCIES]  # the name model takes it for a person

    allowing({"never_a_person": {"report wording": ["Equivalencies"]}})
    assert mask([EQUIVALENCIES]) == [EQUIVALENCIES]


def test_the_admins_list_sent_with_a_request_replaces_the_files_words(allowing):
    # PV-09: the gateway sends the Never masked list kept in Settings. Even an empty list
    # replaces the file's words, so a word the admin removed is masked again.
    allowing({"never_a_person": {"report wording": ["Equivalencies"]}})

    def mask_never(never_masked):
        response = client.post(
            "/mask", json={"texts": [EQUIVALENCIES], "never_masked": never_masked}
        )
        assert response.status_code == 200, response.text
        return response.json()["texts"]

    assert mask_never([]) != [EQUIVALENCIES]
    assert mask_never(["Equivalencies"]) == [EQUIVALENCIES]


def test_a_known_name_is_masked_even_when_the_admin_lists_it(allowing):
    # A guard (PV-09 AC4): the gateway refuses such an entry, and masking wins here too.
    allowing({})
    response = client.post(
        "/mask",
        json={
            "texts": ["Crest Tower called."],
            "known_entities": [{"type": "SITE", "names": ["Crest Tower"]}],
            "never_masked": ["Crest Tower"],
        },
    )
    assert response.status_code == 200, response.text
    assert "Crest Tower" not in response.json()["texts"][0]


@pytest.fixture
def shipped(monkeypatch):
    """The committed allow_list.json."""
    monkeypatch.delenv("PRIVACY_ALLOW_LIST_FILE", raising=False)
    allow_list.lists.cache_clear()
    yield
    allow_list.lists.cache_clear()


def test_the_shipped_file_keeps_what_a_past_report_had_masked_wrongly(shipped):
    # Found redacting a sample Marsh report (PV-05): floors, report wording and Marsh's own
    # businesses were read as people. Each tag would also mask the word in drafting requests.
    lines = [
        "Staircases connect L23 to L26, and B2 to L1.",
        EQUIVALENCIES,
        "Fire Alarm Monitoring",
        "Sprinkl\nWet pipe",  # a table cell breaks the word over two lines
        "Marsh McLennan businesses include Guy Carpenter, Mercer and Oliver Wyman.",
    ]
    assert mask(lines) == lines


def test_the_files_words_are_offered_to_the_gateway_with_their_headings(allowing):
    # PV-09: the gateway seeds Settings' Never masked list from them once; patterns stay here.
    allowing(
        {
            "never_a_person": {"equipment": ["Hosereel"]},
            "never_masked": {"Marsh": ["Marsh", "Marsh McLennan"]},
            "never_a_person_patterns": {"floors": "[lb][0-9]{1,3}"},
        }
    )
    response = client.get("/allow-list")
    assert response.status_code == 200, response.text
    assert response.json() == {
        "words": [
            {"word": "Hosereel", "reason": "equipment"},
            {"word": "Marsh", "reason": "Marsh"},
            {"word": "Marsh McLennan", "reason": "Marsh"},
        ]
    }


def test_a_typo_in_the_file_is_refused(allowing):
    # A guard: read when the service starts (app.main), so a typo stops it.
    allowing({"never_a_persn": {"x": ["word"]}})
    with pytest.raises(ValueError, match="never_a_persn"):
        allow_list.lists()

    allowing({"never_a_person_patterns": {"floors": "[lb(0-9"}})
    with pytest.raises(ValueError, match="floors is not a valid pattern"):
        allow_list.lists()

    allowing({"never_masked": {"Marsh": "marsh"}})
    with pytest.raises(ValueError, match="Marsh must be a list of words"):
        allow_list.lists()


def test_without_the_file_nothing_is_allowed(monkeypatch, tmp_path):
    # A guard: masking a word too many is the safe side.
    monkeypatch.setenv("PRIVACY_ALLOW_LIST_FILE", str(tmp_path / "missing.json"))
    allow_list.lists.cache_clear()
    try:
        assert not allow_list.is_allowed("Hosereel")
        assert not allow_list.is_never_masked("NFPA")
    finally:
        allow_list.lists.cache_clear()

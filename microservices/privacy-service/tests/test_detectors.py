"""detectors.json switches each kind of detail on or off (PV-04). Known names are always masked."""

import json

import pytest
from fastapi.testclient import TestClient

from app import detectors
from app.main import app

client = TestClient(app)


@pytest.fixture
def switches(monkeypatch, tmp_path):
    """Writes the switch file privacy-service reads, and has it read again."""

    def write(settings: dict):
        path = tmp_path / "detectors.json"
        path.write_text(json.dumps(settings))
        monkeypatch.setenv("PRIVACY_DETECTORS_FILE", str(path))
        detectors.enabled.cache_clear()

    yield write
    detectors.enabled.cache_clear()


def mask(texts, known=()):
    response = client.post("/mask", json={"texts": texts, "known_entities": list(known)})
    assert response.status_code == 200, response.text
    return {key: value for key, value in response.json().items() if key != "spans"}


def test_a_kind_switched_off_is_left_as_written(switches):
    switches({"ADDRESS": False})

    # Some street names ("Lower Kent Ridge Rd") then go back to spaCy, which may take them for a
    # person: switching a kind off doesn't stop the other kinds.
    result = mask(["Owner at 21 Lower Kent Ridge Road, Singapore 119077."])

    assert result == {
        "texts": ["Owner at 21 Lower Kent Ridge Road, Singapore [POSTAL_1]."],
        "mapping": {"[POSTAL_1]": "119077"},
    }


def test_known_names_are_masked_even_with_their_kind_off(switches):
    switches({"PERSON": False})

    result = mask(
        ["John Tan and Mary Lim checked the riser."], [{"type": "PERSON", "names": ["John Tan"]}]
    )

    assert result == {
        "texts": ["[PERSON_1] and Mary Lim checked the riser."],
        "mapping": {"[PERSON_1]": "John Tan"},
    }


def test_a_typo_in_the_file_is_refused(switches):
    # Read when the service starts (app.main), so a typo stops it rather than leave a kind off.
    switches({"ADRESS": False})
    with pytest.raises(ValueError, match="ADRESS"):
        detectors.enabled()

    switches({"PHONE": "no"})
    with pytest.raises(ValueError, match="PHONE must be true or false"):
        detectors.enabled()


def test_without_the_file_every_kind_is_on(monkeypatch, tmp_path):
    monkeypatch.setenv("PRIVACY_DETECTORS_FILE", str(tmp_path / "missing.json"))
    detectors.enabled.cache_clear()
    try:
        assert detectors.enabled() == frozenset(detectors.KINDS)
    finally:
        detectors.enabled.cache_clear()


def test_the_shipped_file_switches_every_kind_on(monkeypatch):
    # A guard on the committed detectors.json: valid, and nothing off by default.
    monkeypatch.delenv("PRIVACY_DETECTORS_FILE", raising=False)
    detectors.enabled.cache_clear()
    try:
        assert detectors.DEFAULT_FILE.exists()
        assert detectors.enabled() == frozenset(detectors.KINDS)
    finally:
        detectors.enabled.cache_clear()

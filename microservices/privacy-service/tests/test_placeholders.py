"""unmask puts the real text back into what a model wrote from masked text."""

from fastapi.testclient import TestClient

from app.main import app
from app.placeholders import unmask

client = TestClient(app)


def test_unmask_restores_what_mask_replaced():
    note = "Mr John Tan (+65 9123 4567) showed the NUS riser."
    known = [{"type": "CLIENT", "names": ["NUS"]}]
    masked = client.post("/mask", json={"texts": [note], "known_entities": known}).json()

    assert unmask(masked["texts"][0], masked["mapping"]) == (note, [])


def test_unmask_accepts_a_placeholder_the_model_wrote_differently():
    mapping = {"[PERSON_1]": "John Tan"}

    assert unmask("[person_1] and PERSON_1 agreed.", mapping) == (
        "John Tan and John Tan agreed.",
        [],
    )


def test_unmask_reports_a_placeholder_it_cannot_resolve():
    text, unknown = unmask("[PERSON_9] signed.", {"[PERSON_1]": "John Tan"})

    assert (text, unknown) == ("[PERSON_9] signed.", ["[PERSON_9]"])

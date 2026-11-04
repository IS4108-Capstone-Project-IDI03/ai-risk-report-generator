"""Tests for /mask's optional `detect` field: names nobody listed (CP-23).

They run the real Presidio analyzer and spaCy model, like test_mask.py.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

TEXT = "Acme Pte Ltd asked Marsh and FM Global about Changi Airport in Singapore."


def mask(text, detect=None, known=()):
    body = {"texts": [text], "known_entities": list(known)}
    if detect is not None:
        body["detect"] = detect
    response = client.post("/mask", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_without_detect_nothing_is_masked():
    assert mask(TEXT) == {"texts": [TEXT], "mapping": {}}


def test_client_masks_organisations_but_not_the_never_mask_list():
    result = mask(TEXT, ["CLIENT"])
    assert result["texts"] == [
        "[CLIENT_1] asked Marsh and FM Global about Changi Airport in Singapore."
    ]
    assert result["mapping"] == {"[CLIENT_1]": "Acme Pte Ltd"}


def test_site_masks_facilities_only_and_never_places():
    result = mask(TEXT, ["SITE"])
    assert result["texts"] == [
        "Acme Pte Ltd asked Marsh and FM Global about [SITE_1] in Singapore."
    ]
    assert result["mapping"] == {"[SITE_1]": "Changi Airport"}


def test_both_kinds_at_once():
    result = mask(TEXT, ["CLIENT", "SITE"])
    assert result["texts"] == ["[CLIENT_1] asked Marsh and FM Global about [SITE_1] in Singapore."]


def test_a_known_name_wins_over_a_detected_one():
    known = [{"type": "CLIENT", "names": ["Acme Pte Ltd"]}]
    result = mask("Acme Pte Ltd and Beta Holdings Ltd agreed.", ["CLIENT"], known)
    assert result["mapping"]["[CLIENT_1]"] == "Acme Pte Ltd"
    assert result["texts"][0].startswith("[CLIENT_1] and [CLIENT_2]")


def test_marsh_read_as_a_person_is_never_masked():
    text = "Acme Logistics Pte Ltd asks Marsh to survey the site."
    result = mask(text, ["CLIENT"])
    assert result["texts"] == ["[CLIENT_1] asks Marsh to survey the site."]


def test_a_name_running_into_a_form_label_is_cut_at_the_line_break():
    result = mask("Crest Tower Central\nAddress: Hong Kong", ["CLIENT", "SITE"])
    assert result["texts"] == ["[SITE_1]\nAddress: Hong Kong"]
    assert result["mapping"] == {"[SITE_1]": "Crest Tower Central"}


def test_a_name_with_and_in_it_stays_whole_without_a_leading_the():
    result = mask("We met the Group Risk and Insurance team.", ["CLIENT"])
    assert result["mapping"] == {"[CLIENT_1]": "Group Risk and Insurance"}
    assert result["texts"] == ["We met the [CLIENT_1] team."]


def test_site_masks_building_names_the_model_misses():
    text = (
        "Lindenmoor Tower and Quarry Hill Tower 2 next to Marlin Quay Phase 1, "
        "then Laem Ridge Container Terminal and Bayu Heights Campus."
    )
    result = mask(text, ["SITE"])
    assert sorted(result["mapping"].values()) == [
        "Bayu Heights Campus",
        "Laem Ridge Container Terminal",
        "Lindenmoor Tower",
        "Marlin Quay Phase 1",
        "Quarry Hill Tower 2",
    ]
    for name in ["Lindenmoor", "Quarry", "Marlin", "Laem", "Bayu"]:
        assert name not in " ".join(result["texts"])


def test_site_masks_a_name_in_capitals():
    result = mask("OAKHAVEN CAMPUS INFORMATION SHEET", ["SITE"])
    assert "OAKHAVEN" not in result["texts"][0]


def test_site_names_leave_generic_phrases_and_lone_nouns_alone():
    text = "The Tower has a Fire Pump House, and the Plant room is near Marsh Centre."
    result = mask(text, ["SITE"])
    assert "Fire Pump House" in result["texts"][0]
    assert "The Tower" in result["texts"][0]
    assert "Plant room" in result["texts"][0]


def test_site_masks_street_addresses_but_keeps_city_and_country():
    cases = {
        "at 55 Queen's Road Central, Hong Kong": "at [ADDRESS_1], Hong Kong",
        "at 5 Changi Business Park Central 2, Singapore 486038": (
            "at [ADDRESS_1], Singapore [POSTAL_1]"
        ),
        "at Jalan Seri Utama 2, Malaysia": "at [ADDRESS_1], Malaysia",
        "at 199 Silom Road, Bangkok": "at [ADDRESS_1], Bangkok",
    }
    for text, expected in cases.items():
        assert mask(text, ["SITE"])["texts"] == [expected], text


def test_addresses_and_building_names_need_site_in_detect():
    result = mask("Lindenmoor Tower is at 55 Queen's Road Central.", ["CLIENT"])
    assert "55 Queen's Road Central" in result["texts"][0]
    assert not any(key.startswith(("[SITE_", "[ADDRESS_")) for key in result["mapping"])


def test_marsh_teams_and_greetings_are_never_masked():
    text = "To: Marsh Property Risk Engineering\n\nHi Marsh,\n\nAcme Logistics Pte Ltd asks."
    result = mask(text, ["CLIENT", "SITE"])
    assert result["mapping"] == {"[CLIENT_1]": "Acme Logistics Pte Ltd"}


def test_a_client_named_after_a_short_listed_name_is_still_masked():
    result = mask("FM Logistics Pte Ltd asked for a survey.", ["CLIENT"])
    assert result["texts"] == ["[CLIENT_1] asked for a survey."]

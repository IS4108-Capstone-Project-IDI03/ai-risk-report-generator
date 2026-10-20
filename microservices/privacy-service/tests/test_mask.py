"""Contract tests for S6's /mask: what a caller sends, what comes back.

They run the real Presidio analyzer and spaCy model: what they find is the behaviour.
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "privacy"}


def mask(texts, known=(), mapping=None):
    body = {"texts": texts, "known_entities": list(known)}
    if mapping is not None:
        body["mapping"] = mapping
    response = client.post("/mask", json=body)
    assert response.status_code == 200, response.text
    return response.json()


NUS = {"type": "CLIENT", "names": ["NUS", "National University of Singapore"]}


def test_masks_a_known_client_name():
    result = mask(["Valves at NUS were shut"], [NUS])
    assert result == {
        "texts": ["Valves at [CLIENT_1] were shut"],
        "mapping": {"[CLIENT_1]": "NUS"},
    }


def test_another_name_case_or_spacing_gets_the_same_placeholder():
    result = mask(["nus said the National  University of singapore owns L2"], [NUS])
    assert result == {
        "texts": ["[CLIENT_1] said the [CLIENT_1] owns L2"],
        "mapping": {"[CLIENT_1]": "NUS"},
    }


def test_masks_contact_details():
    note = "Call +65 9123 4567 or 81234567, email alex@example.com, NRIC S1234567D."
    result = mask([note])
    assert result == {
        "texts": ["Call [PHONE_1] or [PHONE_2], email [EMAIL_1], NRIC [NRIC_1]."],
        "mapping": {
            "[PHONE_1]": "+65 9123 4567",
            "[PHONE_2]": "81234567",
            "[EMAIL_1]": "alex@example.com",
            "[NRIC_1]": "S1234567D",
        },
    }


def test_masks_a_uen_and_a_postal_code_next_to_singapore():
    note = "Owner UEN 201912345K, 21 Lower Kent Ridge Road, Singapore 119077. PD 119077 SGD."
    result = mask([note])
    assert result == {
        "texts": [
            "Owner UEN [UEN_1], 21 Lower Kent Ridge Road, Singapore [POSTAL_1]. PD 119077 SGD."
        ],
        "mapping": {"[UEN_1]": "201912345K", "[POSTAL_1]": "119077"},
    }


def test_masks_a_person_nobody_listed():
    result = mask(["Spoke to John Tan about the pump."])
    assert result == {
        "texts": ["Spoke to [PERSON_1] about the pump."],
        "mapping": {"[PERSON_1]": "John Tan"},
    }


def test_a_repeated_person_keeps_one_placeholder():
    note = (
        "John Tan showed the riser. Mr Tan said Mary Lim tests it monthly. Tan's log was missing."
    )
    result = mask([note])
    assert result == {
        "texts": [
            "[PERSON_1] showed the riser. Mr [PERSON_1] said [PERSON_2] tests it monthly. "
            "[PERSON_1]'s log was missing."
        ],
        "mapping": {"[PERSON_1]": "John Tan", "[PERSON_2]": "Mary Lim"},
    }


TECHNICAL = [
    "FM-200 cylinders on L27 of Block A; NFPA 13 and SS CP 52 apply.",
    "Tyco and Viking heads; Kidde extinguishers; Ansul hood system; Inergen room.",
    "Jockey pump cut-in at 7 bar; PD SGD 2,000,000 and BI 18 months.",
    "Hosereel at B1 near the Fire Command Centre, Singapore Civil Defence Force consulted.",
    "Sprinklers per FM Global Data Sheet 2-0, 2026 edition, and SS 575.",
]


def test_leaves_technical_terms_alone():
    result = mask(TECHNICAL)
    assert result == {"texts": TECHNICAL, "mapping": {}}


def test_a_given_mapping_is_extended_not_restarted():
    first = mask(["Spoke to Mary Lim."])
    second = mask(["John Tan and Mary Lim signed off."], mapping=first["mapping"])
    assert second == {
        "texts": ["[PERSON_2] and [PERSON_1] signed off."],
        "mapping": {"[PERSON_1]": "Mary Lim", "[PERSON_2]": "John Tan"},
    }


def test_figures_that_look_like_phone_numbers_are_kept():
    note = "Sum insured 85000000, loss estimate 91234567, replacement cost SGD 61234567."
    assert mask([note]) == {"texts": [note], "mapping": {}}
    # Written or labelled as a phone number, it is still masked.
    assert mask(["Contact HP 91234567 or 9123-4567."])["texts"] == [
        "Contact HP [PHONE_1] or [PHONE_2]."
    ]


def test_ids_are_masked_only_when_labelled():
    note = "Valve part number 12345678A and tag S1234567D on panel 2."
    assert mask([note]) == {"texts": [note], "mapping": {}}
    assert mask(["Owner's IC S1234567D, company reg 53123456A."])["texts"] == [
        "Owner's IC [NRIC_1], company reg [UEN_1]."
    ]

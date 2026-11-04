"""CP-23: POST /client-intakes/read. The reading LLM (`complete`) and Jev's HTTP call are
mocked; privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

import pytest
from fastapi.testclient import TestClient

from app.client_intake.read import (
    IntakeReading,
    Quoted,
    ReadClient,
    ReadContact,
    ReadDocument,
    ReadSite,
    ReadVisit,
)
from app.main import app
from app.site_walk import jev

client = TestClient(app)

EMAIL = (
    "From: Tan Ah Kow\nSubject: Survey request\n\n"
    "Please survey Acme Pte Ltd's Tuas Warehouse at 5 Tuas Ave 1, Singapore 639345.\n"
    "Visit on 12 Nov 2026, report by 30 Nov 2026. Contact: Tan Ah Kow, Facilities Manager.\n"
    "It is a distribution warehouse for frozen food."
)
DOCS = [{"id": "f1", "name": "Request.eml", "text": EMAIL}]
FACILITY_TYPES = ["Distribution warehouse", "Office building"]
JURISDICTIONS = [{"code": "SG", "name": "Singapore"}, {"code": "MY", "name": "Malaysia"}]
ACME = {
    "id": "c1",
    "name": "Acme Pte Ltd",
    "division": None,
    "sites": [
        {"id": "s1", "name": "Tuas Warehouse", "address": "5 Tuas Ave 1", "has_assessments": True}
    ],
}


def q(value, quote=None, document=1):
    """A value the model read, resting on `quote` (the value itself when not given)."""
    if value is None:
        return Quoted(value=None, quote=None, document=None)
    return Quoted(value=value, quote=quote or value, document=document)


def reading(client_name="Acme Pte Ltd", site_name="Tuas Warehouse", hint=None, **site):
    return IntakeReading(
        client=ReadClient(name=q(client_name), division=q(None)),
        sites=[
            ReadSite(
                name=q(site_name),
                address=site.get("address", q("5 Tuas Ave 1")),
                country=q("Singapore"),
                what_it_is=site.get("what_it_is", q("distribution warehouse for frozen food")),
            )
        ],
        visits=[
            ReadVisit(
                site=1,
                start_date=q("2026-11-12", "Visit on 12 Nov 2026"),
                end_date=q(None),
                report_due_date=q("2026-11-30", "report by 30 Nov 2026"),
                visit_type_hint=q(hint),
                contacts=[
                    ReadContact(
                        name="Tan Ah Kow",
                        role="Facilities Manager",
                        quote="Contact: Tan Ah Kow, Facilities Manager",
                        document=1,
                    )
                ],
            )
        ],
        documents=[ReadDocument(document=1, about="The client's survey request.")],
    )


class FakeJev:
    """Stands in for Jev's /v1/systemone. `picks` maps a question-name prefix to
    (choice, probability); unset ones pick their first criterion at 0.9."""

    def __init__(self):
        self.bodies: list[dict] = []
        self.picks: dict = {}

    def __call__(self, url, headers, body):
        self.bodies.append(body)
        answers = {}
        for name, question in body["questions"].items():
            choice, p = self.picks.get(name.split("_")[0], (next(iter(question["criteria"])), 0.9))
            answers[name] = {"choice": choice, "confidence": p, "probabilities": {choice: p}}
        return {"answers": answers, "usage": {"input_tokens": 100, "output_tokens": 0}}

    def questions(self, kind):
        return [q for b in self.bodies for n, q in b["questions"].items() if n.startswith(kind)]


@pytest.fixture
def fake_jev(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    fake = FakeJev()
    monkeypatch.setattr(jev, "_post", fake)
    return fake


def read(monkeypatch, answer, **body):
    """Posts an intake; returns the response and the prompts the LLM got."""
    prompts = []

    def complete(system, user, schema, effort, feature="draft-section", model=None):
        prompts.append(system + "\n" + user)
        return answer, "m"

    monkeypatch.setattr("app.client_intake.read.complete", complete)
    request = {
        "documents": DOCS,
        "clients": [],
        "facility_types": FACILITY_TYPES,
        "jurisdictions": JURISDICTIONS,
        **body,
    }
    return client.post("/client-intakes/read", json=request), prompts


def test_values_are_filled_with_their_sources(monkeypatch, fake_jev):
    fake_jev.picks["placement"] = ("site_1", 0.9)
    response, prompts = read(monkeypatch, reading())

    assert response.status_code == 200
    body = response.json()
    source = {"document_id": "f1", "quote": "Acme Pte Ltd"}
    assert body["client"] == {
        "name": {"value": "Acme Pte Ltd", "source": source},
        "division": {"value": None, "source": None},
        "existing_id": None,
        "match_not_sure": False,
    }
    [site] = body["sites"]
    assert site["ref"] == "site-1" and site["existing_id"] is None
    assert site["address"]["value"] == "5 Tuas Ave 1"
    assert site["facility_type"] == {
        "value": "Distribution warehouse",
        "source": {"document_id": "f1", "quote": "distribution warehouse for frozen food"},
    }
    assert site["jurisdiction"]["value"] == "SG"
    [visit] = body["assessments"]
    assert visit["site_ref"] == "site-1"
    assert visit["site_visit_date"] == {
        "value": "2026-11-12",
        "source": {"document_id": "f1", "quote": "Visit on 12 Nov 2026"},
    }
    assert visit["site_visit_end_date"] == {"value": None, "source": None}
    assert visit["report_due_date"]["value"] == "2026-11-30"
    assert visit["site_contacts"] == [
        {
            "name": "Tan Ah Kow",
            "role": "Facilities Manager",
            "source": {"document_id": "f1", "quote": "Contact: Tan Ah Kow, Facilities Manager"},
        }
    ]
    assert body["documents"] == [
        {"id": "f1", "placement": {"kind": "site", "ref": "site-1"}, "not_sure": False}
    ]
    assert body["usage"][0]["feature"] == "client-intake"
    assert "Document 1: Request.eml" in prompts[0] and "Tuas Ave 1" in prompts[0]


def test_a_quote_not_in_its_document_empties_the_value(monkeypatch, fake_jev):
    answer = reading(address=q("9 Jurong Pier Rd"))
    answer.visits[0].start_date = q("2026-11-12", "Visit on 14 Nov 2026")
    body = read(monkeypatch, answer)[0].json()

    assert body["sites"][0]["address"] == {"value": None, "source": None}
    assert body["assessments"][0]["site_visit_date"] == {"value": None, "source": None}
    # Case and line breaks don't matter: "acme pte ltd's tuas\nwarehouse" is still found.
    assert body["sites"][0]["name"]["value"] == "Tuas Warehouse"


def test_a_jev_answer_below_its_cutoff_is_left_empty(monkeypatch, fake_jev):
    fake_jev.picks["facility"] = ("type_1", 0.2)
    body = read(monkeypatch, reading())[0].json()

    assert body["sites"][0]["facility_type"] == {"value": None, "source": None}
    assert body["sites"][0]["jurisdiction"]["value"] == "SG"


def test_an_unsure_placement_falls_back_to_the_whole_client(monkeypatch, fake_jev):
    fake_jev.picks["placement"] = ("visit_1", 0.2)
    body = read(monkeypatch, reading())[0].json()

    assert body["documents"] == [{"id": "f1", "placement": {"kind": "client"}, "not_sure": True}]
    [question] = fake_jev.questions("placement")
    assert set(question["criteria"]) == {"client", "site_1", "visit_1"}


def test_a_new_site_is_a_first_survey_without_asking(monkeypatch, fake_jev):
    body = read(monkeypatch, reading(hint="annual resurvey"), clients=[])[0].json()

    assert body["assessments"][0]["visit_type"] == {"value": "First survey", "source": None}
    assert not fake_jev.questions("visit")


def test_a_typo_of_a_recorded_client_matches_it(monkeypatch, fake_jev):
    fake_jev.picks["visit"] = ("resurvey", 0.9)
    answer = reading(client_name="ACME Pte. Ltd", site_name="Tuas Warehouse", hint="re-survey")
    answer.client.name.quote = "Acme Pte Ltd"
    body = read(monkeypatch, answer, clients=[{**ACME, "name": "Acmee Pte Ltd"}])[0].json()

    assert body["client"]["existing_id"] == "c1"
    assert body["client"]["match_not_sure"] is False
    assert body["sites"][0]["existing_id"] == "s1"
    # A recorded site with assessments: Jev tells a resurvey from a follow-up visit.
    assert body["assessments"][0]["visit_type"]["value"] == "Resurvey"
    [question] = fake_jev.questions("visit")
    assert set(question["criteria"]) == {"resurvey", "follow_up"}
    # Its facility type and country are on record, so they aren't asked (or proposed).
    assert fake_jev.questions("facility") == [] and fake_jev.questions("jurisdiction") == []
    assert body["sites"][0]["facility_type"]["value"] is None


def test_a_weak_match_is_left_for_the_engineer(monkeypatch, fake_jev):
    other = {**ACME, "name": "Acme SG Pte Ltd"}
    body = read(monkeypatch, reading(), clients=[other])[0].json()

    assert body["client"]["existing_id"] is None
    assert body["client"]["match_not_sure"] is True
    # The client isn't known, so its sites aren't matched either.
    assert body["sites"][0]["existing_id"] is None


PRIVACY = {
    "enabled": True,
    "known_entities": [{"type": "CLIENT", "names": ["Acme Pte Ltd"]}],
    "detect": ["CLIENT", "SITE"],
}


def test_masking_unavailable_fails_with_503_and_sends_nothing(monkeypatch, fake_jev, fake_privacy):
    fake_privacy.failure = 503
    response, prompts = read(monkeypatch, reading(), privacy=PRIVACY)

    assert response.status_code == 503
    assert "nothing was sent" in response.json()["detail"]
    assert prompts == [] and fake_jev.bodies == []


def test_client_text_is_masked_with_detection_and_unmasked_on_return(
    monkeypatch, fake_jev, fake_privacy
):
    answer = reading(client_name="[CLIENT_1]")
    response, prompts = read(monkeypatch, answer, privacy=PRIVACY)

    assert response.status_code == 200
    [mask_request] = fake_privacy.requests
    assert mask_request["detect"] == ["CLIENT", "SITE"]
    sent = prompts + [str(b) for b in fake_jev.bodies]
    assert not [s for s in sent if "Acme Pte Ltd" in s]
    assert "[CLIENT_1]'s Tuas Warehouse" in prompts[0]
    body = response.json()
    assert body["client"]["name"] == {
        "value": "Acme Pte Ltd",
        "source": {"document_id": "f1", "quote": "Acme Pte Ltd"},
    }


def test_other_flows_send_no_detect(fake_privacy):
    from app.privacy import session

    session({"enabled": True, "known_entities": []}).mask(["text"])

    assert "detect" not in fake_privacy.requests[0]


def test_a_like_named_site_at_another_address_is_a_new_site(monkeypatch, fake_jev):
    neighbour = {"id": "s2", "name": "Tuas Warehousing", "address": "9 Tuas Ave 1"}
    acme = {**ACME, "sites": [{**neighbour, "has_assessments": True}]}
    body = read(monkeypatch, reading(), clients=[acme])[0].json()

    assert body["client"]["existing_id"] == "c1"
    # The names are alike, but the street numbers say it is another site of the client.
    assert body["sites"][0]["existing_id"] is None


def test_an_empty_quote_or_a_value_not_in_its_quote_empties_the_value(monkeypatch, fake_jev):
    answer = reading(site_name="Jurong Plant")
    answer.sites[0].name.quote = "Tuas Warehouse"  # in the document, but not the value's words
    answer.client.name.quote = " "  # empty: found in any text
    answer.visits[0].start_date = Quoted(value="2026-11-12", quote=".", document=1)
    answer.visits[0].contacts[0].name = "Lim Bee Hoon"
    body = read(monkeypatch, answer)[0].json()

    assert body["sites"][0]["name"] == {"value": None, "source": None}
    assert body["client"]["name"] == {"value": None, "source": None}
    assert body["assessments"][0]["site_visit_date"] == {"value": None, "source": None}
    assert body["assessments"][0]["site_contacts"] == []
    # A date's value is the model's conversion, so it need not appear in its quote.
    assert body["assessments"][0]["report_due_date"]["value"] == "2026-11-30"


def test_a_value_differing_from_its_quote_only_in_punctuation_is_kept(monkeypatch, fake_jev):
    answer = reading(client_name="ACME PTE. LTD")
    answer.client.name.quote = "Acme Pte Ltd's"
    body = read(monkeypatch, answer)[0].json()

    assert body["client"]["name"]["value"] == "ACME PTE. LTD"


TWO_SITES = (
    EMAIL + "\nAlso survey the Jurong Office at 10 Jurong Rd on 13 Nov 2026.\n"
    "Then Tuas Warehouse again on 20 Nov 2026."
)


def test_two_read_sites_matching_one_recorded_site_become_one(monkeypatch, fake_jev):
    fake_jev.picks["placement"] = ("site_2", 0.9)
    answer = reading()
    tuas = answer.sites[0]
    jurong = ReadSite(
        name=q("Jurong Office"), address=q("10 Jurong Rd"), country=q(None), what_it_is=q(None)
    )
    tuas_again = ReadSite(
        name=q("Tuas Warehouse"), address=q(None), country=q(None), what_it_is=q(None)
    )
    answer.sites = [tuas, jurong, tuas_again]
    first = answer.visits[0]
    answer.visits = [
        first,
        first.model_copy(update={"site": 2, "start_date": q("2026-11-13", "on 13 Nov 2026")}),
        first.model_copy(update={"site": 3, "start_date": q("2026-11-20", "on 20 Nov 2026")}),
    ]
    docs = [{"id": "f1", "name": "Request.eml", "text": TWO_SITES}]
    body = read(monkeypatch, answer, documents=docs, clients=[ACME])[0].json()

    # The recorded Tuas site is listed once, with both its visits; refs stay consistent.
    assert [(s["ref"], s["existing_id"]) for s in body["sites"]] == [
        ("site-1", "s1"),
        ("site-2", None),
    ]
    assert body["sites"][1]["name"]["value"] == "Jurong Office"
    assert [a["site_ref"] for a in body["assessments"]] == ["site-1", "site-2", "site-1"]
    assert body["documents"][0]["placement"] == {"kind": "site", "ref": "site-2"}
    [question] = fake_jev.questions("placement")
    assert set(question["criteria"]) == {
        "client",
        "site_1",
        "site_2",
        "visit_1",
        "visit_2",
        "visit_3",
    }

"""CP-22: POST /site-walks/propose. The walk-reading LLM (`complete`) and Jev's HTTP call
are mocked; privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.site_walk import jev
from app.site_walk.propose import ReadObservation, SpokenPlace, WalkReading

client = TestClient(app)


def place(building, level, name):
    kind = "building" if building else "elsewhere"
    return SpokenPlace(kind=kind, building=building, level=level, name=name)


def obs(note, where=None, seq=1, start=0.0, end=5.0):
    return ReadObservation(note=note, place=where, recording_seq=seq, start=start, end=end)


def recorded(*recordings):
    return {
        "kind": "recordings",
        "recordings": [
            {"seq": seq, "segments": [{"start": s, "end": e, "text": t} for s, e, t in segs]}
            for seq, segs in recordings
        ],
    }


WALK = recorded((1, [(0.0, 5.0, "We're at Block A level one loading bay, pallets in the lane.")]))


class FakeJev:
    """Stands in for Jev's /v1/systemone. `picks` maps a question-name prefix to a function
    (criteria) -> (choice, probability); unset ones pick a fixed default at 0.9."""

    DEFAULTS = {"severity": "high", "category": "protection", "place": "new"}

    def __init__(self):
        self.bodies: list[dict] = []
        self.picks: dict = {}

    def __call__(self, url, headers, body):
        self.bodies.append(body)
        answers = {}
        for name, q in body["questions"].items():
            kind = name.split("_")[0]
            criteria = q["criteria"]
            pick = self.picks.get(kind) or (
                lambda c, k=kind: (self.DEFAULTS.get(k, next(iter(c))), 0.9)
            )
            choice, p = pick(criteria)
            answers[name] = {"choice": choice, "confidence": p, "probabilities": {choice: p}}
        return {"answers": answers, "usage": {"input_tokens": 1000, "output_tokens": 0}}

    def questions(self, kind):
        return [q for b in self.bodies for n, q in b["questions"].items() if n.startswith(kind)]


@pytest.fixture
def fake_jev(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    fake = FakeJev()
    monkeypatch.setattr(jev, "_post", fake)
    return fake


def propose(monkeypatch, reading, **body):
    """Posts a walk; returns the response and the prompts the LLM got."""
    prompts = []

    def complete(system, user, schema, effort, feature="draft-section", model=None):
        prompts.append(system + "\n" + user)
        return WalkReading(observations=list(reading)), "m"

    monkeypatch.setattr("app.site_walk.propose.complete", complete)
    request = {"report_id": "RPT-1", "transcript": WALK, **body}
    return client.post("/site-walks/propose", json=request), prompts


EXISTING = [{"id": "e1", "building": "Block A", "floor": "Level 1", "name": "Loading bay"}]


def test_a_place_already_on_the_assessment_is_matched_without_asking(monkeypatch, fake_jev):
    reading = [obs("Pallets block the fire lane.", place("block a", "L1", "loading bay"))]
    response, prompts = propose(monkeypatch, reading, existing_locations=EXISTING)

    assert response.status_code == 200
    body = response.json()
    assert body["locations"] == [{"ref": "loc-1", "existing_id": "e1", "kind": "building",
                                  "building": "Block A", "floor": "Level 1",
                                  "name": "Loading bay"}]  # fmt: skip
    assert body["observations"][0]["location_ref"] == "loc-1"
    assert not fake_jev.questions("place")
    # The model reads the timestamped transcript and the existing places' spelling.
    assert "[1 | 0.0-5.0] We're at Block A" in prompts[0]
    assert "Loading bay, Level 1, Block A" in prompts[0]


def test_a_place_repeated_with_its_level_spoken_differently_is_one_location(monkeypatch, fake_jev):
    reading = [
        obs("Racking unanchored.", place("Block B", "2nd floor", "Store"), start=0, end=5),
        obs("Extinguisher missing.", place("block B", "level 2", "store"), start=10, end=15),
    ]
    body = propose(monkeypatch, reading)[0].json()

    [location] = body["locations"]
    assert location["floor"] == "Level 2" and location["existing_id"] is None
    assert [o["location_ref"] for o in body["observations"]] == ["loc-1", "loc-1"]
    # The first place has nothing to choose from and the second is an exact repeat.
    assert not fake_jev.questions("place")


def test_a_misheard_repeat_resolves_to_the_place_jev_chooses(monkeypatch, fake_jev):
    fake_jev.picks["place"] = lambda c: ("walk_loc-1", 0.6)
    reading = [
        obs("Hot work without permit.", place("Block A", "Level 2", "Workshop"), start=0, end=5),
        obs("Oily rags in open bin.", place("Block H", "Level 2", "Workshop"), start=60, end=65),
    ]
    body = propose(monkeypatch, reading)[0].json()

    assert len(body["locations"]) == 1
    first, second = body["observations"]
    assert first["location_ref"] == second["location_ref"] == "loc-1"
    # Jev chose among the walk's place so far and "a new place", below 0.70: marked Check.
    [question] = fake_jev.questions("place")
    assert set(question["criteria"]) == {"walk_loc-1", "new"}
    assert (first["check"]["location"], second["check"]["location"]) == (False, True)


def test_a_place_on_another_level_is_never_offered_as_the_same_place(monkeypatch, fake_jev):
    reading = [
        obs("Pump on manual.", place("Block A", "Level 17", "Fire pump room"), start=0, end=5),
        obs("Straps snapped.", place("Block A", "Roof", "Fire pump area"), start=60, end=65),
    ]
    body = propose(monkeypatch, reading)[0].json()

    # The only earlier place is on Level 17, so the Roof place is new without asking Jev.
    assert len(body["locations"]) == 2
    assert not fake_jev.questions("place")


def test_a_new_place_is_added_when_jev_says_so(monkeypatch, fake_jev):
    reading = [obs("Diesel drums unbunded.", place(None, None, "Car park"))]
    body = propose(monkeypatch, reading, existing_locations=EXISTING)[0].json()

    [question] = fake_jev.questions("place")
    assert set(question["criteria"]) == {"existing_1", "new"}
    assert body["locations"] == [{"ref": "loc-1", "existing_id": None, "kind": "elsewhere",
                                  "building": None, "floor": None, "name": "Car park"}]  # fmt: skip


def test_jev_can_match_an_existing_location_spoken_differently(monkeypatch, fake_jev):
    fake_jev.picks["place"] = lambda c: ("existing_1", 0.95)
    reading = [obs("Dock leveller damaged.", place("Block A", "Level 1", "Loading dock"))]
    body = propose(monkeypatch, reading, existing_locations=EXISTING)[0].json()

    [location] = body["locations"]
    assert location["existing_id"] == "e1" and location["name"] == "Loading bay"
    assert body["observations"][0]["check"]["location"] is False


TOWER_B = "Tower B — Retail Podium and Multi-Storey Car Park Extension"


def test_a_short_building_name_reuses_the_existing_building(monkeypatch, fake_jev):
    existing = [{"id": "e1", "building": TOWER_B, "floor": "Level 2", "name": "Retail atrium"},
                {"id": "e2", "building": "Blk C Car Park", "floor": "Basement 2",
                 "name": "Fire pump room"}]  # fmt: skip
    reading = [
        obs("Shutter blocked.", place("Tower B", "L2", "Retail atrium"), start=0, end=5),
        obs("Hood overdue.", place("tower b", "Level 2", "Food court kitchen"), start=10, end=15),
        obs("Jockey on manual.", place("Block C", "B2", "Fire pump room"), start=20, end=25),
        obs("Heads recessed.", place("Block C.", "Level 5", "EV bays"), start=30, end=35),
    ]
    body = propose(monkeypatch, reading, existing_locations=existing)[0].json()

    atrium, kitchen, pump, ev = body["locations"]
    # An existing place said with the short name is matched without asking Jev.
    assert (atrium["existing_id"], pump["existing_id"]) == ("e1", "e2")
    # A new place (Jev said new) sits in the existing building, not a second "Tower B".
    assert kitchen["existing_id"] is None and kitchen["building"] == TOWER_B
    assert ev["building"] == "Blk C Car Park"
    # Only the kitchen is asked about: the atrium is on its level; EV bays have no candidate.
    assert len(fake_jev.questions("place")) == 1


def test_a_short_name_shared_by_two_buildings_is_kept_as_spoken(monkeypatch, fake_jev):
    existing = [{"id": "e1", "building": "Tower B — Retail", "floor": None, "name": "Podium"},
                {"id": "e2", "building": "Tower B — Office", "floor": None, "name": "Lobby"},
                {"id": "e3", "building": "Tower BC", "floor": None, "name": "Roof"}]  # fmt: skip
    reading = [obs("Hood overdue.", place("Tower B", "Level 6", "Kitchen"))]
    body = propose(monkeypatch, reading, existing_locations=existing)[0].json()

    assert body["locations"][0]["building"] == "Tower B"


def test_a_finding_with_no_clear_place_has_no_location(monkeypatch, fake_jev):
    body = propose(monkeypatch, [obs("Smoking near the gate.")])[0].json()

    assert body["locations"] == []
    assert body["observations"][0]["location_ref"] is None


def test_observations_come_back_in_walk_order(monkeypatch, fake_jev):
    walk = recorded((2, [(0.0, 4.0, "Second.")]), (1, [(0.0, 4.0, "First.")]))
    reading = [obs("Second finding.", seq=2), obs("First finding.", seq=1)]
    body, prompts = propose(monkeypatch, reading, transcript=walk)
    notes = [o["note"] for o in body.json()["observations"]]

    assert notes == ["First finding.", "Second finding."]
    assert [o["ref"] for o in body.json()["observations"]] == ["obs-1", "obs-2"]
    assert prompts[0].index("[1 | 0.0-4.0] First.") < prompts[0].index("[2 | 0.0-4.0] Second.")


def test_every_observation_gets_a_severity_and_category_and_low_picks_are_checked(
    monkeypatch, fake_jev
):
    # Severity follows Marsh's Risk Assessment Matrix: Major x Possible is Priority 1
    # (critical), Minor x Likely is Priority 2 (high); a positive remark is low.
    picks = {
        "consequence": iter([("major", 0.9), ("minor", 0.65), ("minor", 0.9)]),
        "likelihood": iter([("possible", 0.9), ("likely", 0.9), ("likely", 0.9)]),
        "positive": iter([("gap", 0.9), ("gap", 0.9), ("positive", 0.9)]),
    }
    for kind, answers in picks.items():
        fake_jev.picks[kind] = lambda c, a=answers: next(a)
    reading = [
        obs("Sprinkler valve shut."),
        obs("Fire door wedged open.", start=10),
        obs("Valves all locked open, good.", start=20),
    ]
    body = propose(monkeypatch, reading)[0].json()

    got = [
        (o["severity"], o["cope_dimension"], o["check"]["severity"]) for o in body["observations"]
    ]
    assert got == [
        ("critical", "Protection", False),
        ("high", "Protection", True),
        ("low", "Protection", False),
    ]
    # All questions went in one Jev call, with the matrix's levels as choices.
    [call] = fake_jev.bodies
    assert {n.split("_")[0] for n in call["questions"]} == {
        "positive",
        "consequence",
        "likelihood",
        "category",
    }
    assert set(call["questions"]["likelihood_1"]["criteria"]) == {
        "almost_certain",
        "likely",
        "possible",
        "unlikely",
        "very_rare",
    }


def test_a_photo_goes_to_one_of_the_three_observations_spoken_nearest_it(monkeypatch, fake_jev):
    fake_jev.picks["photo"] = lambda c: ("obs_0", 0.9)
    times = [(0, 10), (20, 30), (40, 50), (60, 70), (80, 90)]
    reading = [obs(f"Finding {n}.", start=s, end=e) for n, (s, e) in enumerate(times, 1)]
    photos = [{"id": "p1", "recording_seq": 1, "offset_sec": 45, "description": "A shut valve."}]
    long_walk = recorded((1, [(0.0, 90.0, "A long walk.")]))  # spans must fit the recording
    body = propose(monkeypatch, reading, photos=photos, transcript=long_walk)[0].json()

    [question] = fake_jev.questions("photo")
    assert sorted(question["criteria"].values()) == ["Finding 2.", "Finding 3.", "Finding 4."]
    attached = {o["note"]: o["photo_ids"] for o in body["observations"] if o["photo_ids"]}
    assert attached == {"Finding 3.": ["p1"]}  # obs_0 = the nearest, spoken at that time


def test_a_typed_walk_has_no_times_and_matches_no_photos_by_time(monkeypatch, fake_jev):
    typed = {"kind": "typed", "text": "Block A store: racking unanchored."}
    reading = [obs("Racking unanchored.", place("Block A", None, "Store"), seq=1)]
    photos = [{"id": "p1", "recording_seq": None, "offset_sec": None, "description": "Racking"}]
    body, prompts = propose(monkeypatch, reading, transcript=typed, photos=photos)

    [o] = body.json()["observations"]
    assert (o["recording_seq"], o["start"], o["end"], o["photo_ids"]) == (None, None, None, [])
    assert "Typed walk:\nBlock A store" in prompts[0]
    assert not fake_jev.questions("photo")


def test_every_jev_call_is_returned_as_usage(monkeypatch, fake_jev):
    fake_jev.picks["place"] = lambda c: ("new", 0.9)
    reading = [obs("A.", place("Block A", None, "Store")), obs("B.", place("Block C", None, "X"))]
    body = propose(monkeypatch, reading)[0].json()

    # One place question (the second place has a choice) and one rating call.
    assert len(fake_jev.bodies) == 2
    assert [u["billed_service"] for u in body["usage"]] == ["typesafe-jev"] * 2
    assert body["usage"][0]["feature"] == "site-walk"
    assert body["usage"][0]["cost_usd"] == pytest.approx(1000 * 0.042 / 1_000_000)


def test_the_site_name_is_given_to_the_model_as_the_building_for_unnamed_buildings(
    monkeypatch, fake_jev
):
    reading = [obs("Pump valves not locked open.", place("Harbour Point", "Level 43", "Pump room"))]
    response, prompts = propose(monkeypatch, reading, site_name="Harbour Point")

    assert "Site name: Harbour Point" in prompts[0]
    assert "never a building" in prompts[0]
    assert response.json()["locations"][0]["building"] == "Harbour Point"


def test_no_site_name_means_no_site_name_line(monkeypatch, fake_jev):
    _, prompts = propose(monkeypatch, [obs("x")])

    assert "Site name:" not in prompts[0]


def test_a_location_placed_in_the_site_name_building_is_flagged_for_checking(monkeypatch, fake_jev):
    reading = [
        obs("Pump valves not locked open.", place("Harbour Point", "Level 43", "Pump room")),
        obs("Aisle blocked.", place("Block A", "Level 1", "Bay"), seq=1, start=6.0, end=9.0),
    ]
    body = propose(monkeypatch, reading, site_name="Harbour Point")[0].json()

    assert [o["check"]["location"] for o in body["observations"]] == [True, False]


PRIVACY = {"enabled": True, "known_entities": [{"type": "CLIENT", "names": ["Acme Holdings"]}]}


def test_client_text_reaches_the_model_and_jev_only_masked(monkeypatch, fake_jev, fake_privacy):
    walk = recorded((1, [(0.0, 5.0, "Acme Holdings store, racking unanchored.")]))
    existing = [{"id": "e1", "building": None, "floor": None, "name": "Acme Holdings yard"}]
    photos = [{"id": "p1", "recording_seq": 1, "offset_sec": 2, "description": "Acme Holdings"}]
    reading = [obs("[CLIENT_1] racking unanchored.", place("[CLIENT_1] block", None, "Store"))]
    response, prompts = propose(
        monkeypatch,
        reading,
        transcript=walk,
        existing_locations=existing,
        photos=photos,
        site_name="Acme Holdings Tower",
        privacy=PRIVACY,
    )

    assert response.status_code == 200
    sent = prompts + [str(b) for b in fake_jev.bodies]
    assert not [s for s in sent if "Acme Holdings" in s]
    assert "[CLIENT_1] store" in prompts[0]
    assert "Site name: [CLIENT_1] Tower" in prompts[0]
    # Real names are back in what is returned.
    body = response.json()
    assert body["observations"][0]["note"] == "Acme Holdings racking unanchored."
    assert body["locations"][0]["building"] == "Acme Holdings block"


def test_masking_fails_closed(monkeypatch, fake_jev, fake_privacy):
    fake_privacy.failure = 503
    response, prompts = propose(monkeypatch, [obs("x")], privacy=PRIVACY)

    assert response.status_code == 502
    assert "nothing was sent" in response.json()["detail"]
    assert prompts == [] and fake_jev.bodies == []


def test_a_jev_failure_fails_the_proposal(monkeypatch, fake_jev):
    def down(url, headers, body):
        import httpx

        raise httpx.ConnectError("down")

    monkeypatch.setattr(jev, "_post", down)
    response, _ = propose(monkeypatch, [obs("x")])

    assert response.status_code == 502
    assert "could not be reached" in response.json()["detail"]


@pytest.mark.parametrize("duration", [{"duration_sec": 900.0}, {}])
def test_a_photo_is_matched_by_time_into_the_whole_walk_across_recordings(
    monkeypatch, fake_jev, duration
):
    # Recording 1 lasts 15 min (or, without its duration, until its last segment ends), so a
    # photo at 0:00 of recording 2 sits next to a finding at 14:59 of recording 1.
    fake_jev.picks["photo"] = lambda c: ("obs_0", 0.9)
    walk = {
        "kind": "recordings",
        "recordings": [
            {"seq": 1, **duration, "segments": [{"start": 0.0, "end": 899.0, "text": "a"}]},
            {
                "seq": 2,
                "duration_sec": 600.0,
                "segments": [{"start": 0.0, "end": 400.0, "text": "b"}],
            },
        ],
    }
    reading = [
        obs("Late in one.", seq=1, start=890, end=899),
        obs("Early in two.", seq=2, start=60, end=70),
        obs("Middle of two.", seq=2, start=200, end=210),
        obs("Late in two.", seq=2, start=300, end=310),
    ]
    photos = [{"id": "p1", "recording_seq": 2, "offset_sec": 0, "description": "A valve."}]
    body = propose(monkeypatch, reading, transcript=walk, photos=photos)[0].json()

    [question] = fake_jev.questions("photo")
    assert sorted(question["criteria"].values()) == [
        "Early in two.",
        "Late in one.",
        "Middle of two.",
    ]
    attached = {o["note"]: o["photo_ids"] for o in body["observations"] if o["photo_ids"]}
    assert attached == {"Late in one.": ["p1"]}


def test_a_span_outside_its_recording_is_dropped_but_the_observation_stays(monkeypatch, fake_jev):
    walk = recorded((1, [(0.0, 30.0, "Pallets in the lane."), (30.0, 60.0, "Valves locked open.")]))
    reading = [
        obs("Pallets in the lane.", start=1000.0, end=1010.0),
        obs("Valves locked open.", start=40.0, end=50.0),
        obs("Backwards span.", start=20.0, end=10.0),
        obs("Negative start.", start=-5.0, end=10.0),
    ]
    body = propose(monkeypatch, reading, transcript=walk)[0].json()

    spans = {o["note"]: (o["recording_seq"], o["start"], o["end"]) for o in body["observations"]}
    assert spans["Pallets in the lane."] == (1, None, None)
    assert spans["Backwards span."] == (1, None, None)
    assert spans["Negative start."] == (1, None, None)
    assert spans["Valves locked open."] == (1, 40.0, 50.0)


def test_fire_doors_and_shutters_are_construction_as_in_the_sample_reports():
    """The sample reports put fire doors and shutters in section 7 (eval/site_walk/LABELS.md)."""
    from app.site_walk.propose import CATEGORIES

    assert "fire doors and fire shutters" in CATEGORIES["Construction"]
    assert "door" not in CATEGORIES["Protection"]


def test_typed_notes_between_recordings_are_read_in_walk_order(monkeypatch, fake_jev, fake_privacy):
    walk = recorded((1, [(0.0, 4.0, "Block A level one loading bay.")]))
    walk["recordings"] += [
        {"seq": 2, "kind": "typed", "text": "Acme Holdings store: racking unanchored."},
        {"seq": 3, "segments": [{"start": 0.0, "end": 4.0, "text": "Back at the store."}]},
    ]
    reading = [
        obs("Hose reel blocked.", seq=3, start=0.0, end=4.0),
        obs("[CLIENT_1] racking unanchored.", seq=2, start=None, end=None),
        obs("Pallets in the lane.", seq=1, start=0.0, end=4.0),
    ]
    response, prompts = propose(monkeypatch, reading, transcript=walk, privacy=PRIVACY)

    assert response.status_code == 200
    observations = response.json()["observations"]
    assert [o["note"] for o in observations] == [
        "Pallets in the lane.",
        "Acme Holdings racking unanchored.",
        "Hose reel blocked.",
    ]
    # A typed note keeps its place in the walk but points at no recording to play.
    assert (observations[1]["recording_seq"], observations[1]["start"]) == (None, None)
    assert "[2 | typed] [CLIENT_1] store" in prompts[0]
    assert prompts[0].index("[1 | 0.0-4.0]") < prompts[0].index("[2 | typed]")


def test_typed_note_has_no_recording_when_another_finding_has_an_unknown_seq(monkeypatch, fake_jev):
    walk = recorded((1, [(0.0, 4.0, "Pallets in the lane.")]))
    walk["recordings"].append({"seq": 2, "kind": "typed", "text": "Racking unanchored."})
    reading = [
        obs("Pallets in the lane.", seq=99, start=0.0, end=4.0),
        obs("Racking unanchored.", seq=2, start=None, end=None),
    ]

    response, _ = propose(monkeypatch, reading, transcript=walk)

    assert response.status_code == 200
    assert [
        (o["recording_seq"], o["start"], o["end"]) for o in response.json()["observations"]
    ] == [
        (None, None, None),
        (None, None, None),
    ]

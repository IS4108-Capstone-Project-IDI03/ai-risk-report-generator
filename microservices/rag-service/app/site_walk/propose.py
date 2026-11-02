"""The site walk proposal step (CP-22): a walk's transcript in, proposed locations and
observations out, for the engineer to review. Nothing is saved here.

Called by routes.py's /site-walks/propose. Calls privacy.py (mask), llm.complete under
LLM_PROVIDER (reading the walk) and jev.choose (places, severity, category, photos).
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app.generation.llm import complete
from app.privacy import session as privacy_session
from app.site_walk.jev import choose
from app.site_walk.places import describe, existing_building, location_key, standard_level

# Severity follows the Risk Assessment Matrix (RAM) in Marsh's PRE reports (section 3):
# a finding's consequence and likelihood give its OFI Priority 1-4, which is its severity.
# Must match the matrix in the reports (see eval/site_walk/LABELS.md).
# Hill-climb step (CP-22): the option texts below are tuned on the site walk eval so that,
# read at "possible", major gives Priority 1, moderate 2, minor 3 and insignificant 4, the
# way the sample reports grade their OFIs. The RAM itself is unchanged.
CONSEQUENCES = {
    "insignificant": "Insignificant: paperwork or planning only, nothing wrong on site: "
    "records not kept or not passed on, a scenario missing from an emergency plan. Also "
    "neighbouring property near the site, which the reports rate a light exposure.",
    "minor": "Minor: a partial or local gap on a secondary or backup item, with the main "
    "protection still working: a valve on a hose reel or transfer line not locked or only "
    "partly open, worn valve straps, an item missed at one inspection, a detector missing "
    "in a small room with little to burn.",
    "moderate": "Moderate: protection or its management is weaker or less reliable, but not "
    "known to fail: key valves not locked or supervised, tests or performance checks "
    "missing, service records without readings, no formal impairment programme, sprinkler "
    "cover plates painted over, a missing fire watch, combustible clutter in a utility "
    "room, a fire door or shutter held open or blocked by something that can be cleared.",
    "major": "Major: fire protection that may not work when a fire starts, or a fire that "
    "could start or spread unchecked in a key area: a fire pump not on automatic, a main "
    "valve shut or unaccounted for, sprinkler or suppression heads that cannot spray "
    "properly, detection or alarm links missing in a key area, fire walls, penetrations or "
    "fire doors that will not hold a fire, combustibles in a fire pump room or against "
    "electrical panels, a hot work clearance or impairment control far below the standard.",
    "catastrophic": "Catastrophic: on its own, could lead to the loss of a building or the "
    "site, or months of interruption.",
}
LIKELIHOODS = {
    "almost_certain": "Almost certain: the gap is already causing damage, or a fire is "
    "expected soon.",
    "likely": "Likely: the gap would make a difference in most fires in that area.",
    "possible": "Possible: the gap would make a difference in a fire there. The usual "
    "answer for a real gap.",
    "unlikely": "Unlikely: other protection or redundancy would normally cover the gap.",
    "very_rare": "Very rare: it only matters if several other things fail too.",
}
_P = {1: "critical", 2: "high", 3: "moderate", 4: "low"}
RAM = {  # likelihood -> priority for each consequence, in CONSEQUENCES order
    "almost_certain": (2, 2, 1, 1, 1),
    "likely": (3, 2, 2, 1, 1),
    "possible": (4, 3, 2, 1, 1),
    "unlikely": (4, 4, 3, 2, 1),
    "very_rare": (4, 4, 3, 2, 2),
}
REMARK = {
    "gap": "A gap, hazard or something to improve.",
    "positive": "A positive remark about good practice, with nothing to improve.",
}


def severity(consequence: str, likelihood: str) -> str:
    """Return the severity Marsh's matrix gives a consequence and likelihood."""
    return _P[RAM[likelihood][list(CONSEQUENCES).index(consequence)]]


# Must match speech-ocr-service/app/processors/vision.py CATEGORIES_INSTRUCTION (CP-21).
# Fire doors and shutters are Construction: the sample reports put them in section 7
# under compartmentation (eval/site_walk/LABELS.md).
CATEGORIES = {
    "Construction": "Construction: the building fabric: structure, walls, roofs, fire "
    "compartments, fire doors and fire shutters, fire stopping of penetrations, combustible "
    "construction.",
    "Occupancy": "Occupancy: how the site is used: processes, storage, housekeeping, "
    "utilities, back-up power.",
    "Protection": "Protection: fire protection and security: sprinklers, alarms, "
    "extinguishers, hose reels, pumps, their maintenance and impairment programmes, and "
    "emergency response plans.",
    "Exposure": "Exposure: hazards from outside the site: neighbouring properties, flood, "
    "wind and other natural hazards.",
}
# Questions per classifier call: one call's state must stay inside Jev's context (~32k tokens).
BATCH = 20
# Seconds of transcript either side of a finding that a classifier reads with it.
CONTEXT_PAD = 30
NEW = "new"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns: each observation with the place as spoken and where it was said.
class SpokenPlace(_Model):
    kind: Literal["building", "elsewhere"]
    building: str | None
    level: str | None
    name: str


class ReadObservation(_Model):
    note: str
    place: SpokenPlace | None
    recording_seq: int | None
    start: float | None
    end: float | None


class WalkReading(_Model):
    observations: list[ReadObservation]


# Hill-climb step (CP-22): the place rules below are tuned on the site walk eval.
SYSTEM = """You read a Marsh property risk engineer's narration of a site walk and list every \
observation in it, for the engineer to review.

A recorded walk comes from speech-to-text, so it can contain misheard words, place names \
included ("Zone See" may be "Zone C"). Each line is labelled [recording seq | start-end \
seconds]. A typed walk has no labels. A note typed during a recorded walk is labelled \
[recording seq | typed]: give its seq, and null start and end.

For each observation, in the order it was said:
- note: the finding in one or two clean sentences in Singapore English, without filler \
words, false starts or repeats. Keep every fact, figure and name said; add nothing.
- place: where the finding is. Engineers announce a place ("we're now at Block A, Level \
2, loading bay") and then describe what they see there, so carry the last announced place \
forward until they announce another. kind "building" for a place in a building: building \
(e.g. "Block A"), level (digits, e.g. "Level 2" or "B1"; a level word such as "Roof" or \
"Basement 2" goes here, never in the name; null for the whole building) and name (the area \
or room as spoken, without added descriptors of side, direction, position or what it is \
like: "Water tank area" with level "Roof", not "Roof water tank area"; "Loading bay", not \
"Loading bay (east end)" or "Loading bay out back"; "Plant room", not "Open-air plant \
room" or "Plant room behind the kitchen"; if they named no area, the part of the building \
the finding is about, e.g. "Facade", else "Whole building"). A place the engineer gives a \
level for is kind "building" with that level, even if it is out front or open to the air. \
kind "elsewhere" for a place outside any building that the finding is about (e.g. "Car \
park"): name only, building and level null.
  place is null when the finding is not tied to one place: a remark about the whole site or every \
area visited ("everywhere", "on every floor", "anywhere"), or about a building as a whole rather \
than a part of it (how it is built, how much of it is sprinklered, a programme or plan that \
covers it), the site's boundaries or what lies beyond them, something the engineer marks as \
separate from where they are (from a chat, a lease or another document, "separately", "not a \
site thing", a plan they read), or neighbouring property beyond the site seen from outside. Do not \
carry the last place forward to these, and never invent a place such as "Outside" or "Site". But \
a finding the engineer sees at the announced place (faults shown on a panel there, or records \
they say they are going through there) keeps that place, even if it concerns other areas. Also \
null when no place has been said yet or it is unclear.
- recording_seq, start, end: the recording and seconds where it was said, from the line \
labels; null for a typed walk.

An observation is any remark about the site's risk: hazards and gaps, and positive remarks \
("sprinkler valves all locked open, good") alike. Announcing a place is not an observation. \
Do not merge two findings into one, or split one into two.

If the engineer names levels but never a building, and a site name is given below, use \
the site name as the building for those places, spelled exactly as given. Without a site \
name, leave the building null as before.

Places already on the assessment are listed for their spelling: when the engineer names one \
of them, spell it the same way. Text such as [CLIENT_1] or [PERSON_2] stands in for a real \
name: copy it exactly."""


def _is_note(r) -> bool:
    return getattr(r, "kind", None) == "typed"


def _length(r) -> float:
    """A recording's length in seconds; without a duration, its last segment's end. A typed
    note lasts no time."""
    if _is_note(r):
        return 0.0
    if r.duration_sec is not None:
        return r.duration_sec
    return r.segments[-1].end if r.segments else 0.0


def _lines(recordings) -> list[str]:
    lines = []
    for r in recordings:
        if _is_note(r):
            lines.append(f"[{r.seq} | typed] {r.text}")
        else:
            lines += [f"[{r.seq} | {s.start:.1f}-{s.end:.1f}] {s.text}" for s in r.segments]
    return lines


def _context(obs: dict, recordings) -> str:
    """The transcript said within CONTEXT_PAD seconds of an observation, or its note alone."""
    if obs["recording_seq"] is None or obs["start"] is None:
        return obs["note"]
    lo, hi = obs["start"] - CONTEXT_PAD, obs["end"] + CONTEXT_PAD
    return " ".join(
        s.text
        for r in recordings
        if r.seq == obs["recording_seq"] and not _is_note(r)
        for s in r.segments
        if s.end >= lo and s.start <= hi
    )


def _batches(items: list, size: int = BATCH) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _checked(probability: float) -> bool:
    return probability < config.SITE_WALK_CHECK_BELOW


def _read_walk(transcript, existing: list[dict], recordings, site_name) -> list[dict]:
    """The model's observations in walk order, each place's level in standard spelling."""
    known = "\n".join(f"- {describe(e['building'], e['floor'], e['name'])}" for e in existing)
    walk = "\n".join(_lines(recordings)) if transcript.kind == "recordings" else transcript.text
    site = f"Site name: {site_name}\n\n" if site_name else ""
    user = (
        f"{site}Places already on the assessment:\n{known or '(none)'}\n\n"
        f"{'Recorded' if transcript.kind == 'recordings' else 'Typed'} walk:\n{walk}"
    )
    answer, _ = complete(
        SYSTEM,
        user,
        WalkReading,
        config.SITE_WALK_EFFORT,
        feature="site-walk",
        model=config.SITE_WALK_MODEL,
    )
    seqs = {r.seq for r in recordings}
    # A span must sit inside its recording (+1 s for rounding); anything else is unusable
    # for playback.
    lengths = {r.seq: _length(r) for r in recordings}
    out = []
    for o in answer.observations:
        place = o.place
        if place and (place.kind == "elsewhere" or not (place.building or "").strip()):
            place = SpokenPlace(kind="elsewhere", building=None, level=None, name=place.name)
        if place and place.level:
            place = place.model_copy(update={"level": standard_level(place.level)})
        # A span in an unknown recording (or any span in a typed walk) points nowhere.
        known = o.recording_seq in seqs
        # Without this check, a span like 1000-1010 s in a 60 s recording would reach playback.
        timed = (
            known
            and o.start is not None
            and o.end is not None
            # A typed note lasts no time, so a span the model gives it is dropped too.
            and lengths[o.recording_seq] > 0
            and 0 <= o.start < o.end <= lengths[o.recording_seq] + 1
        )
        out.append(
            {
                "note": o.note.strip(),
                "place": place if place and place.name.strip() else None,
                "recording_seq": o.recording_seq if known else None,
                "start": o.start if timed else None,
                "end": o.end if timed else None,
            }
        )
    # Walk order, whatever order the model listed them in. Without a time on every one
    # (a typed walk), the model's own order is the walk's.
    if all(o["recording_seq"] is not None for o in out):
        out.sort(key=lambda o: (o["recording_seq"], o["start"] or 0.0))
    # Ordered by its note's seq, but a note has no audio: without this, the gateway would
    # refuse the proposal for pointing at a recording that doesn't exist.
    notes = {r.seq for r in recordings if _is_note(r)}
    for o in out:
        if o["recording_seq"] in notes:
            o["recording_seq"] = None
    return out


class _Places:
    """The walk's places, resolved one spoken place at a time in walk order (AC6).

    Choices grow as the walk is read: a place accepted earlier is a choice for every later
    one, so a repeat or a mishearing within the walk resolves to one location.
    """

    def __init__(self, existing: list[dict]):
        self.existing = existing
        self.locations: list[dict] = []  # the proposal's locations, in walk order
        self.by_key: dict[str, tuple[str, bool]] = {}  # spoken key -> (ref, check)

    def _accept(self, building, floor, name, existing_id=None) -> str:
        for loc in self.locations:
            if existing_id and loc["existing_id"] == existing_id:
                return loc["ref"]
        ref = f"loc-{len(self.locations) + 1}"
        self.locations.append(
            {
                "ref": ref,
                "existing_id": existing_id,
                "kind": "building" if building else "elsewhere",
                "building": building,
                "floor": floor,
                "name": name,
            }
        )
        return ref

    def resolve(self, place: SpokenPlace, context: str) -> tuple[str, bool]:
        """Return (location ref, check flag) for one spoken place."""
        # A building said short ("Tower B") takes its spelling on the assessment. Without this,
        # a new place there made a second building next to "Tower B — Retail Podium ...".
        buildings = [e["building"] for e in self.existing if e["building"]]
        if building := place.building and existing_building(place.building, buildings):
            place = place.model_copy(update={"building": building})
        key = location_key(place.name, place.level, place.building)
        # a. An exact repeat (same spelling once levels and case are evened out).
        if key in self.by_key:
            return self.by_key[key]
        for e in self.existing:
            if location_key(e["name"], e["floor"], e["building"]) == key:
                self.by_key[key] = (self._accept(**_fields(e), existing_id=e["id"]), False)
                return self.by_key[key]
        # b. Otherwise the classifier chooses among every known place, or a new one.
        options = {f"existing_{i}": e for i, e in enumerate(self.existing, 1)}
        options |= {
            f"walk_{loc['ref']}": loc for loc in self.locations if loc["existing_id"] is None
        }
        # Hill-climb step 3 (CP-22): a place on another level is never the same place. Levels
        # are in standard spelling by now, so a level said differently still matches. Without
        # this, Jev merged "Roof, fire pump area" into an earlier "Level 17, fire pump room".
        options = {
            k: o
            for k, o in options.items()
            if not (place.level and o.get("floor") and o["floor"] != place.level)
        }
        if not options:
            self.by_key[key] = (self._accept(place.building, place.level, place.name), False)
            return self.by_key[key]
        criteria = {
            k: f"{describe(o.get('building'), o.get('floor'), o['name'])}"
            + (" (already on the assessment)" if k.startswith("existing_") else "")
            for k, o in options.items()
        }
        criteria[NEW] = "A new place, not any of these"
        spoken = describe(place.building, place.level, place.name)
        [(choice, probability)] = choose(
            f"The engineer said they were at: {spoken}\nWhat was said around it: {context}",
            {
                "place": (
                    "This site walk transcript comes from speech-to-text, so a place name may "
                    "be misheard, letters that sound alike included (Block M for Block N, "
                    "Tower Dee for Tower D). Is the place the engineer said the same area as "
                    "one of these? Different rooms or areas are different places, even in the same "
                    "building and level. When both name a level and the levels differ, it "
                    "is a different place unless one level is clearly a mishearing of the "
                    "other. Choose one only if it is the same area said "
                    "differently or misheard (a name that sounds alike or means the same "
                    "thing); otherwise choose a new place.",
                    criteria,
                )
            },
        ).values()
        if choice == NEW:
            ref = self._accept(place.building, place.level, place.name)
        elif choice.startswith("existing_"):
            ref = self._accept(**_fields(options[choice]), existing_id=options[choice]["id"])
        else:
            ref = options[choice]["ref"]
        self.by_key[key] = (ref, _checked(probability))
        return self.by_key[key]


def _fields(existing: dict) -> dict:
    return {"building": existing["building"], "floor": existing["floor"], "name": existing["name"]}


def _rate(observations: list[dict], recordings) -> None:
    """Set each observation's severity and COPE category from the classifier (AC7)."""
    for batch in _batches(list(enumerate(observations, 1))):
        state = "\n\n".join(
            f"Observation {n}: {o['note']}\nWhat was said around it: {_context(o, recordings)}"
            for n, o in batch
        )
        questions = {}
        for n, _ in batch:
            questions[f"positive_{n}"] = (f"Is observation {n} a gap or a positive remark?", REMARK)
            questions[f"consequence_{n}"] = (
                f"Grade the gap in observation {n} the way a Marsh risk engineer grades an "
                "OFI's Priority: how badly would it let a fire loss grow (property damage "
                "and business interruption) compared with it being fixed? Choose the "
                "description that fits the kind of gap.",
                CONSEQUENCES,
            )
            questions[f"likelihood_{n}"] = (
                f"How likely is it that the gap in observation {n} makes a difference in a "
                "fire? Choose possible unless something said makes it clearly more or less "
                "likely.",
                LIKELIHOODS,
            )
            questions[f"category_{n}"] = (
                f"Which COPE category does observation {n} mainly concern?",
                {c.lower(): text for c, text in CATEGORIES.items()},
            )
        answers = choose(state, questions)
        for n, o in batch:
            remark, p_remark = answers[f"positive_{n}"]
            consequence, p_consequence = answers[f"consequence_{n}"]
            likelihood, p_likelihood = answers[f"likelihood_{n}"]
            category, p_category = answers[f"category_{n}"]
            # A positive remark has nothing to fix, so it is low whatever the matrix says.
            positive = remark == "positive"
            o["severity"] = "low" if positive else severity(consequence, likelihood)
            o["cope_dimension"] = category.capitalize()
            sure = p_remark if positive else min(p_remark, p_consequence, p_likelihood)
            o["check"]["severity"] = _checked(sure)
            o["check"]["category"] = _checked(p_category)


def _walk_starts(recordings) -> dict[int, float]:
    """Each recording's start in seconds into the whole walk: the earlier ones' lengths summed."""
    starts, total = {}, 0.0
    for r in recordings:
        starts[r.seq] = total
        total += _length(r)
    return starts


def _gap(obs: dict, starts: dict[int, float], at: float) -> float:
    """Seconds of walk time between an observation's span and a photo taken `at` into the walk."""
    begin = starts[obs["recording_seq"]] + obs["start"]
    end = starts[obs["recording_seq"]] + obs["end"]
    return max(begin - at, at - end, 0)


def _attach_photos(observations: list[dict], photos: list[dict], recordings) -> None:
    """Attach each timed photo to one of the 3 observations spoken nearest it (AC8)."""
    timed = [o for o in observations if o["start"] is not None]
    starts = _walk_starts(recordings)
    pending = []  # (photo number, photo, its candidates) for the classifier to choose among
    for n, photo in enumerate(photos, 1):
        if photo["offset_sec"] is None or photo["recording_seq"] not in starts or not timed:
            continue  # a typed walk's photo, or one from an unknown recording, has no time
        at = starts[photo["recording_seq"]] + photo["offset_sec"]
        near = sorted(timed, key=lambda o: _gap(o, starts, at))[:3]
        if len(near) == 1:
            near[0]["photo_ids"].append(photo["id"])
        else:
            pending.append((n, photo, near))
    for batch in _batches(pending):
        state = "\n".join(f"Photo {n}: {photo['description'] or ''}" for n, photo, _ in batch)
        questions = {
            f"photo_{n}": (
                f"Which observation does photo {n} show?",
                {f"obs_{i}": o["note"] for i, o in enumerate(near)},
            )
            for n, _, near in batch
        }
        answers = choose(state, questions)
        for n, photo, near in batch:
            choice, _ = answers[f"photo_{n}"]
            near[int(choice.removeprefix("obs_"))]["photo_ids"].append(photo["id"])


def _mask_all(masking, values: dict[object, str | None]) -> dict[object, str | None]:
    """`values` masked in one /mask call, read back by the same keys; blanks stay as they are."""
    keys = [k for k, v in values.items() if v]
    masked = dict(zip(keys, masking.mask([values[k] for k in keys]), strict=True))
    return {k: masked.get(k, v) for k, v in values.items()}


def propose_site_walk(transcript, existing_locations, photos, privacy, site_name=None) -> dict:
    """Return {locations, observations, usage}: the walk's proposal in the contract's shape."""
    paid_calls = usage.start()
    masking = privacy_session(privacy)
    recordings = (
        sorted(transcript.recordings, key=lambda r: r.seq)
        if transcript.kind == "recordings"
        else []
    )
    # 1. Mask every client text before any AI call; masking fails closed (raises).
    values: dict[object, str | None] = {
        ("typed",): transcript.text if transcript.kind == "typed" else None
    }
    values[("site",)] = site_name
    for r in recordings:
        if _is_note(r):
            values[("note", r.seq)] = r.text
        else:
            values |= {("seg", r.seq, j): sg.text for j, sg in enumerate(r.segments)}
    for i, e in enumerate(existing_locations):
        values |= {("loc", i, "building"): e.building, ("loc", i, "floor"): e.floor}
        values[("loc", i, "name")] = e.name
    values |= {("photo", i): p.description for i, p in enumerate(photos)}
    masked = _mask_all(masking, values)
    recordings = [
        r.model_copy(update={"text": masked[("note", r.seq)]})
        if _is_note(r)
        else r.model_copy(
            update={
                "segments": [
                    sg.model_copy(update={"text": masked[("seg", r.seq, j)]})
                    for j, sg in enumerate(r.segments)
                ]
            }
        )
        for r in recordings
    ]
    if transcript.kind == "typed":
        transcript = transcript.model_copy(update={"text": masked[("typed",)]})
    existing = [
        {
            "id": e.id,
            "building": masked[("loc", i, "building")],
            "floor": masked[("loc", i, "floor")],
            "name": masked[("loc", i, "name")],
        }
        for i, e in enumerate(existing_locations)
    ]
    existing = [{**e, "floor": e["floor"] and standard_level(e["floor"])} for e in existing]
    photo_rows = [
        {
            "id": p.id,
            "recording_seq": p.recording_seq,
            "offset_sec": p.offset_sec,
            "description": masked[("photo", i)],
        }
        for i, p in enumerate(photos)
    ]
    site_name = masked[("site",)]
    # 2. The model reads the walk into observations, each with its place as spoken.
    observations = _read_walk(transcript, existing, recordings, site_name)
    # 3. Places resolved in walk order, so choices grow as the walk is read.
    places = _Places(existing)
    for n, o in enumerate(observations, 1):
        o |= {"ref": f"obs-{n}", "photo_ids": []}
        o["check"] = {"severity": False, "category": False, "location": False}
        o["location_ref"] = None
        if o["place"]:
            o["location_ref"], o["check"]["location"] = places.resolve(
                o["place"], _context(o, recordings)
            )
            # A building that is the site name was not spoken, so the engineer should check it.
            building = (o["place"].building or "").strip().lower()
            if site_name and building == site_name.strip().lower():
                o["check"]["location"] = True
    # 4. Severity and category; 5. photos.
    _rate(observations, recordings)
    _attach_photos(observations, photo_rows, recordings)
    # 6. Real names back before anything leaves this service.
    originals = {e.id: e for e in existing_locations}

    def unmask(text):
        return masking.unmask(text)[0] if text else text

    locations = []
    for loc in places.locations:
        if loc["existing_id"]:
            e = originals[loc["existing_id"]]
            loc = {**loc, "building": e.building, "floor": e.floor, "name": e.name}
        else:
            loc = {**loc, **{k: unmask(loc[k]) for k in ("building", "floor", "name")}}
        locations.append(loc)
    return {
        "locations": locations,
        "observations": [
            {
                "ref": o["ref"],
                "note": unmask(o["note"]),
                "cope_dimension": o["cope_dimension"],
                "severity": o["severity"],
                "location_ref": o["location_ref"],
                "recording_seq": o["recording_seq"],
                "start": o["start"],
                "end": o["end"],
                "photo_ids": o["photo_ids"],
                "check": o["check"],
            }
            for o in observations
        ],
        "usage": paid_calls,
    }

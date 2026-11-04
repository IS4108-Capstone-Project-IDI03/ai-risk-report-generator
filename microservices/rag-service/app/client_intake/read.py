"""The client intake reading step (CP-23): a client's documents in; a proposed client, sites,
assessments and where each document belongs out, for the engineer to check. Nothing is saved.

Called by routes.py's /client-intakes/read. Calls privacy.py (mask), llm.complete under
LLM_PROVIDER (reading the documents) and jev.choose (facility type, jurisdiction, visit type,
placement).
"""

import difflib
import re
from datetime import date

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app.generation.llm import complete
from app.privacy import session as privacy_session
from app.site_walk.jev import choose

# Must match the ai_calls feature list in server/src/models/ai-call.model.ts.
FEATURE = "client-intake"
# Questions per classifier call: one call's state must stay inside Jev's context (~32k tokens).
BATCH = 20
OTHER = "other"
# Must match the visit types in the CP-23 contract and the gateway's create rules (AC17).
FIRST, RESURVEY, FOLLOW_UP = "First survey", "Resurvey", "Follow-up visit"
REPEAT_VISITS = {
    "resurvey": f"{RESURVEY}: a periodic re-survey of a site surveyed before.",
    "follow_up": f"{FOLLOW_UP}: a short visit to check the recommendations from an earlier survey.",
}
# Trailing company-form words dropped before names are compared ("Acme Pte. Ltd." = "Acme").
SUFFIXES = {"pte", "ltd", "limited", "inc", "sdn", "bhd", "berhad", "co", "corp", "plc", "llc"}


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns. Every value carries the words it rests on and their document.
class Quoted(_Model):
    value: str | None
    quote: str | None
    document: int | None


class ReadClient(_Model):
    name: Quoted
    division: Quoted


class ReadSite(_Model):
    name: Quoted
    address: Quoted
    country: Quoted
    what_it_is: Quoted


class ReadContact(_Model):
    name: str
    role: str | None
    quote: str | None
    document: int | None


class ReadVisit(_Model):
    site: int
    start_date: Quoted
    end_date: Quoted
    report_due_date: Quoted
    visit_type_hint: Quoted
    contacts: list[ReadContact]


class ReadDocument(_Model):
    document: int
    about: str


class IntakeReading(_Model):
    client: ReadClient
    sites: list[ReadSite]
    visits: list[ReadVisit]
    documents: list[ReadDocument]


SYSTEM = """You read the documents a client sent a Marsh property risk engineer (emails, \
letters, forms) to ask for a site survey, and fill in the survey request for the engineer to \
check.

Rules:
- Take every value from the documents only; never guess or add general knowledge. A value \
the documents don't state is null, with a null quote and document.
- Each value carries quote: the exact words of the document it comes from, copied character \
for character (a short span, at most a sentence), and document: that document's number. A \
date's quote is the words stating it, as written (e.g. "Visit on 12 Nov 2026").
- Text such as [CLIENT_1], [SITE_2] or [PERSON_3] stands in for a real name: copy it \
exactly, brackets included, in values and quotes.
- Dates are YYYY-MM-DD. A date written without a year takes the year of the email or letter \
it is in. When later emails change a date, the latest email wins.

What to fill in:
- client: the company that owns or runs the sites (not Marsh, an insurer or a consultant). \
name as written; division: its business unit or division, if stated.
- sites: one per distinct site (a plant, warehouse, building or campus at one address); a \
site mentioned several times is one site. name; address: the street address as written; \
country: the words naming its country or city; what_it_is: the words saying what the site \
is or does (e.g. "cold-storage warehouse for frozen food").
- visits: one per survey visit requested. site: the number of its site in your sites list \
(1 for the first). start_date; end_date (null for a one-day visit or when not stated); \
report_due_date: when the report is due; visit_type_hint: words hinting whether it is a \
first survey, a periodic resurvey or a follow-up of earlier recommendations (null if none). \
contacts: the people to meet on site for this visit, each with name, role (null if not \
stated), and the quote and document they come from.
- documents: one entry per document: its number and what it is about in one sentence (e.g. \
"Email asking for a resurvey of the Tuas site on 12 Nov")."""


def _normal(text: str) -> str:
    """`text` with case, line breaks and placeholder brackets evened out, for quote checks."""
    return " ".join(text.replace("[", "").replace("]", "").casefold().split())


def _words(text: str) -> str:
    """`text` as bare words: no case, punctuation, placeholder brackets or extra spaces."""
    return " ".join(re.sub(r"[^\w\s]", " ", text.casefold()).split())


def _in_quote(value: str, quote: str) -> bool:
    """Whether the value's words appear, whole, in its quote ("Acme Pte. Ltd" in "ACME PTE LTD")."""
    return f" {_words(value)} " in f" {_words(quote)} "


def _empty() -> dict:
    return {"value": None, "source": None}


class _Sources:
    """The documents' masked texts, to check each value's quote against (as checklist checks
    citations): a value whose quote isn't in its document is emptied (Not sure)."""

    def __init__(self, documents, texts: list[str]):
        self.ids = [d.id for d in documents]
        self.texts = [_normal(t) for t in texts]

    def source(self, quote: str | None, document: int | None) -> dict | None:
        """Return the {document_id, quote} the words rest on, or None if they aren't there."""
        # A quote of no words (" ", ".") is "found" in any text, so it proves nothing.
        if not quote or not _words(quote) or document is None:
            return None
        if not 1 <= document <= len(self.texts):
            return None
        if _normal(quote) not in self.texts[document - 1]:
            return None
        return {"document_id": self.ids[document - 1], "quote": quote}

    def field(self, read: Quoted, kind: str = "text") -> dict:
        """Return the value as {value, source}, emptied when its quote isn't found.

        kind: "text" must also appear in its quote, or the quote proves nothing about it; a
        "date" is the model's conversion of its words, and a "hint" is only a lead for Jev."""
        source = self.source(read.quote, read.document)
        value = (read.value or "").strip()
        if not value or not source:
            return _empty()
        if kind == "date" and not _iso_date(value):
            return _empty()
        if kind == "text" and not _in_quote(value, read.quote):
            return _empty()
        return {"value": value, "source": source}


def _iso_date(value: str) -> bool:
    try:
        return len(value) == 10 and bool(date.fromisoformat(value))
    except ValueError:
        return False


def _read(documents, names: list[str], texts: list[str]) -> IntakeReading:
    """The model's reading of every document, in one call."""
    user = "\n\n---\n\n".join(
        f"Document {n}: {name}\n{text}" for n, (name, text) in enumerate(zip(names, texts), 1)
    )
    answer, _ = complete(
        SYSTEM,
        user,
        IntakeReading,
        config.CLIENT_INTAKE_EFFORT,
        feature=FEATURE,
        model=config.CLIENT_INTAKE_MODEL,
    )
    return answer


def _batches(items: list, size: int = BATCH) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _ask(asks: dict[str, tuple[str, str, dict[str, str]]]) -> dict:
    """Jev's {name: (choice, probability)} for each question, BATCH questions per call.

    `asks` maps a name to (its text for the state, instructions, criteria)."""
    answers = {}
    for batch in _batches(list(asks)):
        state = "\n\n".join(asks[n][0] for n in batch)
        questions = {n: asks[n][1:] for n in batch}
        answers |= choose(
            state, questions, classifier=config.CLIENT_INTAKE_CLASSIFIER, feature=FEATURE
        )
    return answers


def _sure(answers: dict, name: str, decision: str) -> str | None:
    """Jev's pick for a question, or None when it is below that decision type's cutoff."""
    if name not in answers:
        return None
    choice, probability = answers[name]
    return choice if probability >= config.CLIENT_INTAKE_CUTOFFS[decision] else None


def _name_key(name: str) -> str:
    """A name casefolded, without punctuation or trailing company-form words."""
    words = re.sub(r"[^\w\s]", " ", name.casefold()).split()
    while len(words) > 1 and words[-1] in SUFFIXES:
        words.pop()
    return " ".join(words)


def _like(a: str | None, b: str | None) -> float:
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, _name_key(a), _name_key(b)).ratio()


def _like_address(a: str | None, b: str | None) -> float:
    # Without this, "5 Tuas Ave 1" would match "7 Tuas Ave 1": a different site next door.
    if re.findall(r"\d+", a or "") != re.findall(r"\d+", b or ""):
        return 0.0
    return _like(a, b)


def _like_site(name: str | None, address: str | None, recorded) -> float:
    """How alike a read site is to a recorded one: by name or by address."""
    # Two addresses with different first numbers are two places, whatever the names. Without
    # this, a client's "Aldergate Hub" matched its "Aldergate House" across town (eval p14).
    numbers = [re.findall(r"\d+", a or "")[:1] for a in (address, recorded.address)]
    if all(numbers) and numbers[0] != numbers[1]:
        return 0.0
    return max(_like(name, recorded.name), _like_address(address, recorded.address))


def _match(recorded: list, score) -> tuple[str | None, bool]:
    """(id, match_not_sure) for the recorded client or site most like the read one."""
    best = max(recorded, key=score, default=None)
    similarity = score(best) if best else 0.0
    if similarity >= config.CLIENT_INTAKE_MATCH:
        return best.id, False
    return None, similarity >= config.CLIENT_INTAKE_MATCH_MAYBE


def _merge_same_sites(sites: list[dict], visits: list) -> list[dict]:
    """Return the sites with each recorded site once (AC5), renumbering the visits' sites.

    Two read sites matching one recorded site merge into the first: its fields are kept and
    the second's visits move to it. Without this, Create would list the recorded site twice."""
    kept: list[dict] = []
    number = {}  # read site number -> number in `kept`
    first_of = {}  # recorded site id -> number in `kept`
    for i, s in enumerate(sites, 1):
        if s["existing_id"] in first_of:
            number[i] = first_of[s["existing_id"]]
            continue
        kept.append(s)
        number[i] = len(kept)
        if s["existing_id"]:
            first_of[s["existing_id"]] = len(kept)
    for v in visits:
        v.site = number[v.site]
    return kept


def _unmasked(value, masking):
    """`value` with every string in it unmasked, so no placeholder leaves this service."""
    if isinstance(value, str):
        return masking.unmask(value)[0]
    if isinstance(value, dict):
        return {k: _unmasked(v, masking) for k, v in value.items()}
    if isinstance(value, list):
        return [_unmasked(v, masking) for v in value]
    return value


def read_client_intake(documents, clients, facility_types, jurisdictions, privacy) -> dict:
    """Return {client, sites, assessments, documents, usage}: the contract's proposal."""
    paid_calls = usage.start()
    masking = privacy_session(privacy, config.CLIENT_INTAKE_PRIVACY_TIMEOUT)
    # 1. Mask every document's name and text before any AI call; masking fails closed (raises).
    masked = masking.mask([d.name for d in documents] + [d.text for d in documents])
    names, texts = masked[: len(documents)], masked[len(documents) :]
    # 2. The model reads every document in one call.
    reading = _read(documents, names, texts)
    # 3. Each value is kept only if its quote is in its document.
    sources = _Sources(documents, texts)
    client = {"name": sources.field(reading.client.name)}
    client["division"] = sources.field(reading.client.division)
    sites = [
        {
            "name": sources.field(s.name),
            "address": sources.field(s.address),
            "country": sources.field(s.country),
            "what_it_is": sources.field(s.what_it_is),
        }
        for s in reading.sites
    ]
    # A visit to a site the model didn't list has nowhere to go, so it is dropped.
    visits = [v for v in reading.visits if 1 <= v.site <= len(sites)]

    # 4. Matching to recorded clients and sites is done here, on real names, so no recorded
    # name is sent anywhere for it. Sites match only the matched client's own sites.
    def real(f: dict) -> str | None:
        return masking.unmask(f["value"])[0] if f["value"] else None

    client["existing_id"], client["match_not_sure"] = _match(
        clients, lambda c: _like(real(client["name"]), c.name)
    )
    recorded_sites = next((c.sites for c in clients if c.id == client["existing_id"]), [])
    for s in sites:
        s["existing_id"], s["match_not_sure"] = _match(
            recorded_sites,
            lambda r, s=s: _like_site(real(s["name"]), real(s["address"]), r),
        )
    sites = _merge_same_sites(sites, visits)
    surveyed = {r.id for r in recorded_sites if r.has_assessments}

    # 5. The fixed choices, asked of the classifier in batches (masked text only).
    asks: dict[str, tuple[str, str, dict[str, str]]] = {}
    facility = {f"type_{i}": t for i, t in enumerate(facility_types, 1)}
    facility[OTHER] = "None of these, or the documents don't say what the site is."
    places = {j.code: j.name for j in jurisdictions}
    places[OTHER] = "Another country, or the documents don't say."
    for i, s in enumerate(sites, 1):
        # A recorded site keeps its own facility type and country. Without this, its address,
        # masked whole as a known name, left Jev nothing to read the country from.
        if s["existing_id"]:
            continue
        if s["name"]["value"] or s["what_it_is"]["value"]:
            asks[f"facility_{i}"] = (
                f"Site {i}: {s['name']['value']}. What it is: {s['what_it_is']['value']}.",
                f"Which type of facility is site {i}?",
                facility,
            )
        if s["address"]["value"] or s["country"]["value"]:
            asks[f"jurisdiction_{i}"] = (
                f"Site {i} address: {s['address']['value']}. "
                f"Country or city: {s['country']['value']}.",
                f"Which country is site {i} in?",
                places,
            )
    hints = [sources.field(v.visit_type_hint, kind="hint") for v in visits]
    for n, (v, hint) in enumerate(zip(visits, hints), 1):
        # Only a recorded site surveyed before can be a resurvey or follow-up (AC17).
        if sites[v.site - 1]["existing_id"] in surveyed:
            asks[f"visit_{n}"] = (
                f"Visit {n}, to site {v.site}, which was surveyed before. "
                f"What the documents say about it: {hint['value'] or 'nothing'}.",
                f"Is visit {n} a periodic resurvey or a follow-up of earlier recommendations?",
                REPEAT_VISITS,
            )
    # Hill-climb step (CP-23): these descriptions are tuned on the client intake eval's tuning
    # packs (eval/client_intake), as general kinds of document, never one pack's wording.
    belongs = {
        "client": "The engagement as a whole: an engagement or appointment letter, a fee "
        "proposal, terms or a contract, or a request or email covering more than one site "
        "or visit."
    }
    belongs |= {
        f"site_{i}": f"Site {i} ({s['name']['value']}, {s['address']['value']}) itself: facts "
        "about the site, its plans, lease or earlier reports, or a discussion of the site "
        "as a whole rather than one visit to it."
        for i, s in enumerate(sites, 1)
    }
    belongs |= {
        f"visit_{n}": f"Visit {n}, to site {v.site} on {v.start_date.value}: a request, "
        "confirmation or change for this one survey visit (its date, access or who to meet)."
        for n, v in enumerate(visits, 1)
    }
    about = {d.document: d.about for d in reading.documents}
    if len(belongs) > 1:
        for n, name in enumerate(names, 1):
            asks[f"placement_{n}"] = (
                f"Document {n} ({name}): {about.get(n) or texts[n - 1][:500]}",
                f"Which does document {n} belong to?",
                belongs,
            )
    answers = _ask(asks)

    for i, s in enumerate(sites, 1):
        pick = _sure(answers, f"facility_{i}", "facility_type")
        evidence = s["what_it_is"] if s["what_it_is"]["value"] else s["name"]
        s["facility_type"] = (
            {"value": facility[pick], "source": evidence["source"]}
            if pick and pick != OTHER
            else _empty()
        )
        pick = _sure(answers, f"jurisdiction_{i}", "jurisdiction")
        evidence = s["country"] if s["country"]["value"] else s["address"]
        s["jurisdiction"] = (
            {"value": pick, "source": evidence["source"]} if pick and pick != OTHER else _empty()
        )
    assessments = []
    for n, (v, hint) in enumerate(zip(visits, hints), 1):
        if f"visit_{n}" in asks:
            pick = _sure(answers, f"visit_{n}", "visit_type")
            visit_type = (
                {"value": REPEAT_VISITS[pick].split(":")[0], "source": hint["source"]}
                if pick
                else _empty()
            )
        else:
            # A new site, or one never surveyed, is a first survey by definition: no AI pick.
            visit_type = {"value": FIRST, "source": None}
        contacts = []
        for c in v.contacts:
            source = sources.source(c.quote, c.document)
            if c.name.strip() and source and _in_quote(c.name, c.quote):
                role = (c.role or "").strip() or None
                contacts.append({"name": c.name.strip(), "role": role, "source": source})
        assessments.append(
            {
                "ref": f"a-{n}",
                "site_ref": f"site-{v.site}",
                "visit_type": visit_type,
                "site_visit_date": sources.field(v.start_date, kind="date"),
                "site_visit_end_date": sources.field(v.end_date, kind="date"),
                "report_due_date": sources.field(v.report_due_date, kind="date"),
                "site_contacts": contacts,
            }
        )
    placements = []
    for n, d in enumerate(documents, 1):
        pick = _sure(answers, f"placement_{n}", "placement")
        # Below the cutoff, the document belongs to the whole client and is flagged (Not sure).
        if pick and pick.startswith("site_"):
            placement = {"kind": "site", "ref": f"site-{pick.removeprefix('site_')}"}
        elif pick and pick.startswith("visit_"):
            placement = {"kind": "assessment", "ref": f"a-{pick.removeprefix('visit_')}"}
        else:
            placement = {"kind": "client"}
        not_sure = f"placement_{n}" in asks and pick is None
        placements.append({"id": d.id, "placement": placement, "not_sure": not_sure})

    # 6. Real names back in every value and quote before anything leaves this service.
    proposal = {
        "client": client,
        "sites": [
            {
                "ref": f"site-{i}",
                "existing_id": s["existing_id"],
                "match_not_sure": s["match_not_sure"],
                **{k: s[k] for k in ("name", "address", "jurisdiction", "facility_type")},
            }
            for i, s in enumerate(sites, 1)
        ],
        "assessments": assessments,
        "documents": placements,
    }
    return {**_unmasked(proposal, masking), "usage": paid_calls}

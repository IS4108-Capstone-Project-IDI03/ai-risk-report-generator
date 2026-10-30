"""Observation reader (CP-05, CP-21). Stateless: reads one observation, returns a proposal.

The evidence is whatever the engineer captured about one finding: their typed note, the
transcripts of their recordings and handwritten pages, and photos read from S3. The proposal is
for the engineer to review: the COPE categories the finding concerns, each with the items it
rests on and their exact words, and, when there are photos, a description of what they show and
a hazard type. It is never report evidence by itself; the engineer takes it into the
observation's note or categories if they agree with it.
"""

import base64
from typing import Literal

import boto3
from google import genai
from pydantic import BaseModel, ValidationError

from app.config import AWS_REGION, GEMINI_API_KEY, S3_BUCKET, VISION_MODEL, VISION_PROVIDER
from app.processors.images import upright_jpeg

# Bump whenever the prompt wording changes, so a saved proposal names the prompt it came from.
PROMPT_VERSION = "cp21-v3"

COPE_DIMENSIONS = ("Construction", "Occupancy", "Protection", "Exposure")

# The OFI "Type" values in Marsh's three sample reports, so a proposal speaks Marsh's terms and
# can carry into a Section 3 OFI later (GN-05).
# ponytail: provisional until Marsh confirms the template's full value list.
HAZARD_TYPES = (
    "Fire Protection System",
    "Fire Protection System Maintenance and Testing",
    "Fire Protection System Operation",
    "Fire Protection Impairment",
    "Sprinkler Installation",
    "Fire door ITM",
    "Housekeeping",
    "Hot Work Permit",
    "Pre-Emergency Planning",
    "Management of back up power supply",
    "Other",
    # Many site photos record a condition as found; this keeps the model from inventing a hazard.
    "No hazard visible",
)

# One finding rarely concerns more than two; four is every category.
MAX_CATEGORIES = 4

# Gemini caps a request with inline images at 20 MB, base64 included; this leaves room for text.
MAX_INLINE_CHARS = 18_000_000

# How each kind of text item is introduced to the model.
TEXT_KINDS = {
    "note": "typed note",
    "recording": "voice recording transcript",
    "page": "handwritten page transcript",
}


class InterpretationError(Exception):
    """The reason the observation could not be read, shown to the engineer."""


class Evidence(BaseModel):
    # An item's name as the request gave it: "Note", "Recording 1", "Page 2", "Photo 1".
    item: str
    # Words copied exactly from that item's text; null for a photo, which has none.
    quote: str | None


class ProposedCategory(BaseModel):
    category: Literal[COPE_DIMENSIONS]
    reason: str
    evidence: list[Evidence]


# The two parts of a proposal, which can be asked for together or one at a time (CP-21): the
# categories, from every item, and the description and hazard type, from the photos.
PARTS = ("categories", "description")


class CategoriesAnswer(BaseModel):
    categories: list[ProposedCategory]


class DescriptionAnswer(BaseModel):
    description: str
    hazard_type: Literal[HAZARD_TYPES]


class FullAnswer(CategoriesAnswer, DescriptionAnswer):
    pass


ANSWERS = {
    ("categories",): CategoriesAnswer,
    ("description",): DescriptionAnswer,
    PARTS: FullAnswer,
}

ITEMS = """Each item has a name, such as "Note", "Recording 1", "Page 2" or "Photo 1". Recordings \
and pages are machine transcripts and can contain misheard or misread words."""

CATEGORIES_INTRO = f"""You read what a Marsh property risk engineer captured about one finding \
during a site survey, and propose for the engineer to review which COPE categories it concerns. \
{ITEMS}"""

DESCRIPTION_INTRO = f"""You look at the photographs a Marsh property risk engineer took of one \
finding during a site survey, and propose a description of them for the engineer to review. \
{ITEMS}"""

CATEGORIES_INSTRUCTION = """

categories: the COPE categories the finding concerns, most relevant first. One finding can \
concern more than one: an unsealed wall penetration is both Construction and Protection. Propose \
a category only when an item supports it, and none when nothing does.
- Construction: the building fabric: structure, walls, roofs, fire compartments, fire stopping of \
penetrations, combustible construction.
- Occupancy: how the site is used: processes, storage, housekeeping, utilities, back-up power.
- Protection: fire protection and security: sprinklers, alarms, extinguishers, hose reels, fire \
doors, pumps, and their maintenance.
- Exposure: hazards from outside the site: neighbouring properties, flood, wind and other natural \
hazards.

For each category:
- reason: one sentence in Singapore English saying what supports it, naming the items, for \
example "Recording 1 says the sprinkler control valve was found shut."
- evidence: every item that supports it, by its name, not only the clearest one: when a note, \
recording, page or photo says or shows the same thing, cite it too, so the engineer can check \
each. For a note, recording or page, quote: a few words copied exactly from that item, unchanged; \
never reword them. For a photo, quote: null.
An item that supports no category is left out of every category's evidence."""

PHOTOS_INSTRUCTION = f"""

description: one or two sentences in the form Marsh's reports use, for example "During the site \
visit to the L43 hosereel pump room, it was observed that the valves were not locked open." Name \
the location if you are given it. Use Singapore English. State only what the photographs show: no \
recommendations, and nothing about what the condition may lead to.

Describe only what is visible. If a detail cannot be made out, leave it out rather than guess. \
If the photographs show nothing wrong, say what they show and set hazard_type to \
"No hazard visible". Never invent a hazard.

The note and transcripts say what the engineer saw. Use them to know what to look at, but \
describe what the photographs show, not what the text claims.

hazard_type: the closest of {", ".join(HAZARD_TYPES[:-2])}; "Other" if none fits; or \
"No hazard visible"."""


def system_instruction(parts: tuple[str, ...]) -> str:
    """The rules for the parts asked for: categories may rest on any item, a description only on
    the photos."""
    if parts == ("description",):
        return DESCRIPTION_INTRO + PHOTOS_INSTRUCTION
    rules = CATEGORIES_INTRO + CATEGORIES_INSTRUCTION
    if "description" in parts:
        rules += "\n\nThere are also photographs." + PHOTOS_INSTRUCTION
        rules += " The categories may rest on any item."
    return rules


def _read(s3, key: str) -> bytes:
    try:
        return s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()
    except Exception as error:
        # The gateway maps these message prefixes to user-facing reasons
        # (server/src/services/observation.service.ts); keep them in sync.
        raise InterpretationError(f"The photo could not be read from storage: {error}") from error


def _prepare(image: bytes) -> str:
    """The photo upright and shrunk (see `upright_jpeg`), as base64."""
    try:
        jpeg = upright_jpeg(image)
    except Exception as error:
        raise InterpretationError(f"The photo could not be opened: {error}") from error
    return base64.b64encode(jpeg).decode("ascii")


def _prompt(photos: list[str], texts: list[dict], location: str | None) -> str:
    """What the engineer captured, after the photos: the items by name, then each text in full."""
    names = [*photos, *(t["label"] for t in texts)]
    lines = [f"One finding, captured as: {', '.join(names)}."]
    if location:
        lines.append(f"Location: {location}")
    for t in texts:
        lines.append(f"\n{t['label']} ({TEXT_KINDS[t['kind']]}):\n{t['text']}")
    return "\n".join(lines)


def _interpret_gemini(
    images: list[tuple[str, str]], prompt: str, parts: tuple[str, ...]
) -> tuple[BaseModel, str, dict | None]:
    answer_type = ANSWERS[parts]
    try:
        # Held open for the whole call: the client closes its connection when it is
        # discarded, so `genai.Client(...).interactions.create(...)` fails with "the
        # client has been closed" before the request is sent.
        with genai.Client(api_key=GEMINI_API_KEY) as client:
            result = client.interactions.create(
                model=VISION_MODEL,
                system_instruction=system_instruction(parts),
                # Each photo after its name, then the text that asks about them.
                input=[
                    *(
                        part
                        for label, data in images
                        for part in (
                            {"type": "text", "text": label},
                            {"type": "image", "data": data, "mime_type": "image/jpeg"},
                        )
                    ),
                    {"type": "text", "text": prompt},
                ],
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": answer_type.model_json_schema(),
                },
                # The engineer's notes and a client's site photos: Google need not keep the request.
                store=False,
            )
    except Exception as error:
        raise InterpretationError(f"The observation could not be read: {error}") from error
    # A safety block or a cut-off answer comes back without usable text.
    if result.status != "completed" or not result.output_text:
        raise InterpretationError(
            f"The observation could not be read: no answer came back (status {result.status})."
        )
    try:
        answer = answer_type.model_validate_json(result.output_text)
    except ValidationError as error:
        raise InterpretationError(
            "The observation could not be read: the answer was not in the expected form."
        ) from error
    usage = result.usage
    tokens = (
        {
            "input_tokens": usage.total_input_tokens,
            "output_tokens": usage.total_output_tokens,
            # Billed as output; kept apart so EV-03 can show both.
            "thought_tokens": usage.total_thought_tokens,
        }
        if usage and usage.total_input_tokens is not None
        else None
    )
    return answer, result.model or VISION_MODEL, tokens


_PROVIDERS = {"gemini": _interpret_gemini}


def _categories(answer: BaseModel) -> list[dict] | None:
    """Each category once, in the model's order, at most MAX_CATEGORIES; None if not asked for."""
    if not isinstance(answer, CategoriesAnswer):
        return None
    seen: set[str] = set()
    kept = []
    for proposed in answer.categories:
        if proposed.category not in seen:
            seen.add(proposed.category)
            kept.append(proposed.model_dump())
    return kept[:MAX_CATEGORIES]


def interpret(
    photos: list[dict],
    texts: list[dict],
    location: str | None,
    parts: tuple[str, ...] | None = None,
) -> dict:
    """The proposal for an observation: photos as {label, s3_key}, texts as {label, kind, text}."""
    s3 = boto3.client("s3", region_name=AWS_REGION) if photos else None
    return interpret_images(
        [(p["label"], _read(s3, p["s3_key"])) for p in photos], texts, location, parts
    )


def interpret_images(
    photos: list[tuple[str, bytes]],
    texts: list[dict],
    location: str | None,
    parts: tuple[str, ...] | None = None,
) -> dict:
    """The proposal for photos already in hand; interpret() and the eval both use it. Without
    `parts`, both when there are photos, else the categories."""
    try:
        provider = _PROVIDERS[VISION_PROVIDER]
    except KeyError:
        raise NotImplementedError(f"VISION_PROVIDER {VISION_PROVIDER!r} is not supported") from None
    parts = tuple(p for p in PARTS if p in (parts or (PARTS if photos else ("categories",))))
    images = [(label, _prepare(photo)) for label, photo in photos]
    if sum(len(data) for _, data in images) > MAX_INLINE_CHARS:
        raise InterpretationError(
            "There are too many photos to interpret together. Save fewer photos per observation."
        )
    prompt = _prompt([label for label, _ in images], texts, location)
    answer, model, usage = provider(images, prompt, parts)
    return {
        # None for a part not asked for.
        "categories": _categories(answer),
        "description": getattr(answer, "description", None),
        "hazard_type": getattr(answer, "hazard_type", None),
        "provider": VISION_PROVIDER,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        # None when the provider reports no usage (EV-03 AC7).
        "usage": usage,
    }

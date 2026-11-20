"""Photo reader (CP-05, CP-21, CP-24). Stateless: describes one observation's photos.

The photos are read from S3. The note and transcripts, if sent, only tell the model what to look
at. The answer is a description of what the photos show and a hazard type, for the engineer to
review. It is never report evidence by itself. (CP-24 removed the COPE categories half: the
category is now suggested by rag-service's /observations/rate.)
"""

import base64
import time
from typing import Literal

import boto3
from google import genai
from pydantic import BaseModel, ValidationError

from app import privacy as protection
from app.config import AWS_REGION, GEMINI_API_KEY, S3_BUCKET, VISION_MODEL, VISION_PROVIDER
from app.model_override import MODEL_OVERRIDE
from app.processors.images import upright_jpeg

# Bump whenever the prompt wording changes, so a saved proposal names the prompt it came from.
PROMPT_VERSION = "cp10-v1"


# The model for this request: the admin's choice (S-01, X-Model header), else VISION_MODEL.
def _model() -> str:
    return MODEL_OVERRIDE.get() or VISION_MODEL


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


class DescriptionAnswer(BaseModel):
    description: str
    hazard_type: Literal[HAZARD_TYPES]


ITEMS = """Each item has a name, such as "Note", "Recording 1", "Page 2" or "Photo 1". Recordings \
and pages are machine transcripts and can contain misheard or misread words."""

DESCRIPTION_INTRO = f"""You look at the photographs a Marsh property risk engineer took of one \
finding during a site survey, and propose a description of them for the engineer to review. \
{ITEMS}"""

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


# Only when the engineer marked an area of a photo (CP-10), so an unmarked reading's prompt stays
# as it was. The close-up is a separate image, not a box drawn on the photo, so the model never
# mistakes the mark for paint or tape.
MARKED_RULE = """

Where the engineer marked an area of a photograph, '<photo name>, marked area' is a close-up of \
that area from the same photograph, sent after it. Describe the condition in the marked area; use \
the full photograph only for context such as location. Cite the close-up by its photograph's \
name, never as an item of its own."""


# With protection on, names and contact details reach the model as placeholders (PV-04). The
# rule is there with protection off too, so off and on differ only in masking (as in rag-service).
PLACEHOLDER_RULE = """

Copy bracketed placeholders such as [PERSON_1] or [CLIENT_1] exactly as written, brackets \
included, in descriptions, reasons and quotes. They stand for names and contact details; never \
invent, alter, explain or merge them."""


def system_instruction(marked: bool = False) -> str:
    """The rules for describing the photos. `marked` when a photo has a marked area (CP-10)."""
    return (
        DESCRIPTION_INTRO + PHOTOS_INSTRUCTION + (MARKED_RULE if marked else "") + PLACEHOLDER_RULE
    )


def _read(s3, key: str) -> bytes:
    try:
        return s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()
    except Exception as error:
        # The gateway maps these message prefixes to user-facing reasons
        # (server/src/services/observation.service.ts); keep them in sync.
        raise InterpretationError(f"The photo could not be read from storage: {error}") from error


def _prepare(image: bytes, region: dict | None = None) -> str:
    """The photo, or its marked area, upright and shrunk (see `upright_jpeg`), as base64."""
    try:
        jpeg = upright_jpeg(image, region)
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
    images: list[tuple[str, str]], prompt: str, marked: bool = False
) -> tuple[DescriptionAnswer, str, dict | None]:
    answer_type = DescriptionAnswer
    try:
        # Held open for the whole call: the client closes its connection when it is
        # discarded, so `genai.Client(...).interactions.create(...)` fails with "the
        # client has been closed" before the request is sent.
        with genai.Client(api_key=GEMINI_API_KEY) as client:
            result = client.interactions.create(
                model=_model(),
                system_instruction=system_instruction(marked),
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
    return answer, result.model or _model(), tokens


_PROVIDERS = {"gemini": _interpret_gemini}


def _check(answer: DescriptionAnswer, session: protection.Session) -> None:
    """The description with each detail Gemini added taken out, while still masked so only those
    are found (PV-04)."""
    [answer.description] = session.check_answer([answer.description])


def interpret(
    photos: list[dict],
    texts: list[dict],
    location: str | None,
    privacy: dict | None = None,
) -> dict:
    """The description of an observation's photos: photos as {label, s3_key, region}, texts as
    {label, kind, text} (a hint only). `privacy` is the gateway's `{enabled, known_entities}`
    (PV-04), or None."""
    s3 = boto3.client("s3", region_name=AWS_REGION) if photos else None
    return interpret_images(
        [(p["label"], _read(s3, p["s3_key"])) for p in photos],
        texts,
        location,
        privacy,
        regions={p["label"]: p["region"] for p in photos if p.get("region")},
    )


def interpret_images(
    photos: list[tuple[str, bytes]],
    texts: list[dict],
    location: str | None,
    privacy: dict | None = None,
    regions: dict[str, dict] | None = None,
) -> dict:
    """The description for photos already in hand; interpret() and the eval both use it.
    `regions` are the areas the engineer marked (CP-10), by photo label: each goes as a close-up
    after its photo."""
    try:
        provider = _PROVIDERS[VISION_PROVIDER]
    except KeyError:
        raise NotImplementedError(f"VISION_PROVIDER {VISION_PROVIDER!r} is not supported") from None
    regions = regions or {}
    images = []
    for label, photo in photos:
        images.append((label, _prepare(photo)))
        if label in regions:
            images.append((f"{label}, marked area", _prepare(photo, regions[label])))
    if sum(len(data) for _, data in images) > MAX_INLINE_CHARS:
        raise InterpretationError(
            "There are too many photos to interpret together. Save fewer photos per observation."
        )
    session = protection.session(privacy)
    # Faces blurred in every photo and close-up, in one call; the original in S3 is never
    # changed.
    blurred = session.redact_images([data for _, data in images])
    images = [(label, data) for (label, _), data in zip(images, blurred, strict=True)]
    # The texts and the location in one /mask call, so one mapping covers them (Rule 2).
    *masked, masked_location = session.mask([t["text"] for t in texts] + [location or ""])
    texts = [{**t, "text": text} for t, text in zip(texts, masked, strict=True)]
    location = masked_location or None
    # The close-ups are part of their photos, not items the answer can cite.
    prompt = _prompt([label for label, _ in photos], texts, location)
    answer, model, usage = provider(images, prompt, bool(regions))
    _check(answer, session)
    result = {
        # Real values back before the gateway saves it.
        "description": session.unmask(answer.description),
        "hazard_type": answer.hazard_type,
        "provider": VISION_PROVIDER,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        # None when the provider reports no usage (EV-03 AC7).
        "usage": usage,
        "privacy": session.provenance(),
    }
    if session.enabled:
        # Each photo as Gemini received it, so the engineer can see what left (PV-04). S5
        # stores nothing: the gateway keeps the ones with a face blurred.
        result["redacted_photos"] = [
            {"label": label, "faces": faces, "image": data}
            for (label, data), faces in zip(images, session.faces, strict=True)
        ]
    return result


# A plain photo description for matching photos to findings (CP-22). Sent with only the photo.
DESCRIBE_INSTRUCTION = """You look at one photograph a Marsh property risk engineer took on a \
site walk. Describe in one or two plain sentences what it shows, so it can be matched to a \
finding. Use Singapore English. State only what is visible: no recommendations, no guesses."""


class PhotoDescription(BaseModel):
    description: str


# A photo a risk engineer attaches to a chat question (CB-08). Only the photo is sent, never the
# question, so no client words reach Gemini. `unclear` is what could not be made out.
CHAT_DESCRIBE_INSTRUCTION = """You look at one photograph a Marsh property risk engineer \
attached to a question about fire-protection standards. Describe what it shows in a few plain \
sentences: the equipment, its condition, what is visible and any readable labels or markings. \
Use Singapore English. State only what is visible: no recommendations, no guesses. List in \
`unclear` anything you could not make out (blurred, dark, hidden or too small); leave it empty \
when everything is clear. Do not guess what is unclear."""


class ChatPhotoAnswer(BaseModel):
    description: str
    unclear: str = ""


def _describe_gemini(
    image: str, instruction: str = DESCRIBE_INSTRUCTION, schema: type[BaseModel] = PhotoDescription
) -> tuple[BaseModel, dict]:
    started = time.perf_counter()
    try:
        with genai.Client(api_key=GEMINI_API_KEY) as client:
            result = client.interactions.create(
                model=_model(),
                system_instruction=instruction,
                input=[
                    {"type": "image", "data": image, "mime_type": "image/jpeg"},
                    {"type": "text", "text": "Describe this photo."},
                ],
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": schema.model_json_schema(),
                },
                # A client's site photo: Google need not keep the request.
                store=False,
            )
    except Exception as error:
        raise InterpretationError(f"The photo could not be described: {error}") from error
    duration_ms = round((time.perf_counter() - started) * 1000)
    if result.status != "completed" or not result.output_text:
        raise InterpretationError(
            f"The photo could not be described: no answer came back (status {result.status})."
        )
    try:
        answer = schema.model_validate_json(result.output_text)
    except ValidationError as error:
        raise InterpretationError(
            "The photo could not be described: the answer was not in the expected form."
        ) from error
    tokens = result.usage
    input_tokens = getattr(tokens, "total_input_tokens", None)
    output = getattr(tokens, "total_output_tokens", None)
    thought = getattr(tokens, "total_thought_tokens", None)
    usage = {
        "feature": "describe_photo",
        "billed_service": "gemini-vision",
        "model": result.model or _model(),
        "duration_ms": duration_ms,
        "input_tokens": input_tokens,
        # Google bills thinking as output, so it is added in.
        "output_tokens": None if output is None else output + (thought or 0),
        "cache_read_tokens": None,
        "search_units": None,
        "audio_seconds": None,
        "usage_status": "recorded" if input_tokens is not None else "unavailable",
    }
    return answer, usage


_DESCRIBERS = {"gemini": _describe_gemini}


def describe_photo(s3_key: str, privacy: dict | None = None) -> dict:
    """{description, usage, privacy} for one stored photo, by the VISION_PROVIDER. With `privacy`
    on, faces are blurred before the model sees it and, with `check_answers`, details it read off
    the photo are taken out of the description, as in photo reading (PV-08)."""
    describer = _DESCRIBERS.get(VISION_PROVIDER)
    if describer is None:
        raise InterpretationError(
            f"The photo could not be described: VISION_PROVIDER {VISION_PROVIDER!r} "
            "is not supported."
        )
    image = _prepare(_read(boto3.client("s3", region_name=AWS_REGION), s3_key))
    session = protection.session(privacy)
    [image] = session.redact_images([image])
    answer, usage = describer(image)
    # Only the photo was sent, so whatever the check finds was read off it.
    [description] = session.check_answer([answer.description])
    return {"description": description, "usage": [usage], "privacy": session.provenance()}


def describe_chat_photo(s3_key: str) -> dict:
    """{description, unclear, usage} for a photo attached to a chat question (CB-08)."""
    describer = _DESCRIBERS.get(VISION_PROVIDER)
    if describer is None:
        raise InterpretationError(
            f"The photo could not be described: VISION_PROVIDER {VISION_PROVIDER!r} "
            "is not supported."
        )
    image = _prepare(_read(boto3.client("s3", region_name=AWS_REGION), s3_key))
    answer, usage = describer(image, CHAT_DESCRIBE_INSTRUCTION, ChatPhotoAnswer)
    return {"description": answer.description, "unclear": answer.unclear, "usage": [usage]}

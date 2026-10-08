"""Photo interpreter (CP-05). Stateless — reads an observation's photos from S3, returns a proposal.

The proposal is for the engineer to review: a description of what the photos show, a COPE
category and a hazard type. It is never report evidence by itself; the engineer takes it into
the observation's note or category if they agree with it.
"""

import base64
import io
from typing import Literal

import boto3
from google import genai
from PIL import Image, ImageOps
from pydantic import BaseModel, ValidationError

from app.config import AWS_REGION, GEMINI_API_KEY, S3_BUCKET, VISION_MODEL, VISION_PROVIDER

# Bump whenever the prompt wording changes, so a saved proposal names the prompt it came from.
PROMPT_VERSION = "cp05-v1"

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

# A photo is shrunk to this long edge before it is sent. The original in S3 is never changed.
LONG_EDGE = 1600
# Gemini caps a request with inline images at 20 MB, base64 included; this leaves room for text.
MAX_INLINE_CHARS = 18_000_000


class InterpretationError(Exception):
    """The reason the photos could not be interpreted, shown to the engineer."""


class Interpretation(BaseModel):
    description: str
    cope_dimension: Literal["Construction", "Occupancy", "Protection", "Exposure"]
    hazard_type: Literal[HAZARD_TYPES]


SYSTEM_INSTRUCTION = f"""You look at the photographs a Marsh property risk engineer took of one \
finding during a site survey, and propose an observation for the engineer to review.

description: one or two sentences in the form Marsh's reports use, for example "During the site \
visit to the L43 hosereel pump room, it was observed that the valves were not locked open." Name \
the location if you are given it. Use Singapore English. State only what the photographs show: no \
recommendations, and nothing about what the condition may lead to.

Describe only what is visible. If a detail cannot be made out, leave it out rather than guess. \
If the photographs show nothing wrong, say what they show and set hazard_type to \
"No hazard visible". Never invent a hazard.

The engineer's note, if given, says what they photographed. Use it to know what to look at, but \
describe what the photographs show, not what the note claims.

cope_dimension: the COPE category the photographs concern.
- Construction: the building fabric: structure, walls, roofs, fire compartments, fire stopping of \
penetrations, combustible construction.
- Occupancy: how the site is used: processes, storage, housekeeping, utilities, back-up power.
- Protection: fire protection and security: sprinklers, alarms, extinguishers, hose reels, fire \
doors, pumps, and their maintenance.
- Exposure: hazards from outside the site: neighbouring properties, flood, wind and other natural \
hazards.

hazard_type: the closest of {", ".join(HAZARD_TYPES[:-2])}; "Other" if none fits; or \
"No hazard visible"."""


def _read(s3, key: str) -> bytes:
    try:
        return s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read()
    except Exception as error:
        # The gateway maps these message prefixes to user-facing reasons
        # (server/src/services/observation.service.ts); keep them in sync.
        raise InterpretationError(f"The photo could not be read from storage: {error}") from error


def _prepare(image: bytes) -> str:
    """The photo upright, at most LONG_EDGE pixels, as a base64 JPEG.

    Phones store a portrait photo's turn in its EXIF data, which the model never reads, so it
    would otherwise see the photo on its side.
    """
    try:
        with Image.open(io.BytesIO(image)) as photo:
            upright = ImageOps.exif_transpose(photo)
            upright.thumbnail((LONG_EDGE, LONG_EDGE))
            out = io.BytesIO()
            upright.convert("RGB").save(out, "JPEG", quality=85)
    except Exception as error:
        raise InterpretationError(f"The photo could not be opened: {error}") from error
    return base64.b64encode(out.getvalue()).decode("ascii")


def _prompt(count: int, location: str | None, note: str | None) -> str:
    lines = [f"{count} photograph{'s' if count != 1 else ''} of one finding."]
    if location:
        lines.append(f"Location: {location}")
    if note:
        lines.append(f"Engineer's note: {note}")
    return "\n".join(lines)


def _interpret_gemini(images: list[str], prompt: str) -> tuple[Interpretation, str, dict | None]:
    try:
        # Held open for the whole call: the client closes its connection when it is
        # discarded, so `genai.Client(...).interactions.create(...)` fails with "the
        # client has been closed" before the request is sent.
        with genai.Client(api_key=GEMINI_API_KEY) as client:
            result = client.interactions.create(
                model=VISION_MODEL,
                system_instruction=SYSTEM_INSTRUCTION,
                # Images before the text that asks about them.
                input=[
                    *(
                        {"type": "image", "data": data, "mime_type": "image/jpeg"}
                        for data in images
                    ),
                    {"type": "text", "text": prompt},
                ],
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": Interpretation.model_json_schema(),
                },
                # Client site photos: Google need not keep the request for later retrieval.
                store=False,
            )
    except Exception as error:
        raise InterpretationError(f"The photos could not be interpreted: {error}") from error
    # A safety block or a cut-off answer comes back without usable text.
    if result.status != "completed" or not result.output_text:
        raise InterpretationError(
            f"The photos could not be interpreted: no answer came back (status {result.status})."
        )
    try:
        answer = Interpretation.model_validate_json(result.output_text)
    except ValidationError as error:
        raise InterpretationError(
            "The photos could not be interpreted: the answer was not in the expected form."
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


def interpret(s3_keys: list[str], location: str | None, note: str | None) -> dict:
    s3 = boto3.client("s3", region_name=AWS_REGION)
    return interpret_images([_read(s3, key) for key in s3_keys], location, note)


def interpret_images(photos: list[bytes], location: str | None, note: str | None) -> dict:
    """The proposal for photos already in hand; interpret() and the eval both use it."""
    try:
        provider = _PROVIDERS[VISION_PROVIDER]
    except KeyError:
        raise NotImplementedError(f"VISION_PROVIDER {VISION_PROVIDER!r} is not supported") from None
    images = [_prepare(photo) for photo in photos]
    if sum(len(data) for data in images) > MAX_INLINE_CHARS:
        raise InterpretationError(
            "There are too many photos to interpret together. Save fewer photos per observation."
        )
    answer, model, usage = provider(images, _prompt(len(images), location, note))
    return {
        **answer.model_dump(),
        "provider": VISION_PROVIDER,
        "model": model,
        "prompt_version": PROMPT_VERSION,
        # None when the provider reports no usage (EV-03 AC7).
        "usage": usage,
    }

"""Suggest which kinds a site-walk observation holds: fact, info request, recommendation (CP-36).

Called by routes.py's /suggest-kinds (asked by the gateway). Calls privacy.py (mask) and
llm.complete under LLM_PROVIDER. The text is never rewritten and nothing is saved.
"""

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app import privacy as pii
from app.generation.llm import complete

# Must match AI_FEATURES in server/src/models/ai-call.model.ts.
FEATURE = "suggest-kinds"
PROMPT_VERSION = "cp36-v1"

Kind = Literal["fact", "info_request", "recommendation"]
_ORDER = ["fact", "info_request", "recommendation"]


class KindResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kinds: list[Kind]


SYSTEM = """You tag a risk engineer's site-walk observation for a commercial property survey \
in Singapore. Say which of these kinds the text contains:
- fact: something observed.
- info_request: something to ask for or obtain (a report, a document, an answer).
- recommendation: advice on what should be done.

A text can have more than one kind: "fire pump is 20 years old, replace it" is a fact and a \
recommendation. If it is unclear, answer ["fact"]. Never invent anything."""


def suggest_kinds(text: str, privacy=None) -> dict:
    """Return `{kinds, usage, provenance}`; kinds is a non-empty list in fixed order. Raises
    PrivacyUnavailable if masking fails."""
    paid_calls = usage.start()
    protection = pii.session(privacy)

    # a. Mask first; fail closed. No unmask later: the answer has no free text.
    masked = protection.mask([text])[0]
    result, model = complete(
        SYSTEM,
        masked,
        KindResult,
        config.SUGGEST_KINDS_EFFORT,
        feature=FEATURE,
        model=config.SUGGEST_KINDS_MODEL,
    )

    # b. De-duplicate, fixed order; an empty answer means fact.
    kinds = [k for k in _ORDER if k in result.kinds] or ["fact"]
    return {
        "kinds": kinds,
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.SUGGEST_KINDS_EFFORT,
            "prompt_version": PROMPT_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
            "privacy": protection.provenance(),
        },
    }

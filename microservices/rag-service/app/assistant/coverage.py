"""MarshBot's coverage check (AS-06): which checklist items no observation covers, and which
observations are too thin for their report section. Nothing is saved here.

Called by routes.py's /assistant/coverage. Calls privacy.py (mask) and llm.complete under
LLM_PROVIDER.
"""

from datetime import UTC, datetime

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app import privacy as pii
from app.assistant.prompts import COVERAGE_PROMPT_VERSION, COVERAGE_SYSTEM
from app.generation.llm import complete
from app.orchestrator.orchestrator import _mask_evidence

# Must match AI_FEATURES in server/src/models/ai-call.model.ts.
FEATURE = "assistant-coverage"
GENERIC_REASON = "Too short or vague to support a statement in this section."


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns.
class ThinFlag(_Model):
    observation_id: str
    section_id: str
    reason: str


class CoverageResult(_Model):
    uncovered: list[str]
    thin: list[ThinFlag]


def _sections_of(observation, sections) -> list:
    """The sections an observation is filed under: any whose categories it shares."""
    return [s for s in sections if set(s.cope_dimensions) & set(observation.COPE_dimension)]


def _user_prompt(items, observations, sections) -> str:
    """The checklist and the observations (already masked), one line each."""
    checklist = "\n".join(f"- {i.id} [{i.area}] {i.text}" for i in items)
    titles = {s.section_id: s.title for s in sections}
    lines = []
    for o in observations:
        filed = ", ".join(
            f"{s.section_id} {titles[s.section_id]}" for s in _sections_of(o, sections)
        )
        where = " | ".join(v for v in (o.location, o.standard) if v)
        lines.append(f"- {o.id} (sections: {filed or 'none'}) {where}\n  " + " ".join(o.recorded()))
    return f"Checklist items:\n{checklist}\n\nObservations:\n" + ("\n".join(lines) or "(none)")


def check_coverage(request, privacy=None) -> dict:
    """Return `{uncovered, thin, usage, provenance}` for the checklist and observations."""
    paid_calls = usage.start()
    protection = pii.session(privacy)
    provenance = {
        "provider": config.LLM_PROVIDER,
        "model": None,
        "effort": config.ASSISTANT_COVERAGE_EFFORT,
        "prompt_version": COVERAGE_PROMPT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    items, observations = request.checklist, request.observations
    ids = [i.id for i in items]

    # a. Nothing to compare: no call. With no observations every item is uncovered.
    if not items or not observations:
        done = {"uncovered": ids, "thin": []}
        return {
            **done,
            "usage": paid_calls,
            "provenance": {**provenance, "privacy": protection.provenance()},
        }

    # b. Mask the items' text and the observations' text in one /mask call (one mapping).
    masked, masked_texts = _mask_evidence(protection, observations, [i.text for i in items])
    masked_items = [
        i.model_copy(update={"text": t}) for i, t in zip(items, masked_texts, strict=True)
    ]

    # c. Ask the model.
    result, model = complete(
        COVERAGE_SYSTEM,
        _user_prompt(masked_items, masked, request.sections),
        CoverageResult,
        config.ASSISTANT_COVERAGE_EFFORT,
        feature=FEATURE,
        model=config.ASSISTANT_COVERAGE_MODEL,
    )

    # d. Finish in code. Without this, an id the model made up would reach the brief. An
    # observation is only thin for a section it is filed under.
    uncovered = [i for i in dict.fromkeys(result.uncovered) if i in set(ids)]
    filed = {o.id: {s.section_id for s in _sections_of(o, request.sections)} for o in observations}
    thin, seen = [], set()
    for flag in result.thin:
        # The prompt shows a section as "7 Construction"; without this, a model that copies the
        # whole label ("7 Construction" for "7") would have every thin flag dropped.
        section = (flag.section_id.split() or [""])[0]
        key = (flag.observation_id, section)
        if key in seen or section not in filed.get(flag.observation_id, set()):
            continue
        seen.add(key)
        reason, unknown = protection.unmask(flag.reason.strip())
        thin.append(
            {
                "observation_id": flag.observation_id,
                "section_id": section,
                # A placeholder that can't be restored would show on screen as a code.
                "reason": GENERIC_REASON if unknown or not reason else reason,
            }
        )
    return {
        "uncovered": uncovered,
        "thin": thin,
        "usage": paid_calls,
        "provenance": {**provenance, "model": model, "privacy": protection.provenance()},
    }

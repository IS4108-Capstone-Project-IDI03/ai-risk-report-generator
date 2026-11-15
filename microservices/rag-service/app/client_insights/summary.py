"""The written summary on a client's Insights tab (CP-29): the figures the gateway counted
and the engineer's own observations in; a few cited statements out. Nothing is saved here.

Called by routes.py's /client-insights/summary. Calls privacy.py (mask, fail closed) and
llm.complete under LLM_PROVIDER. Every statement is checked in code before it is returned:
it must cite a source it was given, state findings (ask.content_problem, the Ask tab's
rules), hold no placeholder that could not be restored, and use no number its sources lack.
"""

import re

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app.generation.ask import content_problem, strip_emoji
from app.generation.generator import PLACEHOLDER_RULE
from app.generation.llm import GenerationFailed, complete
from app.privacy import session as privacy_session

# Must match the ai_calls feature list in server/src/models/ai-call.model.ts.
FEATURE = "client-insights"
PROMPT_VERSION = "cp29-v1"
# The most statements shown: a summary, not a report.
MAX_STATEMENTS = 5

NOTHING_CHECKED = (
    "The summary could not be checked against its sources, so nothing is shown. Write it again."
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns.
class Statement(_Model):
    text: str
    sources: list[str]


class Summary(_Model):
    statements: list[Statement]
    missing: str | None


SYSTEM = f"""You write a short summary of one client's property risk picture for a Marsh \
property risk engineer. You are given figures counted from the engineer's own site \
observations (labelled F1, F2, ...) and the observations themselves (labelled O1, O2, ...), \
across the client's sites.

Write 3 to {MAX_STATEMENTS} statements, the most important first. Each is one or two \
sentences. Prefer, in this order: the kind of finding that dominates across the client; the \
site with the most severe findings and what they are; the same finding recorded at more than \
one site; and how a site changed between visits.

Rules:
- Every statement lists `sources`: the labels of the figures and observations it rests on, \
e.g. ["F1", "O3"]. Use only what those sources say. Never add general knowledge, a standard's \
requirement, or anything the sources do not state.
- A number in a statement must be a number one of its sources gives. Never add, subtract or \
average numbers yourself.
- State what was found. Never give advice or a recommendation, and never say what anyone \
should, must or needs to do. Never write "I" or "we". Never give a confidence, a probability \
or a percentage of certainty.
- Name each site by its name as given.
- {PLACEHOLDER_RULE}
- Plain sentences: no headings, lists, markdown or emoji.

missing: one sentence naming something the summary would need that the sources do not cover \
(for example a site with no rating), or null when nothing is missing."""

_NUMBER = re.compile(r"\d+(?:\.\d+)?")


def _numbers(text: str) -> set[str]:
    """The numbers written in `text`, as written ("48.6", "7"), thousands commas removed."""
    return set(_NUMBER.findall(text.replace(",", "")))


# A source as the model reads it, without its label: the label's own digit ("F3") must not
# count as a number the source gives.
def _observation_body(o) -> str:
    where = ", ".join(x for x in (o.location, o.site) if x)
    filed = ", ".join(o.categories) or "uncategorised"
    when = f", {o.date}" if o.date else ""
    return f"({where}; {o.severity}; {filed}{when}): {o.text}"


def _figure_body(f) -> str:
    return f"{f.title}:\n" + "\n".join(f"- {line}" for line in f.lines)


def _check(text: str, cited: list[str], blocks: dict[str, str]) -> tuple[list[str], str | None]:
    """The labels a statement may keep, and why it is not shown (None when it is).

    `blocks` maps each label the model was given to its text with real names back."""
    labels = list(dict.fromkeys(label.strip().upper() for label in cited))
    known = [label for label in labels if label in blocks]
    if not text:
        return known, "empty"
    if not known:
        return known, "uncited"
    problem = content_problem(text)
    if problem:
        return known, problem
    # A number its sources don't give is one the model worked out or made up.
    given = set().union(*(_numbers(blocks[label]) for label in known))
    if _numbers(text) - given:
        return known, "number"
    return known, None


def summarise_client(client: str, figures, observations, privacy) -> dict:
    """Return {statements, missing, confidence, dropped, provenance, usage} for the gateway.

    Raises PrivacyUnavailable when masking fails (nothing is sent), and GenerationFailed
    when the model fails or no statement passes its checks."""
    paid_calls = usage.start()
    masking = privacy_session(privacy)
    # 1. Mask everything that can name the client, a site or a person, in one call, before
    # the model sees any of it. Masking fails closed (raises).
    figure_bodies = [_figure_body(f) for f in figures]
    observation_bodies = [_observation_body(o) for o in observations]
    masked = masking.mask([client, *figure_bodies, *observation_bodies])
    masked_figures = masked[1 : 1 + len(figures)]
    masked_observations = masked[1 + len(figures) :]
    user = (
        f"Client: {masked[0]}\n\nFigures:\n\n"
        + "\n\n".join(f"{f.label} {body}" for f, body in zip(figures, masked_figures))
        + "\n\nObservations:\n\n"
        + "\n".join(f"{o.label} {body}" for o, body in zip(observations, masked_observations))
    )
    # 2. One call, under LLM_PROVIDER.
    answer, model = complete(
        SYSTEM,
        user,
        Summary,
        config.INSIGHTS_EFFORT,
        feature=FEATURE,
        model=config.INSIGHTS_MODEL,
    )
    # 3. Real names back, then every check, against the sources as the engineer wrote them.
    blocks = {f.label: body for f, body in zip(figures, figure_bodies)}
    blocks |= {o.label: body for o, body in zip(observations, observation_bodies)}
    statements, dropped = [], []
    for statement in answer.statements:
        text, unknown = masking.unmask(strip_emoji(statement.text))
        labels, problem = _check(text.strip(), statement.sources, blocks)
        if unknown:
            problem = "placeholder"
        if problem:
            dropped.append(problem)
        elif len(statements) < MAX_STATEMENTS:
            statements.append({"text": text.strip(), "citations": labels})
    if not statements:
        raise GenerationFailed(NOTHING_CHECKED)
    missing, unknown = masking.unmask(strip_emoji(answer.missing or ""))
    # A missing line that breaks the same rules is left out, not shown.
    if unknown or content_problem(missing):
        missing = ""
    return {
        "statements": statements,
        "missing": missing.strip() or None,
        "confidence": _confidence(statements, len(dropped), missing.strip()),
        "dropped": len(dropped),
        "dropped_reasons": dropped,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.INSIGHTS_EFFORT,
            "prompt_version": PROMPT_VERSION,
            "privacy": masking.provenance(),
        },
        "usage": paid_calls,
    }


def _confidence(statements: list[dict], dropped: int, missing: str) -> str:
    """High, Medium or Low, worked out from the checks, never asked of the model.

    Low: a statement was left out. Medium: something is missing, or no statement rests on an
    observation (figures only). High otherwise."""
    if dropped:
        return "low"
    on_observation = any(label.startswith("O") for s in statements for label in s["citations"])
    if missing or not on_observation:
        return "medium"
    return "high"

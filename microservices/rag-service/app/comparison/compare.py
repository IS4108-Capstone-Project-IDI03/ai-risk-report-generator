"""Comparing an assessment with the previous report for the same site (RV-13): the previous
finalised report's findings and recommendations, and the current assessment's observations,
draft findings and draft recommendations in; one suggested outcome per previous item out.
Nothing is saved here, and nothing here reaches a report.

Called by routes.py's /comparison/compare. Calls privacy.py (mask, fail closed) and
llm.complete under LLM_PROVIDER. What comes back is only tidied and checked here: labels the
model was not given are dropped, an item it left out or gave twice is answered once, and a
reason or a missing line that breaks the content rules (ask.content_problem), names one of
the labels, or holds a placeholder that could not be restored is left out. The rules that
decide an outcome (silence is never a fix, a severity change is Worse or Improved, sources
that disagree leave it to the engineer) and every figure's difference are worked out by the
gateway (report-comparison-rules.ts), never asked of the model.
"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app.generation.ask import content_problem, strip_emoji
from app.generation.generator import PLACEHOLDER_RULE
from app.generation.llm import complete
from app.privacy import session as privacy_session

# Must match the ai_calls feature list in server/src/models/ai-call.model.ts.
FEATURE = "report-comparison"
PROMPT_VERSION = "rv13-v2"
# Previous items per model call: every call is given all the current evidence, so a long
# report is compared in parts and each answer stays short enough to finish.
BATCH = 40

OUTCOMES = ("fixed", "improved", "unchanged", "worse", "not_checked")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns.
class Figure(_Model):
    name: str
    previous: str
    current: str
    source: str


class ItemOutcome(_Model):
    previous: str
    outcome: Literal["fixed", "improved", "unchanged", "worse", "not_checked"]
    sources: list[str]
    match: Literal["clear", "partial"]
    disagree: list[str]
    possible: list[str]
    reason: str | None
    missing: str | None
    figures: list[Figure]


class Comparison(_Model):
    items: list[ItemOutcome]


SYSTEM = f"""You compare a Marsh property risk survey report with what was found on the next \
survey of the same site, for the property risk engineer who did that survey. You are given \
the previous report's findings and recommendations (labelled P1, P2, ...) and the current \
assessment's evidence: the engineer's observations (O1, O2, ...), draft findings (F1, F2, ...) \
and draft recommendations (R1, R2, ...). Each comes with its section, and where known its \
severity or priority, COPE categories and location.

Return exactly one entry for every previous item you are given, with `previous` set to its \
label:
- outcome: `fixed` when current evidence shows the condition was put right; `improved` when it \
was partly put right or is less serious; `unchanged` when current evidence shows the same \
condition; `worse` when it is more serious or more widespread; `not_checked` when no current \
evidence says what the condition is now.
- sources: the labels of the current evidence that says what the condition is now. Required \
for every outcome except not_checked. Never `fixed` or `unchanged` because nothing current \
mentions the item: silence is `not_checked`, with sources empty.
- match: `clear` when the sources plainly concern the same condition at the same place; \
`partial` when they cover only part of it.
- disagree: when two or more current sources say different things about the item (one shows \
it put right, another shows it still there), list every one of them here, and in sources too; \
otherwise empty.
- possible: current labels that may concern the same thing but don't clearly match. Never \
pair on a guess: such evidence goes here, not in sources.
- reason: one sentence stating what the current evidence shows against the previous words, \
or null for not_checked.
- missing: for not_checked, one sentence naming the evidence that would show what the \
condition is now (for example "No observation records the fire pump's weekly test log."); \
otherwise null.
- figures: each measurement written both in the previous item and in one of its sources (a \
pressure, a distance, a duration, a count, an amount). Give `name` (what it measures), \
`previous` and `current` copied exactly as written, number and unit together (e.g. "4.5 bar"), \
and `source`, the current label it is written in. Never work out a difference, and never \
convert a unit.

Rules for reason and missing: state facts only. Never give advice or a recommendation, and \
never say what anyone should, must or needs to do. Never write "I" or "we". Never give a \
confidence, a probability or a percentage of certainty. Never name a label (P1, O2, F1, \
R1): the engineer never sees them, so describe the evidence in words ("the afternoon \
observation in the valve room"). Plain sentences: no lists, markdown or emoji.
{PLACEHOLDER_RULE}"""


def _detail(i) -> str:
    """An item's labels as the model reads them, without its own label."""
    parts = [f"{i.kind}, {i.section}"]
    if getattr(i, "title", None):
        parts.append(i.title)
    if i.location:
        parts.append(i.location)
    if i.severity:
        parts.append(f"severity {i.severity}")
    if i.priority:
        parts.append(i.priority)
    if i.categories:
        parts.append(", ".join(i.categories))
    return "; ".join(parts)


def _labels(cited: list[str], known: set[str]) -> list[str]:
    """The cited labels the model was given, upper-cased, each once, in order."""
    found = (label.strip().upper() for label in cited)
    return [label for label in dict.fromkeys(found) if label in known]


# One of the labels the model is given (P1, O12, F3, R2). The engineer never sees them, so a
# line naming one would read as nonsense ("in O8") on the Comparison tab.
_LABEL = re.compile(r"\b[POFR]\d+\b")


def _sentence(masking, text: str | None, dropped: list[str]) -> str | None:
    """A reason or missing line with real names back, or None when it breaks the rules."""
    if not text or not text.strip():
        return None
    restored, unknown = masking.unmask(strip_emoji(text))
    restored = restored.strip()
    problem = (
        "placeholder"
        if unknown
        else content_problem(restored) or ("label" if _LABEL.search(restored) else None)
    )
    if problem:
        dropped.append(problem)
        return None
    return restored or None


def _value(masking, text: str) -> str | None:
    """A figure's value with real names back; None when it held a placeholder it can't restore."""
    restored, unknown = masking.unmask(text)
    return None if unknown else restored.strip()


def _settle(answer: Comparison, labels: list[str], current: set[str], masking, dropped):
    """One tidied entry per previous label, in the order they were given."""
    entries: dict[str, ItemOutcome] = {}
    for item in answer.items:
        label = item.previous.strip().upper()
        if label in labels and label not in entries:
            entries[label] = item
        else:
            dropped.append("unknown_item" if label not in labels else "repeated_item")
    settled = []
    for label in labels:
        item = entries.get(label)
        if not item:
            # Left out by the model: not checked, and the gateway says the comparison gave it
            # nothing, rather than guessing.
            dropped.append("omitted")
            settled.append(
                {
                    "previous": label,
                    "outcome": "not_checked",
                    "sources": [],
                    "match": "partial",
                    "disagree": [],
                    "possible": [],
                    "reason": None,
                    "missing": None,
                    "figures": [],
                    "omitted": True,
                }
            )
            continue
        sources = _labels(item.sources, current)
        disagree = _labels(item.disagree, current)
        # Sources that disagree are sources too: both are shown beside the item.
        sources += [label for label in disagree if label not in sources]
        possible = [x for x in _labels(item.possible, current) if x not in sources]
        figures = []
        for f in item.figures:
            source = f.source.strip().upper()
            previous, now = _value(masking, f.previous), _value(masking, f.current)
            if source in sources and previous and now:
                name, _ = masking.unmask(f.name)
                figures.append(
                    {"name": name.strip(), "previous": previous, "current": now, "source": source}
                )
            else:
                dropped.append("figure")
        settled.append(
            {
                "previous": label,
                "outcome": item.outcome,
                "sources": sources,
                "match": item.match,
                "disagree": disagree if len(disagree) > 1 else [],
                "possible": possible,
                "reason": _sentence(masking, item.reason, dropped),
                "missing": _sentence(masking, item.missing, dropped),
                "figures": figures,
                "omitted": False,
            }
        )
    return settled


def compare_reports(previous, current, privacy) -> dict:
    """Return {items, dropped, dropped_reasons, provenance, usage} for the gateway.

    `previous` and `current` are the request's items, each with its label. Raises
    PrivacyUnavailable when masking fails (nothing is sent), and GenerationFailed when the
    model fails."""
    paid_calls = usage.start()
    masking = privacy_session(privacy)
    # 1. Mask every text, heading and place in one call, before the model sees any of it.
    # Masking fails closed (raises).
    bodies = [f"({_detail(i)}): {i.text}" for i in [*previous, *current]]
    masked = masking.mask(bodies)
    previous_lines = [f"{i.label} {m}" for i, m in zip(previous, masked[: len(previous)])]
    current_lines = [f"{i.label} {m}" for i, m in zip(current, masked[len(previous) :])]
    evidence = "Current evidence:\n\n" + "\n".join(current_lines)
    known = {i.label for i in current}
    # 2. One call per part of the previous report, under LLM_PROVIDER, each with all the
    # current evidence.
    items, dropped, model = [], [], config.COMPARISON_MODEL
    for start in range(0, len(previous), BATCH):
        part = previous[start : start + BATCH]
        user = (
            "Previous report:\n\n"
            + "\n".join(previous_lines[start : start + BATCH])
            + "\n\n"
            + evidence
        )
        answer, model = complete(
            SYSTEM,
            user,
            Comparison,
            config.COMPARISON_EFFORT,
            feature=FEATURE,
            model=config.COMPARISON_MODEL,
        )
        # 3. Real names back, and only labels it was given.
        items += _settle(answer, [i.label for i in part], known, masking, dropped)
    return {
        "items": items,
        "dropped": len(dropped),
        "dropped_reasons": dropped,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.COMPARISON_EFFORT,
            "prompt_version": PROMPT_VERSION,
            "privacy": masking.provenance(),
        },
        "usage": paid_calls,
    }

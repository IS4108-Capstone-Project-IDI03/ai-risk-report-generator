"""Proposed figures for Sections 4 and 5 (GN-03 addendum, AC12 and AC15).

The model reads the observations and the drafted sections and proposes Section 4's
fourteen scores, or Section 5's per-level % damage and outage, each with a reason and
the sources it rests on. The engineer edits and confirms them in Review; the gateway
uses only confirmed figures (AC10). Called by routes.py's /figures/propose; calls
llm.complete under LLM_PROVIDER. Never proposes money: site values stay the engineer's.
"""

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app.generation.generator import _block, _observation_block
from app.generation.llm import complete

# Bump whenever the prompt or the schemas change.
PROPOSAL_PROMPT_VERSION = "gn03-prop-v3"  # v3: scale anchors (4); estimates expected (5)

# Section 4's categories in template order; must match RQR_CATEGORIES in
# server/src/services/risk-quality.service.ts.
CATEGORIES = [
    "External Exposure",
    "Fire Protection",
    "Occupancy Hazards",
    "Construction",
    "Water Supply",
    "Surveillance",
    "Management Programs",
]
# Section 5's level definitions, as the drafting prompt states them.
# Only those lines: the rest of its instructions forbid writing figures, which made the
# model propose none (click-through, 20 Oct).
_INSTRUCTIONS = json.loads((Path(__file__).parent / "sections.json").read_text(encoding="utf-8"))
_LEVELS = "\n".join(
    line
    for line in _INSTRUCTIONS["sections"]["5"]["instructions"].splitlines()
    if line.startswith("- Level ")
)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# Each proposed figure carries why, and the labels it rests on (O1, S9).
class ScoreProposal(_Model):
    category: str
    current: float | None
    potential: float | None
    reason: str
    citations: list[str]


class ScoresProposal(_Model):
    categories: list[ScoreProposal]


# An area the level's fire damages (e.g. "L27 to L29") and its % damage. No value: the
# engineer gives each area's value.
class DamageProposal(_Model):
    item: str
    percent: float | None
    reason: str
    citations: list[str]


# A business interruption item (from the gateway's list): outage months and % impacted.
class TeProposal(_Model):
    item: str
    months: float | None
    percent: float | None
    reason: str
    citations: list[str]


class LevelProposal(_Model):
    level: Literal["I", "II", "III"]
    damage: list[DamageProposal]
    te: list[TeProposal]


class LossProposal(_Model):
    levels: list[LevelProposal]


_CITE = """Cite the observation (O1) or drafted section (S9) labels each figure rests on, \
and give a one-line reason. A risk engineer reviews and confirms every figure before it \
is used."""

# v3 (eval, 20 Oct): v2 scored 1.5 points below Marsh on average, and lost to "every
# score 8"; Marsh's samples score well-run sites 8-10, and raise the potential only
# where an improvement applies (Mall 2: 7 to 8 for management programs, the rest equal).
_SYSTEM_4 = f"""You propose the risk quality scores for Section 4 of a Marsh Property Risk \
Evaluation report. Score each category from 0 to 10, to one decimal. Categories, in this \
order: {", ".join(CATEGORIES)}.

Marsh's scale for each category: 10, best practice with nothing to improve; 8 to 9, a \
well-run site meeting local code with minor gaps; 6 to 7, notable gaps; 5 or below, \
serious deficiencies such as missing protection the occupancy needs. Most surveyed \
commercial sites score 8 to 9; score lower only for a deficiency the evidence shows.

Current: the site as it is today. Potential: the score once the improvements the \
evidence points to are made. Where no improvement is identified for a category, the \
potential equals the current; it is never below it.

Where the evidence says nothing about a category, return null for it. {_CITE}"""

# v3: a % damage or outage is an estimate by nature, never a stated fact, so v2's "null
# rather than a guess" made the model propose none at all.
_SYSTEM_5 = f"""You propose the loss estimate inputs for Section 5 of a Marsh Property Risk \
Evaluation report, for Levels I, II and III. For each level: the areas the postulated \
fire damages, named briefly by floor or room (e.g. "L27 to L29", "Level 5 server room"; \
say how it is damaged in the reason), with your estimate of the % damage to each; and \
for each business interruption item given, the outage months and the % of the business \
impacted. Never propose a money value: the engineer gives the site values.

These are estimates by nature, as in every Marsh report: judge them from the level's \
definition and the site's construction, compartmentation, protection and occupancy. \
Propose a figure for each area and BI item; leave one null only for a BI item that does \
not apply to the site.

Marsh's levels:
{_LEVELS}

{_CITE}"""


def _clean(value: float | None, low: float, high: float) -> float | None:
    """A figure in range, to one decimal, or None (AC15): the engineer enters it instead."""
    if value is None or not low <= value <= high:
        return None
    # Half up, as the gateway's Math.round (risk-quality.service.ts): Python's round()
    # would give 7.2 for 7.25 where the scores table shows 7.3.
    return math.floor(value * 10 + 0.5) / 10


def _cleaned_scores(answer: ScoresProposal) -> list[dict]:
    """The seven categories in template order, each once: a name in other case is
    matched, a duplicate or unknown one dropped, a skipped one left blank."""
    given: dict[str, ScoreProposal] = {}
    for s in answer.categories:
        given.setdefault(s.category.strip().lower(), s)
    rows = []
    for category in CATEGORIES:
        s = given.get(category.lower())
        if s is None:
            rows.append(
                {
                    "category": category,
                    "current": None,
                    "potential": None,
                    "reason": "",
                    "citations": [],
                }
            )
            continue
        current = _clean(s.current, 0, 10)
        potential = _clean(s.potential, 0, 10)
        # Marsh's potential is the score after the improvements: never below the current.
        if current is not None and potential is not None and potential < current:
            potential = None
        rows.append(
            {**s.model_dump(), "category": category, "current": current, "potential": potential}
        )
    return rows


def _cleaned_levels(answer: LossProposal) -> list[dict]:
    # Months beyond the indemnity period are left to the gateway, which knows it.
    return [
        {
            "level": level.level,
            "damage": [
                {**d.model_dump(), "percent": _clean(d.percent, 0, 100)} for d in level.damage
            ],
            "te": [
                {
                    **t.model_dump(),
                    "months": _clean(t.months, 0, 120),
                    "percent": _clean(t.percent, 0, 100),
                }
                for t in level.te
            ],
        }
        for level in answer.levels
    ]


def propose_figures(section_id, assessment, observations, sections, te_items) -> dict:
    """Return the proposal for Section "4" or "5", its citations mapped to full IDs
    (`O:<id>`, `S:<id>`), the paid calls made, and the provenance."""
    paid_calls = usage.start()
    labels = {f"O{n}": f"O:{o.id}" for n, o in enumerate(observations, 1)}
    labels |= {f"S{s.id}": f"S:{s.id}" for s in sections}
    # 1. The evidence, under the labels the model cites.
    user = "\n\n".join(
        [
            f"Assessment {assessment.reference}: {assessment.facility_type} in "
            f"{assessment.jurisdiction}.",
            _block(
                "observations",
                [_observation_block(f"O{n}", o) for n, o in enumerate(observations, 1)],
            ),
            _block("sections", [f"[S{s.id}] {s.title}\n{s.text}" for s in sections]),
            *([f"Business interruption items: {'; '.join(te_items)}"] if te_items else []),
        ]
    )
    # 2. The model's proposal, then each figure range-checked (AC15).
    if section_id == "4":
        answer, model = complete(_SYSTEM_4, user, ScoresProposal, config.LLM_EFFORT)
        proposal = {"categories": _cleaned_scores(answer)}
        rows = proposal["categories"]
    else:
        answer, model = complete(_SYSTEM_5, user, LossProposal, config.LLM_EFFORT)
        proposal = {"levels": _cleaned_levels(answer)}
        rows = [r for level in proposal["levels"] for r in (*level["damage"], *level["te"])]
    # 3. Short labels back to full IDs; an unknown label stays as written.
    for row in rows:
        row["citations"] = [labels.get(c, c) for c in row["citations"]]
    return {
        "proposal": proposal,
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.LLM_EFFORT,
            "prompt_version": PROPOSAL_PROMPT_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }

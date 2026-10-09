"""Builds the section-drafting prompt and calls the LLM (GN-01).

Each piece of evidence gets a short label in the prompt (O1, C1, P1), since a model
miscopies long IDs. The labels are mapped back to full IDs before the draft is checked:
- `O:<id>`: a site observation
- `C:<chunk id>`: a passage of a standard
- `P:<chunk id>`: a passage of a past report. These are style and precedent only, never citable.
"""

import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.generation.llm import complete

# Bump whenever the prompt wording changes, so a saved draft names the prompt it came from.
PROMPT_VERSION = "gn01-v2.3"
HERE = Path(__file__).parent
TEMPLATE = json.loads((HERE / "sections.json").read_text())
# Our version of Marsh's PRE drafting skill: voice, house conventions and evidence rules.
# The only source of writing conventions; its header is for people, not the model.
DRAFTING_GUIDE = re.sub(
    r"\A---\n.*?\n---\n", "", (HERE / "drafting-skill.md").read_text(), flags=re.S
)

# Section 3 Opportunities for Improvement (GN-05): Marsh's value lists and matrix, and
# the OFI drafting guide. Bump OFI_PROMPT_VERSION whenever the prompt or guide changes.
OFI_PROMPT_VERSION = "gn05-v4"
OFI_CONFIG = json.loads((HERE / "ofi.json").read_text())
OFI_GUIDE = re.sub(r"\A---\n.*?\n---\n", "", (HERE / "ofi-skill.md").read_text(), flags=re.S)


class Statement(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str
    citations: list[str]


class Subsection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    heading: str
    statements: list[Statement]


class SectionDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    subsections: list[Subsection]
    # Up to three questions for the engineer about gaps an insurer would care about.
    questions: list[str]


def _structure(section: dict) -> str:
    lines = []
    for sub in section["subsections"]:
        if sub["kind"] == "narrative":
            lines.append(f'- "{sub["heading"]}": prose statements.')
        elif sub["kind"] == "fields":
            fields = "; ".join(sub["fields"])
            lines.append(
                f'- "{sub["heading"]}": one statement per field the evidence covers, '
                f"each starting with the field name and a colon. Fields: {fields}."
            )
    return "\n".join(lines)


def _system_prompt(section_id: str, section: dict) -> str:
    return f"""You draft Section {section_id}, "{section["title"]}", of a Marsh Property Risk \
Evaluation (PRE) report. A risk engineer reviews the draft before it is used.

Write these subsections, in this order, using these exact headings:
{_structure(section)}

Follow this drafting guide:

{DRAFTING_GUIDE}

Output:
- <observations> are filed under this section's categories; <other_observations> under \
other categories.
- `citations` lists the labels a statement rests on, for example "O3" or "C2". Keep the \
labels out of the text.
- Where a standards passage explains or supports a statement, cite it alongside the \
observation. Never cite a passage that does not bear on the statement.
- A subsection the evidence does not cover gets no statements.
- `questions` holds up to three questions for the engineer, or none."""


def _observation_block(label: str, o) -> str:
    details = ", ".join(
        f"{label}: {value}"
        for label, value in (
            ("category", o.COPE_dimension),
            ("severity", o.severity),
            ("location", o.location),
            ("standard", o.standard),
        )
        if value
    )
    body = [f"Note: {o.note}"] if o.note else []
    body += [f"Voice transcript: {t}" for t in o.transcripts]
    return f"[{label}] ({details})\n" + "\n".join(body)


def _chunk_block(label: str, chunk: dict) -> str:
    meta = chunk.get("metadata") or {}
    where = " > ".join(meta.get("headings") or [])
    pages = meta.get("page_start")
    if pages is not None:
        where += f", p. {pages}" + (f"-{meta['page_end']}" if meta.get("page_end") else "")
    return f"[{label}] ({where})\n{chunk['text']}"


def _block(tag: str, items: list[str]) -> str:
    return f"<{tag}>\n" + ("\n\n".join(items) or "none") + f"\n</{tag}>"


def generate(context: str) -> str:
    """Stub behind the free-text /generate route. Section drafting is draft_section."""
    return "placeholder generated text"


def draft_section(
    section_id: str,
    assessment,
    observations,
    standards: list[dict],
    precedents: list[dict],
    effort: str,
) -> tuple[SectionDraft, str]:
    """Return the model's draft of one section, and the model that wrote it."""
    section = TEMPLATE["sections"][section_id]
    own = [o for o in observations if o.COPE_dimension in section["cope_dimensions"]]
    others = [o for o in observations if o.COPE_dimension not in section["cope_dimensions"]]

    # Short label -> full citation ID, numbered in prompt order.
    full: dict[str, str] = {}

    def label(prefix: str, n: int, real_id: str) -> str:
        full[f"{prefix}{n}"] = f"{prefix}:{real_id}"
        return f"{prefix}{n}"

    ordered = own + others
    blocks = [_observation_block(label("O", n, o.id), o) for n, o in enumerate(ordered, 1)]
    user = "\n\n".join(
        [
            f"Assessment {assessment.reference}: {assessment.facility_type} in "
            f"{assessment.jurisdiction}. Standards selected for this assessment: "
            f"{', '.join(assessment.standards) or 'none'}.",
            _block("observations", blocks[: len(own)]),
            _block("other_observations", blocks[len(own) :]),
            _block(
                "standards",
                [_chunk_block(label("C", n, c["id"]), c) for n, c in enumerate(standards, 1)],
            ),
            _block(
                "past_reports",
                [_chunk_block(label("P", n, c["id"]), c) for n, c in enumerate(precedents, 1)],
            ),
        ]
    )
    draft, model = complete(_system_prompt(section_id, section), user, SectionDraft, effort)
    # An unknown label stays as written, so the citation check flags it.
    for sub in draft.subsections:
        for statement in sub.statements:
            statement.citations = [full.get(c, c) for c in statement.citations]
    return draft, model


def _one_of(values: list[str]):
    """A type that accepts only these values, so the model must pick from Marsh's lists."""
    return Literal[tuple(values)]


class Ofi(BaseModel):
    """One Opportunity for Improvement as the model drafts it (GN-05). Number, status,
    issue date, issuer and priority are not here: code sets them (AC6)."""

    model_config = ConfigDict(extra="forbid")
    # Non-empty, since the gateway's schema requires every text field.
    title: str = Field(min_length=1)
    category: _one_of(OFI_CONFIG["categories"])
    type: _one_of(OFI_CONFIG["types"])
    description: str = Field(min_length=1)
    observation: str = Field(min_length=1)
    likelihood: _one_of(OFI_CONFIG["likelihood"])
    consequence: _one_of(OFI_CONFIG["consequence"])
    effort: _one_of(OFI_CONFIG["effort"])
    # Labels: the observations it rests on (O), standards it cites (C), and the past OFI
    # it was adapted from (P), if any.
    observations: list[str] = Field(min_length=1)
    standards: list[str]
    precedent: str | None


class OfiDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ofis: list[Ofi]


def ram_priority(likelihood: str, consequence: str) -> str:
    """The OFI's priority from Marsh's Risk Assessment Matrix (AC6): never the model's call."""
    return OFI_CONFIG["ram"][likelihood][consequence]


def _ofi_system_prompt() -> str:
    lists = "\n".join(
        f"- {name}: {', '.join(OFI_CONFIG[key])}"
        for name, key in (
            ("category", "categories"),
            ("type", "types"),
            ("likelihood", "likelihood"),
            ("consequence", "consequence"),
            ("effort", "effort"),
        )
    )
    return f"""You draft Section 3, Opportunities for Improvement (OFIs), of a Marsh Property \
Risk Evaluation (PRE) report. A risk engineer accepts or leaves each one.

Follow this guide:

{OFI_GUIDE}

Pick each of these fields from its list, exactly as written:
{lists}

Output: `observations`, `standards` and `precedent` hold labels such as "O2", "C1" or "P3". \
Keep labels out of the text. Return no OFIs if no observation needs one."""


def draft_ofis(
    assessment,
    observations,
    standards: list[dict],
    precedents: list[dict],
    accepted: list[str],
    effort: str,
) -> tuple[OfiDraft, str]:
    """Return the model's OFIs for these observations, labels mapped back to full IDs
    (an unknown label stays as written, for the orchestrator to drop), and the model."""
    full: dict[str, str] = {}

    def label(prefix: str, n: int, real_id: str) -> str:
        full[f"{prefix}{n}"] = f"{prefix}:{real_id}"
        return f"{prefix}{n}"

    user = "\n\n".join(
        [
            f"Assessment {assessment.reference}: {assessment.facility_type} in "
            f"{assessment.jurisdiction}.",
            _block(
                "observations",
                [_observation_block(label("O", n, o.id), o) for n, o in enumerate(observations, 1)],
            ),
            _block(
                "standards",
                [_chunk_block(label("C", n, c["id"]), c) for n, c in enumerate(standards, 1)],
            ),
            _block(
                "past_ofis",
                [_chunk_block(label("P", n, c["id"]), c) for n, c in enumerate(precedents, 1)],
            ),
            _block("accepted_ofis", [f"- {title}" for title in accepted]),
        ]
    )
    result, model = complete(_ofi_system_prompt(), user, OfiDraft, effort)
    for o in result.ofis:
        o.observations = [full.get(c, c) for c in o.observations]
        o.standards = [full.get(c, c) for c in o.standards]
        o.precedent = full.get(o.precedent, o.precedent) if o.precedent else None
    return result, model

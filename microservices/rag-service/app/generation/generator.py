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

from pydantic import BaseModel, ConfigDict

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

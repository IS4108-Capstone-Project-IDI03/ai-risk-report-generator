"""Builds a pre-survey checklist's items (CP-30): Marsh's template, then the model's.

Every template subsection of Sections 6-12 becomes one item, written in code (AC3), so
coverage never depends on the model. The model writes the items a standard adds, for the
report's areas and for the hazards configured for the facility type (`checklist.json`),
each citing the passages it rests on by label (C1, C2), mapped back to full IDs here.
"""

import json
import re
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from app.generation.generator import TEMPLATE, _block, _chunk_block
from app.generation.llm import complete

# Bump whenever the prompt wording changes, so a saved checklist names the prompt it came from.
CHECKLIST_PROMPT_VERSION = "cp30-v5"  # v5: no item from a loss history or example
CHECKLIST = json.loads((Path(__file__).parent / "checklist.json").read_text())

# "NFPA 13" -> ("nfpa_standard", "13"), as standards are labelled in the knowledge base.
_ISSUERS = {"NFPA": "nfpa_standard", "FM": "fm_standard"}


def named_standard(name: str) -> tuple[str, str]:
    issuer, number = name.split(" ", 1)
    return _ISSUERS[issuer], number.strip().lower()


def hazards_for(facility_type: str) -> list[dict]:
    """The hazards configured for a facility type; none for a type the config doesn't list."""
    return CHECKLIST["hazards"].get(facility_type, [])


def area_scope(section_id: str) -> str:
    """What a report area covers: each subsection, with the fields it asks for or what its
    template item checks.

    The area's search and the prompt both use it, so a passage is found, and an item filed,
    by what the area is about rather than its title alone: searched by title, Management
    Programs drew whatever no other search claimed (cp30-v4).
    """
    parts = []
    for sub in TEMPLATE["sections"][section_id]["subsections"]:
        heading = sub["heading"]
        if heading.endswith("Comments"):
            continue
        detail = ", ".join(sub.get("fields", [])) or CHECKLIST["template_details"].get(
            f"{section_id}/{heading}", ""
        )
        parts.append(f"{heading} ({detail})" if detail else heading)
    return "; ".join(parts)


def template_items() -> list[dict]:
    """One item per template subsection of Sections 6-12, in report order (AC3).

    A subsection of the engineer's comments ("... Comments") asks for judgement, not
    something to inspect, so it gets no item.
    """
    items = []
    for section_id in CHECKLIST["template_sections"]:
        section = TEMPLATE["sections"][section_id]
        for sub in section["subsections"]:
            heading = sub["heading"]
            if heading.endswith("Comments"):
                continue
            items.append(
                {
                    "area": section_id,
                    "subsection": heading,
                    "origin": "template",
                    "hazard": None,
                    "text": CHECKLIST["template_details"].get(f"{section_id}/{heading}", heading),
                    "fields": sub.get("fields", []),
                    "COPE_dimension": section["cope_dimensions"],
                    "citations": [],
                    "flags": [],
                }
            )
    return items


class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str
    # The passage's own words that the item rests on, copied exactly (AC6).
    quote: str


class Item(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # A report section ("7") or "hazards".
    area: str
    # For an area item: the template subsection it belongs under, or null.
    subsection: str | None
    # For a hazard item: the hazard's id.
    hazard: str | None
    text: str
    citations: list[Citation]


class ChecklistDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[Item]


def _areas() -> str:
    return "\n".join(
        f'- "{a}" {TEMPLATE["sections"][a]["title"]}. Subsections: {area_scope(a)}.'
        for a in CHECKLIST["template_sections"]
    )


def _hazard_lines(hazards: list[dict]) -> str:
    return "\n".join(
        f'- "{h["id"]}" {h["name"]}. Check against: {", ".join(h["standards"])}.' for h in hazards
    )


SYSTEM_PROMPT = """You prepare a pre-survey checklist for a Marsh property risk engineer: \
the points to inspect on a site visit, before the report is written.

The checklist already has one item per subsection of the report template. Add the items \
the standards below make specific to this facility: what to check, and what the \
standard expects.

<found_for> lists, for each report area and each hazard, the passages its search found. \
Work through every one of them. It says where to look, not where an item goes:
- For each specific requirement the passages set that an engineer can check on site and \
that applies to this facility, write an item under the report area, and subsection, whose \
scope in <report_areas> covers what it checks, whichever search found its passage. \
`area` is its section number, `subsection` that subsection's heading (or null), and \
`hazard` null. Management Programs is the site's programmes and procedures, as listed; a \
requirement about how a building is built, stored in or protected belongs to that area. A \
requirement no area's scope covers gets no item: never stretch a passage to fill an area.
- For each hazard, write at least one item, with `area` "hazards" and `hazard` its id. \
Prefer the passages of the standards the hazard is checked against.

Rules:
- Each item is one inspection point, written as an instruction to the engineer \
("Check ...", "Record ..."), in one sentence, in Singapore English.
- Every item rests on the standards passages given. `citations` lists each passage it \
rests on by its label (C1, C2), with `quote`: the passage's own words that support it, \
copied exactly, at most 30 words. Never write an item no passage supports.
- Loss histories, case studies and examples describe past fires; they are not \
requirements. Never base an item on one.
- Write about the facility type, never about a particular site: nothing is known yet \
about the site itself.
- Each requirement appears once, under the one area or hazard it best belongs to. Never \
write the same check twice in different words.
- Do not repeat a template subsection as an item. Do not recommend improvements; this is \
a list of what to inspect."""


def _found_lines(found_for: dict[str, list[str]], labels: dict[str, str]) -> str:
    """One line per report area and hazard: the labels of the passages its search found."""
    return "\n".join(
        f'- "{key}": {", ".join(labels[p] for p in ids if p in labels) or "nothing found"}'
        for key, ids in found_for.items()
    )


def _user_prompt(
    facility_type: str, jurisdiction: str, hazards: list[dict], found: str, blocks
) -> str:
    return "\n\n".join(
        [
            f"Facility type: {facility_type}. Country: {jurisdiction}.",
            f"<report_areas>\n{_areas()}\n</report_areas>",
            f"<hazards>\n{_hazard_lines(hazards) or 'none'}\n</hazards>",
            f"<found_for>\n{found or 'none'}\n</found_for>",
            _block("standards", blocks),
        ]
    )


_SECTIONS = set(CHECKLIST["template_sections"])


def draft_items(
    facility_type: str,
    jurisdiction: str,
    hazards: list[dict],
    passages: list[dict],
    found_for: dict[str, list[str]],
    effort: str,
) -> tuple[list[dict], str]:
    """Return the model's items, with labels mapped to `C:<chunk id>`, and the model.

    `found_for` maps each report area and hazard id to the passage ids its search found.
    An item for an area or hazard that does not exist is dropped; a citation of a label
    it was not given is kept as written, so the caller's check flags it.
    """
    full: dict[str, str] = {}
    labels: dict[str, str] = {}
    blocks = []
    for n, passage in enumerate(passages, 1):
        full[f"C{n}"] = f"C:{passage['id']}"
        labels[passage["id"]] = f"C{n}"
        blocks.append(_chunk_block(f"C{n}", passage))
    draft, model = complete(
        SYSTEM_PROMPT,
        _user_prompt(facility_type, jurisdiction, hazards, _found_lines(found_for, labels), blocks),
        ChecklistDraft,
        effort,
    )
    known = {h["id"]: h for h in hazards}
    items = []
    for item in draft.items:
        if item.area == "hazards":
            hazard = known.get(item.hazard or "")
            if hazard is None:
                continue
            area, subsection, cope = "hazards", None, hazard["cope"]
        elif item.area in _SECTIONS:
            section = TEMPLATE["sections"][item.area]
            # Only subsections with a template item: an item is shown under its subsection.
            headings = {
                s["heading"]
                for s in section["subsections"]
                if not s["heading"].endswith("Comments")
            }
            area, hazard = item.area, None
            subsection = item.subsection if item.subsection in headings else None
            # A section of one subsection (6) has nowhere else to put it; the model leaves it null.
            if subsection is None and len(headings) == 1:
                [subsection] = headings
            cope = section["cope_dimensions"]
        else:
            continue
        items.append(
            {
                "area": area,
                "subsection": subsection,
                "origin": "hazard" if hazard else "standard",
                "hazard": hazard["id"] if hazard else None,
                "text": re.sub(r"\s+", " ", item.text).strip(),
                "fields": [],
                "COPE_dimension": cope,
                "citations": [
                    {"ref": full.get(c.label, c.label), "quote": c.quote} for c in item.citations
                ],
                "flags": [],
            }
        )
    return items, model

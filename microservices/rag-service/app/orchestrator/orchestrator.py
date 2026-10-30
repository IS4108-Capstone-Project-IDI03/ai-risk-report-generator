"""Single controller for the RAG pipeline.

Calls retrieval -> context assembly -> generation -> guardrail-check as
plain, sequential function calls. No event bus, no background tasks —
this is the one place that defines pipeline order, so a single run can
always be traced end to end (needed by the eval harness).
"""

import json
import logging
import re
from datetime import UTC, datetime
from pathlib import Path

from app import config, usage
from app import privacy as pii
from app.chat.quotes import quote_found
from app.generation.checklist import (
    CHECKLIST,
    CHECKLIST_PROMPT_VERSION,
    area_scope,
    draft_items,
    hazards_for,
    named_standard,
    template_items,
)
from app.generation.generator import (
    OFI_CONFIG,
    OFI_PROMPT_VERSION,
    PROMPT_VERSION,
    REDRAFT_PROMPT_VERSION,
    SUMMARY_PROMPT_VERSION,
    TEMPLATE,
    draft_ofis,
    draft_section,
    draft_summary,
    filed_under,
    generate,
    ram_priority,
)
from app.guardrails.checker import check, check_citations
from app.retrieval.retriever import rerank, retrieve, search

# uvicorn's own logger, as in generation/llm.py, so warnings show in the service logs.
log = logging.getLogger("uvicorn.error")

# Citable standards. Past reports (`marsh_report`) are fetched separately as precedent.
STANDARD_SOURCES = ["fm_standard", "nfpa_standard"]
# Candidates per observation for the reranker to choose from (AC14). Only the top
# MAX_STANDARDS are sent, since every passage sent is paid for as input tokens.
STANDARDS_PER_OBSERVATION = 8
# Cosine distance beyond which a passage is off-topic. ponytail: set from one
# assessment (relevant FM-200 passages <= 0.60, unrelated ones 0.61-0.63); recheck it
# with the eval once more standards are ingested.
MAX_STANDARD_DISTANCE = 0.60
MAX_STANDARDS = 12
MAX_PRECEDENTS = 4


# Marsh's maturity scale for Section 6 (GN-11), lowest first, as in sections.json's
# instructions for the section. A Management Programs row reads "<Program>: <Rank>. …".
MATURITY_RANKS = ("Undeveloped", "Formalized", "Established", "Embedded", "Optimized")
_PROGRAM_ROW = re.compile(r"^(?P<program>[^:]+):\s*(?P<rank>\w+)\b")


def check_maturity_ranks(subsections: list[dict], guardrail: dict) -> dict:
    """Mark a Management Programs row unsupported when it names no program it should, or a
    rank outside Marsh's five, so the engineer sees it rather than a made-up rating."""
    programs = next(
        (s["fields"] for s in TEMPLATE["sections"]["6"]["subsections"] if s.get("fields")), []
    )
    unsupported = guardrail["unsupported_count"]
    for sub in subsections:
        if sub["heading"] != "Management Programs":
            continue
        for statement in sub["statements"]:
            row = _PROGRAM_ROW.match(statement["text"])
            valid = (
                bool(row) and row["program"].strip() in programs and row["rank"] in MATURITY_RANKS
            )
            if statement["supported"] and not valid:
                statement["supported"] = False
                unsupported += 1
    return {"passed": unsupported == 0, "unsupported_count": unsupported}


# Sections 4 and 5 (GN-03): a number as written ("28.4", "1,000"), and a rating named in
# words ("rated B", "a rating of A"). The facts' rating lines are written by the gateway
# (section.service.ts, figureFacts): keep the two in step.
_NUMBER = re.compile(r"\d+(?:[.,]\d+)*")
_RATING = re.compile(r"\b[Rr]at(?:ed|ing)\s+(?:of\s+|as\s+)?([A-E])\b")


def _numbers(text: str) -> set[float]:
    # By value, so 80, 80.0 and 1,000 vs 1000 match however each was written.
    return {float(n.replace(",", "")) for n in _NUMBER.findall(text)}


def check_numbers_grounded(
    subsections: list[dict], guardrail: dict, texts: dict[str, str], facts: str
) -> dict:
    """Mark a statement unsupported when it holds a number found neither in the facts nor in
    the observations and standards it cites, or names a rating other than the computed one
    (the potential one only where it says "potential"), so no figure is made up (AC4, AC9)."""
    current = re.search(r"Current Location Risk Quality Rating: ([A-E])", facts)
    potential = re.search(r"Potential Location Risk Quality Rating: ([A-E])", facts)
    unsupported = guardrail["unsupported_count"]
    for sub in subsections:
        for statement in sub["statements"]:
            text = statement["text"]
            known = _numbers(facts).union(
                *(_numbers(texts.get(c, "")) for c in statement["citations"])
            )
            allowed = {
                m[1] for m in (current, potential if "potential" in text.lower() else None) if m
            }
            made_up = bool(_numbers(text) - known) or any(
                r not in allowed for r in _RATING.findall(text)
            )
            if statement["supported"] and made_up:
                statement["supported"] = False
                unsupported += 1
    return {"passed": unsupported == 0, "unsupported_count": unsupported}


def _assemble_context(chunks: list[dict]) -> str:
    return "\n".join(str(chunk) for chunk in chunks)


def run(query: str) -> dict:
    chunks = retrieve(query)
    context = _assemble_context(chunks)
    generated_text = generate(context)
    guardrail_result = check(generated_text)
    return {
        "text": generated_text,
        "guardrail": guardrail_result,
    }


def _evidence_summary(observations) -> str:
    text = " ".join(" ".join(o.recorded()) for o in observations)
    return " ".join(text.split())[:1000]


# Site notes are terse ("B1 spk CV found shut"), and abbreviations blur what a search
# embedding means, so standard queries spell them out. Only the query changes.
_ABBREVIATIONS = {
    k: v
    for k, v in json.loads(
        (Path(__file__).parents[1] / "retrieval" / "site_abbreviations.json").read_text()
    ).items()
    if not k.startswith("_")
}
_ABBREVIATION = re.compile(
    r"\b(" + "|".join(map(re.escape, sorted(_ABBREVIATIONS, key=len, reverse=True))) + r")\b",
    re.IGNORECASE,
)


def spell_out(text: str) -> str:
    """Replace site-note abbreviations with their words, for a search query."""
    return _ABBREVIATION.sub(lambda m: _ABBREVIATIONS[m.group(0).lower()], text)


def standard_queries(section: dict, observations) -> list[str]:
    """One standards query per observation filed under the section, from its own words.

    A query per subsection heading, padded with all the evidence, came back as near-
    identical queries that matched the same generic passages. An observation's own note
    ("no door fan test report") finds the passage that explains it. Backup observations
    from other categories don't search, so other sections' findings don't steer it.
    Cohere embeds at most 96 texts a call.
    """
    own = [o for o in observations if filed_under(o, section)]
    return [
        f"{section['title']}: " + spell_out(" ".join(" ".join(o.recorded()).split()))[:500]
        for o in own[:95]
    ]


def _nearest_first(per_observation: list[list[dict]]) -> dict[str, dict]:
    """Standards within MAX_STANDARD_DISTANCE, each observation's nearest first, then the
    next nearest, so if rerank fails a cap still keeps every observation's nearest."""
    standards: dict[str, dict] = {}
    per_observation = [
        [h for h in hits if h.get("distance", 0) <= MAX_STANDARD_DISTANCE]
        for hits in per_observation
    ]
    for rank in range(STANDARDS_PER_OBSERVATION):
        for hits in per_observation:
            if rank < len(hits):
                standards.setdefault(hits[rank]["id"], hits[rank])
    return standards


def _mask_evidence(protection: pii.Session, observations, extras: list[str | None]):
    """Copies of the observations with their text masked, and `extras` (other request text
    such as the facts) masked, all in one /mask call so one mapping covers them (Rule 2)."""
    if not protection.enabled:
        return list(observations), list(extras)
    texts = [
        value or ""
        for o in observations
        for value in (o.note, *o.transcripts, *o.handwriting, o.location, o.standard)
    ] + [value or "" for value in extras]
    masked = iter(protection.mask(texts))

    def take(original):
        value = next(masked)
        return value if original is not None else None

    observations = [
        o.model_copy(
            update={
                "note": take(o.note),
                "transcripts": [take(t) for t in o.transcripts],
                "handwriting": [take(t) for t in o.handwriting],
                "location": take(o.location),
                "standard": take(o.standard),
            }
        )
        for o in observations
    ]
    return observations, [take(value) for value in extras]


def _with_text(redraft, texts: list[str | None]):
    """A copy of a redraft (RV-02) with its instruction and saved statements' text replaced."""
    instruction, *current = texts
    return redraft.model_copy(
        update={
            "instruction": instruction,
            "current": [
                c.model_copy(update={"text": text})
                for c, text in zip(redraft.current, current, strict=True)
            ],
        }
    )


def _mask_passages(protection: pii.Session, chunks: list[dict]) -> list[dict]:
    """Past-report passages with their text and headings masked, for rerank and the prompt.
    Standards are public and are not masked."""
    if not protection.enabled or not chunks:
        return chunks
    headings = [(c["metadata"] or {}).get("headings") or [] for c in chunks]
    masked = iter(protection.mask([c["text"] for c in chunks] + [h for hs in headings for h in hs]))
    texts = [next(masked) for _ in chunks]
    return [
        {
            **c,
            "text": text,
            "metadata": {**(c["metadata"] or {}), "headings": [next(masked) for _ in hs]},
        }
        for c, text, hs in zip(chunks, texts, headings, strict=True)
    ]


def _unmask_statements(protection: pii.Session, statements: list[dict]) -> list[dict]:
    """Restore each statement's real values in place; return those still holding a
    placeholder the mapping lacks (one the model garbled or made up)."""
    garbled = []
    for statement in statements:
        statement["text"], unknown = protection.unmask(statement["text"])
        if unknown:
            garbled.append(statement)
    return garbled


def _unmask_fields(protection: pii.Session, item, fields: tuple[str, ...]) -> dict:
    """The item's text fields with real values back. One holding a placeholder the mapping
    lacks is kept as written and logged, without its text (Rule 5)."""
    restored = {}
    for field in fields:
        restored[field], unknown = protection.unmask(getattr(item, field))
        if unknown:
            log.warning("OFI %s holds %d unresolved placeholder(s)", field, len(unknown))
    return restored


def check_placeholders_resolved(garbled: list[dict], guardrail: dict) -> dict:
    """Mark unsupported a statement holding a placeholder that could not be restored, so the
    engineer sees it rather than a missing name (PV-02)."""
    unsupported = guardrail["unsupported_count"]
    for statement in garbled:
        if statement["supported"]:
            statement["supported"] = False
            unsupported += 1
    return {"passed": unsupported == 0, "unsupported_count": unsupported}


def draft(
    section_id: str, assessment, observations, redraft=None, facts=None, privacy=None
) -> dict:
    """Draft one report section (GN-01): retrieve, generate, check citations.

    `redraft`, when the engineer regenerates a section from the review workspace
    (RV-02), holds the saved draft's findings with their decisions and the engineer's
    instruction. Retrieval and the checks are the same; only the prompt adds them.

    Raises KeyError for a section that is not in the template.
    """
    # Filled by the paid calls below (embed, rerank, draft) and returned as `usage`.
    paid_calls = usage.start()
    section = TEMPLATE["sections"][section_id]
    title = section["title"]
    site = {"jurisdiction": assessment.jurisdiction, "facility_type": assessment.facility_type}
    # With protection on, Cohere and the model only see the evidence masked (PV-02). The
    # checks below compare the restored draft with the original observations.
    protection = pii.session(privacy)
    saved = [redraft.instruction, *(c.text for c in redraft.current)] if redraft else []
    masked, [masked_facts, *masked_saved] = _mask_evidence(
        protection, observations, [facts, *saved]
    )
    masked_redraft = _with_text(redraft, masked_saved) if redraft else None
    evidence = _evidence_summary([o for o in masked if filed_under(o, section)])

    # One batched search: standards for each of the section's observations, then past
    # reports for the section as a whole. Past reports are filtered by country only:
    # their wording and judgements carry across facility types, and few reports share
    # one site's type.
    *per_observation, past = search(
        [
            (query, {**site, "source_type": STANDARD_SOURCES}, STANDARDS_PER_OBSERVATION)
            for query in standard_queries(section, masked)
        ]
        + [
            (
                f"{title}: {evidence}",
                {"jurisdiction": assessment.jurisdiction, "source_type": "marsh_report"},
                20,
            )
        ]
    )

    standards = _nearest_first(per_observation)

    # Past reports' passages under the same section heading, as wording and precedent.
    precedents = [
        chunk
        for chunk in past
        if any(title.lower() in h.lower() for h in (chunk["metadata"] or {}).get("headings") or [])
    ]

    # One rerank call for both kinds (AC14), against the section's own observations.
    # A failed rerank (e.g. the trial key's 10 calls a minute) keeps the order above
    # rather than failing the draft.
    # Past reports are masked before rerank, since Cohere reads them too (PV-02). The
    # reviewer's `sources` below show the stored passage.
    stored = {chunk["id"]: chunk for chunk in precedents}
    candidates = [*standards.values(), *_mask_passages(protection, precedents)]
    try:
        candidates = rerank(spell_out(f"{title}: {evidence}"), candidates)
    except Exception:
        log.warning("Rerank failed for section %s; using vector order", section_id, exc_info=True)
    standard_ids = set(standards)
    standards = {c["id"]: c for c in candidates if c["id"] in standard_ids}
    standards = dict(list(standards.items())[:MAX_STANDARDS])
    precedents = [c for c in candidates if c["id"] not in standard_ids][:MAX_PRECEDENTS]

    result, model = draft_section(
        section_id,
        assessment,
        masked,
        list(standards.values()),
        precedents,
        config.LLM_EFFORT,
        masked_redraft,
        masked_facts,
    )

    # The template, not the model, decides the subsections and their order (AC5).
    written = {s.heading: s.statements for s in result.subsections}
    subsections = [
        {
            "heading": sub["heading"],
            "kind": sub["kind"],
            "statements": [s.model_dump() for s in written.get(sub["heading"], [])]
            if sub["kind"] != "table"
            else [],
        }
        for sub in section["subsections"]
    ]
    # Real values back before any check compares text (Rule 4).
    garbled = _unmask_statements(protection, [s for sub in subsections for s in sub["statements"]])
    questions = [protection.unmask(q)[0] for q in result.questions[:3]]
    citable = {f"O:{o.id}" for o in observations} | {f"C:{cid}" for cid in standards}
    guardrail = check_citations(subsections, citable)
    if section_id == "6":
        guardrail = check_maturity_ranks(subsections, guardrail)
    if section_id in ("4", "5"):
        # Everything the prompt shows of each observation, its location and standard included.
        texts = {
            f"O:{o.id}": " ".join(filter(None, [*o.recorded(), o.location, o.standard]))
            for o in observations
        }
        texts |= {f"C:{cid}": chunk["text"] for cid, chunk in standards.items()}
        guardrail = check_numbers_grounded(subsections, guardrail, texts, facts or "")
    guardrail = check_placeholders_resolved(garbled, guardrail)

    # The cited passages, so the reviewer can open each one (RV-01 AC7). A cited past-report
    # passage is kept too, although it cannot support the statement that cites it.
    cited = {c for sub in subsections for s in sub["statements"] for c in s["citations"]}
    passages = {f"C:{cid}": chunk for cid, chunk in standards.items()} | {
        f"P:{chunk['id']}": stored[chunk["id"]] for chunk in precedents
    }
    sources = {
        ref: {"text": chunk["text"], **(chunk["metadata"] or {})}
        for ref, chunk in passages.items()
        if ref in cited
    }
    return {
        "section_id": section_id,
        "title": section["title"],
        "subsections": subsections,
        "questions": questions,
        "sources": sources,
        "guardrail": guardrail,
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.LLM_EFFORT,
            # A redraft's prompt is the first draft's plus the redraft part (RV-02).
            "prompt_version": PROMPT_VERSION
            if redraft is None
            else f"{PROMPT_VERSION}+{REDRAFT_PROMPT_VERSION}",
            "template_version": TEMPLATE["version"],
            "generated_at": datetime.now(UTC).isoformat(),
            "instruction": (redraft.instruction or None) if redraft else None,
            "privacy": protection.provenance(),
        },
    }


# Severities that can call for an OFI (GN-05, decided 8 Oct): the model proposes OFIs only
# from these; a low-severity finding is reported in its section, not acted on.
OFI_SEVERITIES = {"critical", "high", "moderate"}
OFI_HEADING = "Opportunities for Improvement"
MAX_PAST_OFIS = 8


def _is_past_ofi(chunk: dict) -> bool:
    """A past report's OFI record: under "Opportunities for Improvement", but not the
    section's introduction or its Risk Assessment Matrix boilerplate."""
    headings = (chunk["metadata"] or {}).get("headings") or []
    return (
        OFI_HEADING in headings
        and headings[-1] != OFI_HEADING
        and not any("Risk Assessment Matrix" in h for h in headings)
    )


def draft_ofis_for(assessment, observations, accepted: list[str], privacy=None) -> dict:
    """Draft Section 3 Opportunities for Improvement (GN-05): pick candidate observations,
    retrieve standards and past OFIs, generate, then finish each OFI in code.

    `accepted` holds the titles of OFIs already accepted, so they aren't proposed again.
    """
    # Filled by the paid calls below (embed, rerank, draft) and returned as `usage` (EV-03).
    paid_calls = usage.start()
    protection = pii.session(privacy)
    provenance = {
        "provider": config.LLM_PROVIDER,
        "model": None,
        "effort": config.LLM_EFFORT,
        "prompt_version": OFI_PROMPT_VERSION,
        "config_version": OFI_CONFIG["version"],
        "generated_at": datetime.now(UTC).isoformat(),
    }
    # 1. Candidates: moderate-or-worse findings. None means nothing to suggest, and no call.
    # Cohere embeds at most 96 texts a call, two per candidate.
    candidates = [o for o in observations if o.severity in OFI_SEVERITIES][:48]
    if not candidates:
        return {
            "ofis": [],
            "sources": {},
            "provenance": {**provenance, "privacy": protection.provenance()},
            "usage": paid_calls,
        }

    # With protection on, Cohere and the model see the candidates and the accepted titles
    # (saved text) masked, in one /mask call (PV-02).
    masked, masked_accepted = _mask_evidence(protection, candidates, accepted)

    # 2. One batched search, by each candidate's own words: standards filtered to the
    # site, and past reports by country (their OFIs carry across facility types).
    site = {"jurisdiction": assessment.jurisdiction, "facility_type": assessment.facility_type}
    queries = [spell_out(" ".join(o.recorded()))[:500] for o in masked]
    results = search(
        [(q, {**site, "source_type": STANDARD_SOURCES}, STANDARDS_PER_OBSERVATION) for q in queries]
        + [
            (q, {"jurisdiction": assessment.jurisdiction, "source_type": "marsh_report"}, 10)
            for q in queries
        ]
    )
    standards = _nearest_first(results[: len(candidates)])
    past = {c["id"]: c for hits in results[len(candidates) :] for c in hits if _is_past_ofi(c)}

    # One rerank for both kinds against all candidates, as for sections (GN-01 AC14). Past
    # OFIs are masked first, since Cohere reads them too; `sources` show the stored passage.
    passages = [*standards.values(), *_mask_passages(protection, list(past.values()))]
    try:
        passages = rerank(spell_out(_evidence_summary(masked)), passages)
    except Exception:
        log.warning("Rerank failed for OFIs; using vector order", exc_info=True)
    standards = {c["id"]: c for c in passages if c["id"] in standards}
    standards = dict(list(standards.items())[:MAX_STANDARDS])
    precedents = [c for c in passages if c["id"] in past][:MAX_PAST_OFIS]

    # 3. Generate.
    result, model = draft_ofis(
        assessment,
        masked,
        list(standards.values()),
        precedents,
        masked_accepted,
        config.LLM_EFFORT,
    )

    # 4. Finish in code: an OFI must rest on a current observation (AC1); a citation or
    # precedent that doesn't resolve is dropped; the priority is the matrix's (AC6).
    known = {f"O:{o.id}" for o in candidates}
    citable = {f"C:{cid}" for cid in standards}
    precedent_ids = {f"P:{c['id']}" for c in precedents}
    ofis = []
    for o in result.ofis:
        rests_on = [c.removeprefix("O:") for c in o.observations if c in known]
        if not rests_on:
            continue
        ofis.append(
            {
                **o.model_dump(exclude={"observations", "standards", "precedent"}),
                "priority": ram_priority(o.likelihood, o.consequence),
                "observations": rests_on,
                "standards": [c for c in o.standards if c in citable],
                "precedent": o.precedent if o.precedent in precedent_ids else None,
                # Real values back (PV-02). OFIs have no `supported` flag: a placeholder that
                # can't be restored stays visible for the engineer to edit.
                **_unmask_fields(protection, o, ("title", "description", "observation")),
            }
        )
    # The cited passages, so the engineer can see the standard and the precedent (AC2).
    chunks = {f"C:{cid}": c for cid, c in standards.items()} | {
        f"P:{c['id']}": past[c["id"]] for c in precedents
    }
    cited = {c for o in ofis for c in [*o["standards"], o["precedent"]] if c}
    sources = {
        ref: {"text": c["text"], **(c["metadata"] or {})}
        for ref, c in chunks.items()
        if ref in cited
    }
    return {
        "ofis": ofis,
        "sources": sources,
        "provenance": {**provenance, "model": model, "privacy": protection.provenance()},
        "usage": paid_calls,
    }


def draft_summary_for(assessment, sections, privacy=None) -> dict:
    """Draft Section 2's Executive Summary (GN-07 AC2) from the report's other sections:
    generate, then check that each statement cites a section it was given."""
    paid_calls = usage.start()
    # Saved sections hold real names: the model sees them masked, in one /mask call (PV-02).
    protection = pii.session(privacy)
    masked = [
        section.model_copy(update={"text": text})
        for section, text in zip(sections, protection.mask([s.text for s in sections]), strict=True)
    ]
    result, model = draft_summary(assessment, masked, config.LLM_EFFORT)
    statements = [s.model_dump() for s in result.statements]
    # Real values back before the check (Rule 4); an unresolved placeholder is unsupported.
    garbled = _unmask_statements(protection, statements)
    guardrail = check_citations([{"statements": statements}], {f"S:{s.id}" for s in sections})
    guardrail = check_placeholders_resolved(garbled, guardrail)
    return {
        "statements": statements,
        "guardrail": guardrail,
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.LLM_EFFORT,
            "prompt_version": SUMMARY_PROMPT_VERSION,
            "template_version": TEMPLATE["version"],
            "generated_at": datetime.now(UTC).isoformat(),
            "privacy": protection.provenance(),
        },
    }


# Pre-survey checklist (CP-30). Passages per search: enough for the reranker to choose from.
CHECKLIST_PER_QUERY = 4
# Each search keeps its nearest passages, so no area or hazard is crowded out by another's
# (a single rerank of the pool once left Fire Protection with nothing to cite).
CHECKLIST_KEPT_PER_QUERY = 2
# Passages sent to the model, besides each search's own.
MAX_CHECKLIST_PASSAGES = 20


def draft_checklist_for(facility_type: str, jurisdiction: str, standards) -> dict:
    """Generate a pre-survey checklist (CP-30): template items, then items from standards.

    `standards` are the knowledge documents the engineer kept in scope (AC1-2): only their
    passages are searched. Nothing about the site but its facility type and country is
    sent, so no client detail reaches Cohere or the model.
    """
    paid_calls = usage.start()
    hazards = hazards_for(facility_type)
    ids = [s.id for s in standards]
    in_scope = {(s.source_type, (s.standard_number or "").strip().lower()) for s in standards}

    def named_in_scope(hazard: dict) -> list[str]:
        return [n for n in hazard["standards"] if named_standard(n) in in_scope]

    def named_ids(hazard: dict) -> list[str]:
        named = {named_standard(n) for n in hazard["standards"]}
        return [
            s.id
            for s in standards
            if (s.source_type, (s.standard_number or "").strip().lower()) in named
        ]

    passages: list[dict] = []
    # The passages each report area and hazard's own search found, by area or hazard id, so
    # the model knows what to write for each.
    found_for: dict[str, list[str]] = {}
    if ids:
        areas = CHECKLIST["template_sections"]
        # One batched search: each report area, then each hazard within the standards it is
        # checked against (AC7), or every standard in scope when none of those is.
        requests = [
            (
                f"{facility_type}: {TEMPLATE['sections'][a]['title']}: {area_scope(a)}",
                {"doc_id": ids},
                CHECKLIST_PER_QUERY,
            )
            for a in areas
        ] + [
            (
                f"{facility_type}: {h['search']}",
                {"doc_id": named_ids(h) or ids},
                CHECKLIST_PER_QUERY,
            )
            for h in hazards
        ]
        results = search(requests)
        keys = [*areas, *(h["id"] for h in hazards)]
        own = {hit["id"] for hits in results for hit in hits[:CHECKLIST_KEPT_PER_QUERY]}
        pooled = {hit["id"]: hit for hits in results for hit in hits}
        candidates = list(pooled.values())
        try:
            candidates = rerank(
                f"What to inspect at a {facility_type}: "
                + ", ".join(
                    [TEMPLATE["sections"][a]["title"] for a in areas] + [h["name"] for h in hazards]
                ),
                candidates,
            )
        except Exception:
            log.warning("Rerank failed for the checklist; using vector order", exc_info=True)
        kept = {c["id"] for c in candidates[:MAX_CHECKLIST_PASSAGES]} | own
        passages = [c for c in candidates if c["id"] in kept]
        # Each passage is listed under one area or hazard only (offered for two, the model
        # wrote the same requirement in both): a hazard's, if any hazard's search found it, so
        # a hazard keeps its own standards' passages (AC7); else the area's that found it
        # nearest. Among hazards, or among areas, the nearest wins.
        owner: dict[str, tuple[bool, float, str]] = {}
        for key, hits in zip(keys, results):
            is_area = key in areas
            for hit in hits:
                rank = (is_area, hit["distance"], key)
                if hit["id"] in kept and (hit["id"] not in owner or rank < owner[hit["id"]]):
                    owner[hit["id"]] = rank
        found_for = {
            key: [hit["id"] for hit in hits if owner.get(hit["id"], (0, 0, None))[2] == key]
            for key, hits in zip(keys, results)
        }

    drafted, model = (
        draft_items(
            facility_type, jurisdiction, hazards, passages, found_for, config.CHECKLIST_EFFORT
        )
        if passages
        else ([], None)
    )

    # Checks in code (AC6): a citation counts only if it names a passage the model was given,
    # and its quote is looked for in that passage. An item left with none is "uncited".
    given = {f"C:{p['id']}": p for p in passages}
    for item in drafted:
        item["citations"] = [
            {**c, "quote_found": quote_found(c["quote"], given[c["ref"]]["text"])}
            for c in item["citations"]
            if c["ref"] in given
        ]
        if not item["citations"]:
            item["flags"].append("uncited")

    # Every configured hazard gets an item (AC4), from the config when the model wrote none.
    # Its own origin, as the team wrote it, not the model (AC8).
    covered = {item["hazard"] for item in drafted}
    for hazard in hazards:
        if hazard["id"] not in covered:
            drafted.append(
                {
                    "area": "hazards",
                    "subsection": None,
                    "origin": "hazard_list",
                    "hazard": hazard["id"],
                    "text": hazard["item"],
                    "fields": [],
                    "COPE_dimension": hazard["cope"],
                    "citations": [],
                    "flags": ["uncited"],
                }
            )

    # Report order: each area's template items, each followed by the items written under
    # its subsection, then the area's other items; then the hazards in config order.
    items = []
    templates = template_items()
    for area in CHECKLIST["template_sections"]:
        written = [i for i in drafted if i["area"] == area]
        for template in (t for t in templates if t["area"] == area):
            items.append(template)
            items += [i for i in written if i["subsection"] == template["subsection"]]
        items += [i for i in written if i["subsection"] is None]
    order = {h["id"]: n for n, h in enumerate(hazards)}
    items += sorted(
        (i for i in drafted if i["area"] == "hazards"), key=lambda i: order[i["hazard"]]
    )

    cited = {c["ref"] for item in items for c in item["citations"]}
    return {
        "items": items,
        "areas": [
            {"id": s, "title": TEMPLATE["sections"][s]["title"]}
            for s in CHECKLIST["template_sections"]
        ],
        "hazards": [
            {
                "id": h["id"],
                "name": h["name"],
                "standards": h["standards"],
                "in_scope": named_in_scope(h),
            }
            for h in hazards
        ],
        "sources": {
            ref: {"text": passage["text"], **(passage["metadata"] or {})}
            for ref, passage in given.items()
            if ref in cited
        },
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.CHECKLIST_EFFORT,
            "prompt_version": CHECKLIST_PROMPT_VERSION,
            "checklist_version": CHECKLIST["version"],
            "template_version": TEMPLATE["version"],
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }

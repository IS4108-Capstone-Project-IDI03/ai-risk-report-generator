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
from app.generation.generator import PROMPT_VERSION, TEMPLATE, draft_section, generate
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
    text = " ".join(" ".join([o.note or "", *o.transcripts]) for o in observations)
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
    own = [o for o in observations if o.COPE_dimension in section["cope_dimensions"]]
    return [
        f"{section['title']}: "
        + spell_out(" ".join(" ".join([o.note or "", *o.transcripts]).split()))[:500]
        for o in own[:95]
    ]


def draft(section_id: str, assessment, observations) -> dict:
    """Draft one report section (GN-01): retrieve, generate, check citations.

    Raises KeyError for a section that is not in the template.
    """
    # Filled by the paid calls below (embed, rerank, draft) and returned as `usage`.
    paid_calls = usage.start()
    section = TEMPLATE["sections"][section_id]
    title = section["title"]
    site = {"jurisdiction": assessment.jurisdiction, "facility_type": assessment.facility_type}
    evidence = _evidence_summary(
        [o for o in observations if o.COPE_dimension in section["cope_dimensions"]]
    )

    # One batched search: standards for each of the section's observations, then past
    # reports for the section as a whole. Past reports are filtered by country only:
    # their wording and judgements carry across facility types, and few reports share
    # one site's type.
    *per_observation, past = search(
        [
            (query, {**site, "source_type": STANDARD_SOURCES}, STANDARDS_PER_OBSERVATION)
            for query in standard_queries(section, observations)
        ]
        + [
            (
                f"{title}: {evidence}",
                {"jurisdiction": assessment.jurisdiction, "source_type": "marsh_report"},
                20,
            )
        ]
    )

    # Each observation's nearest passage first, then the next nearest, so if rerank
    # fails the cap below still keeps every observation's nearest.
    standards: dict[str, dict] = {}
    per_observation = [
        [h for h in hits if h.get("distance", 0) <= MAX_STANDARD_DISTANCE]
        for hits in per_observation
    ]
    for rank in range(STANDARDS_PER_OBSERVATION):
        for hits in per_observation:
            if rank < len(hits):
                standards.setdefault(hits[rank]["id"], hits[rank])

    # Past reports' passages under the same section heading, as wording and precedent.
    precedents = [
        chunk
        for chunk in past
        if any(title.lower() in h.lower() for h in (chunk["metadata"] or {}).get("headings") or [])
    ]

    # One rerank call for both kinds (AC14), against the section's own observations.
    # A failed rerank (e.g. the trial key's 10 calls a minute) keeps the order above
    # rather than failing the draft.
    candidates = [*standards.values(), *precedents]
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
        observations,
        list(standards.values()),
        precedents,
        config.LLM_EFFORT,
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
    citable = {f"O:{o.id}" for o in observations} | {f"C:{cid}" for cid in standards}
    guardrail = check_citations(subsections, citable)

    # The cited passages, so the reviewer can open each one (RV-01 AC7). A cited past-report
    # passage is kept too, although it cannot support the statement that cites it.
    cited = {c for sub in subsections for s in sub["statements"] for c in s["citations"]}
    passages = {f"C:{cid}": chunk for cid, chunk in standards.items()} | {
        f"P:{chunk['id']}": chunk for chunk in precedents
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
        "questions": result.questions[:3],
        "sources": sources,
        "guardrail": guardrail,
        "usage": paid_calls,
        "provenance": {
            "provider": config.LLM_PROVIDER,
            "model": model,
            "effort": config.LLM_EFFORT,
            "prompt_version": PROMPT_VERSION,
            "template_version": TEMPLATE["version"],
            "generated_at": datetime.now(UTC).isoformat(),
        },
    }

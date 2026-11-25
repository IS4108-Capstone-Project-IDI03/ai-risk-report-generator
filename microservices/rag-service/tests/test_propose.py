"""AS-04: drafting or rewriting text for a report section from the Ask tab. Search, rerank and
the model are mocked; the proposal runs through the orchestrator's retrieve -> assemble ->
generate -> guardrail steps, as an answer does (AS-01)."""

import json

from fastapi.testclient import TestClient

from app import config
from app.generation import propose as proposing
from app.main import app

client = TestClient(app)

REQUEST = {
    "question": "Draft a paragraph on flood exposure from the observations",
    "assessment": {"reference": "RPT-2026-0001", "jurisdiction": "SG", "facility_type": "Office"},
    "observations": [
        {
            "id": "obs1",
            "COPE_dimension": ["Exposure"],
            "note": "Basement car park flooded in 2024 to 300 mm; no flood barriers at ramps.",
            "severity": "high",
            "location": "Block A, Basement 1",
        },
        {"id": "obs2", "COPE_dimension": ["Exposure"], "note": "Site is 2 m above the canal."},
    ],
    "standard_ids": ["fm1-40"],
    "documents": [{"id": "fm1-40", "name": "FM Global 1-40 (2026)"}],
    "propose": {
        "kind": "draft",
        "section_id": "10",
        "section_title": "10. Exposures",
        "subsections": [
            {"index": 0, "heading": "Natural Hazards"},
            {"index": 2, "heading": "Adjacent Exposures"},
        ],
    },
}
STANDARD = {
    "id": "fm1-40:7",
    "text": "Flood barriers shall be provided at openings below the design flood elevation.",
    "metadata": {"doc_id": "fm1-40", "headings": ["Flood"], "page_start": 7, "page_end": 7},
}
REPORT = {
    "id": "rep:9",
    "text": "The basement flooded once.",
    "metadata": {"doc_id": "rep", "headings": ["Exposures"], "page_start": 3},
}


def run(monkeypatch, lines, request=REQUEST):
    """Proposes through the route; returns the events and what search, rerank and the model got."""
    sent = {"search": [], "rerank": [], "prompts": [], "stream": []}

    def search(requests, protection=None):
        sent["search"].extend(requests)
        return [
            [REPORT] if f.get("source_type") == "marsh_report" else [STANDARD]
            for _, f, _ in requests
        ]

    def rerank(query, passages, top_n=None):
        sent["rerank"].append((query, [p["text"] for p in passages]))
        return [{**p, "relevance_score": 0.9} for p in passages]

    def stream_text(system, messages, *, provider, model, effort, feature):
        sent["stream"].append(
            {"provider": provider, "model": model, "effort": effort, "feature": feature}
        )
        sent["prompts"].append(system + "\n" + messages[-1]["content"])
        for line in lines:
            # Split mid-line, as a stream does.
            yield line[:5]
            yield line[5:] + "\n"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.orchestrator.orchestrator.rerank", rerank)
    monkeypatch.setattr("app.orchestrator.orchestrator.stream_text", stream_text)
    response = client.post("/assessments/ask", json=request)
    assert response.status_code == 200
    events = [json.loads(b[6:]) for b in response.text.split("\n\n") if b.startswith("data: ")]
    return events, sent


def result_of(events):
    assert events[-1]["type"] == "result"
    return events[-1]["value"]


def test_a_draft_names_its_subsection_and_streams_each_sentence_marked(monkeypatch):
    events, sent = run(
        monkeypatch,
        [
            "Subsection: Natural Hazards",
            "The basement car park flooded in 2024 to a depth of 300 mm. [O1]",
            'No flood barriers were provided at the ramps [O1] [C1 "Flood barriers shall be '
            'provided"].',
            "Flooding is a common hazard in the region.",
        ],
    )

    assert [e["type"] for e in events] == [
        "step",
        "step",
        "target",
        "statement",
        "statement",
        "statement",
        "result",
    ]
    assert events[2] == {"type": "target", "subsection": 0}
    result = result_of(events)
    assert result["target"] == 0
    assert [(s["text"], s["supported"], s["paragraph"]) for s in result["statements"]] == [
        ("The basement car park flooded in 2024 to a depth of 300 mm.", True, 0),
        ("No flood barriers were provided at the ramps.", True, 0),
        # Kept, marked unsupported, so the engineer sees it and the export waits (AC3).
        ("Flooding is a common hazard in the region.", False, 0),
    ]
    assert [c["ref"] for c in result["statements"][1]["citations"]] == ["O:obs1", "C:fm1-40:7"]
    assert result["statements"][2]["citations"] == []
    assert set(result["sources"]) == {"O:obs1", "C:fm1-40:7"}
    # A proposal is judged sentence by sentence, with no confidence of its own.
    assert result["confidence"] is None
    trace = result["trace"]
    assert trace["story"] == "AS-04"
    assert trace["prompt_version"] == proposing.PROMPT_VERSION
    assert trace["propose"] == {"kind": "draft", "section_id": "10", "subsections": 2, "target": 0}
    assert trace["guardrail"]["unsupported"] == 1
    assert trace["guardrail"]["passed"] is False
    # The provider from LLM_PROVIDER, Ask's model at the proposal's effort.
    assert sent["stream"] == [
        {
            "provider": config.LLM_PROVIDER,
            "model": config.ASK_MODEL,
            "effort": config.PROPOSE_EFFORT,
            "feature": "ask",
        }
    ]
    # The prompt holds the subsections, the drafting guide and the request last.
    prompt = sent["prompts"][0]
    assert "<subsections>\nNatural Hazards\nAdjacent Exposures\n</subsections>" in prompt
    assert "Singapore English" in prompt
    assert prompt.rstrip().endswith(f"Request: {REQUEST['question']}")


def test_only_the_drafting_set_is_searched_never_past_reports(monkeypatch):
    _, sent = run(monkeypatch, ["The basement flooded. [O1]"])

    assert [f for _, f, _ in sent["search"]] == [{"doc_id": ["fm1-40"]}]
    assert "<past_reports>" not in sent["prompts"][0]
    # With no standard in the drafting set, nothing is searched at all.
    _, sent = run(monkeypatch, ["The basement flooded. [O1]"], {**REQUEST, "standard_ids": []})
    assert sent["search"] == []


def test_a_citation_that_does_not_count_leaves_the_sentence_unsupported(monkeypatch):
    events, _ = run(
        monkeypatch,
        [
            # A quote that is not in the passage, and a label it was never given (AC4).
            'Flood barriers are required at every door [C1 "barriers at every door"].',
            "The ramps have no barriers. [P1]",
            "The site sits 2 m above the canal. [O2] [C9]",
        ],
    )

    result = result_of(events)
    assert [(s["supported"], [c["ref"] for c in s["citations"]]) for s in result["statements"]] == [
        (False, []),
        (False, []),
        (True, ["O:obs2"]),
    ]
    assert result["trace"]["guardrail"]["uncounted_citations"] == 3


def test_blank_lines_start_paragraphs_and_off_rule_lines_never_show(monkeypatch):
    events, _ = run(
        monkeypatch,
        [
            "The basement car park flooded in 2024. [O1]",
            "",
            "",
            "I would recommend flood barriers. [O1]",
            "The site sits 2 m above the canal. [O2]",
            "Subsection: Adjacent Exposures",
            "Missing: no observation records the design flood elevation.",
        ],
    )

    result = result_of(events)
    assert [(s["text"], s["paragraph"]) for s in result["statements"]] == [
        ("The basement car park flooded in 2024.", 0),
        ("The site sits 2 m above the canal.", 1),
    ]
    assert result["missing"] == ["no observation records the design flood elevation."]
    # A Subsection line after the text has started is not where it goes.
    assert result["target"] is None
    reasons = [d["reason"] for d in result["trace"]["guardrail"]["dropped"]]
    assert reasons == ["first_person", "subsection"]


def test_a_subsection_not_offered_names_none():
    subsections = [(0, "Natural Hazards"), (2, "Adjacent Exposures")]
    assert proposing.subsection_of("Subsection: natural  hazards.", subsections) == 0
    assert proposing.subsection_of("**Subsection:** Adjacent Exposures", subsections) == 2
    assert proposing.subsection_of("Subsection: Construction", subsections) is None
    assert proposing.subsection_of("The basement flooded. [O1]", subsections) is False


REWRITE = {
    **REQUEST,
    "question": "Make this more concise",
    "passage": {
        "section_id": "10",
        "section_title": "10. Exposures",
        "text": "The car park in the basement was flooded in the year 2024, to 300 mm.",
        "citations": ["O:obs1", "C:fm1-40:7", "P:rep:9"],
        "sources": [
            {"id": "fm1-40:7", "kind": "standard", **{k: STANDARD[k] for k in ("text",)}},
            {"id": "rep:9", "kind": "report", "text": REPORT["text"]},
        ],
    },
    "propose": {"kind": "rewrite", "section_id": "10", "section_title": "10. Exposures"},
}


def test_a_rewrite_shows_the_paragraphs_and_cites_no_past_report(monkeypatch):
    events, sent = run(
        monkeypatch,
        [
            "Subsection: Natural Hazards",
            "The basement car park flooded in 2024 to 300 mm. [O1] [P1]",
        ],
        REWRITE,
    )

    result = result_of(events)
    assert [(s["text"], s["supported"]) for s in result["statements"]] == [
        ("The basement car park flooded in 2024 to 300 mm.", True)
    ]
    assert [c["ref"] for c in result["statements"][0]["citations"]] == ["O:obs1"]
    assert "target" in result and result["target"] is None
    prompt = sent["prompts"][0]
    assert (
        "<passage>\nThe car park in the basement was flooded in the year 2024, to 300 mm.\n"
        "</passage>" in prompt
    )
    # What the passage cites is evidence first, but never a past report (AC4).
    assert "cited by the passage" in prompt
    assert "The basement flooded once." not in prompt
    assert result["trace"]["story"] == "AS-04"
    assert result["trace"]["passage"]["citations"] == ["O:obs1", "C:fm1-40:7"]
    assert all(f.get("source_type") != "marsh_report" for _, f, _ in sent["search"])


def test_a_rewrite_needs_its_passage():
    response = client.post(
        "/assessments/ask", json={k: v for k, v in REWRITE.items() if k != "passage"}
    )
    assert response.status_code == 422


def test_no_model_is_asked_when_nothing_in_scope_is_relevant(monkeypatch):
    request = {**REQUEST, "observations": [], "standard_ids": []}
    events, sent = run(monkeypatch, ["The basement flooded. [O1]"], request)

    result = result_of(events)
    assert sent["stream"] == []
    assert result["statements"] == []
    assert result["missing"] == [proposing.nothing_found(0, 0)]


def test_a_draft_is_shown_the_section_as_it_reads_now_masked(monkeypatch, fake_privacy):
    # Without the section's text the model repeated what it already said (live, 26 Nov).
    request = {
        **REQUEST,
        "privacy": {"enabled": True, "known_entities": [{"type": "CLIENT", "names": ["Acme"]}]},
        "propose": {**REQUEST["propose"], "section_text": "Acme's basement flooded in 2024."},
    }
    _, sent = run(
        monkeypatch,
        ["Subsection: Natural Hazards", "The site is 2 m above the canal. [O2]"],
        request,
    )
    prompt = sent["prompts"][0]
    assert "<section_text>\n[CLIENT_1]'s basement flooded in 2024.\n</section_text>" in prompt
    assert "Acme" not in prompt
    assert "Do not repeat what it already says" in prompt


def test_a_draft_of_an_empty_section_says_so(monkeypatch):
    _, sent = run(monkeypatch, ["Subsection: Natural Hazards", "The site is 2 m up. [O2]"])
    assert "<section_text>\n(empty)\n</section_text>" in sent["prompts"][0]

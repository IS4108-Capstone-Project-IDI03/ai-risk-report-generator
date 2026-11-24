"""AS-08: what one section of the report should cover, from the report template's definition of
it and the selected standards. Search, rerank and the model are mocked; the answer runs through
the orchestrator's retrieve -> assemble -> generate -> guardrail steps, as an Ask answer does."""

import json

from fastapi.testclient import TestClient

from app.generation import guide as guiding
from app.generation.llm import GenerationFailed
from app.main import app

client = TestClient(app)

REQUEST = {
    "question": "What should 7. Construction cover?",
    "assessment": {"reference": "RPT-2026-0001", "jurisdiction": "SG", "facility_type": "Office"},
    # The gateway sends no observations for writing guidance.
    "observations": [],
    "standard_ids": ["fm14"],
    "documents": [{"id": "fm14", "name": "FM Global 1-1 (2026)"}],
    "guide": {"kind": "cover", "section_id": "7", "section_title": "7. Construction"},
}
WALLS = {
    "id": "fm14:3",
    "text": "Fire walls shall be constructed of noncombustible materials.",
    "metadata": {"doc_id": "fm14", "headings": ["Fire walls"], "page_start": 3, "page_end": 3},
}


def run(monkeypatch, lines, request=REQUEST, hits=None, scores=None, fail_at=None):
    """Asks through the route; returns the events and what search, rerank and the model got."""
    sent = {"search": [], "rerank": [], "prompts": [], "stream": []}

    def search(requests, protection=None):
        sent["search"].extend(requests)
        return [list(hits if hits is not None else [WALLS]) for _ in requests]

    def rerank(query, passages, top_n=None):
        sent["rerank"].append((query, [p["id"] for p in passages]))
        return [{**p, "relevance_score": (scores or {}).get(p["id"], 0.9)} for p in passages]

    def stream_text(system, messages, *, provider, model, effort, feature):
        sent["stream"].append({"provider": provider, "feature": feature, "effort": effort})
        sent["prompts"].append(system + "\n" + messages[-1]["content"])
        for n, line in enumerate(lines):
            if fail_at == n:
                raise GenerationFailed("The language model could not be reached.")
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


def test_the_template_defines_the_section_as_a_whole_then_each_part():
    parts = guiding.template_parts("9", "9. Fire Protection")
    assert [p["id"] for p in parts[:3]] == ["9", "9.0", "9.1"]
    assert parts[0]["text"].startswith("Section 9. Fire Protection. Evidence: the observations")
    assert "tagged Protection" in parts[0]["text"]
    assert parts[1]["text"] == (
        "Automatic Sprinkler Protection: a table completed from measured values."
    )
    alarm = parts[-1]
    assert alarm["metadata"] == {
        "section_id": "9",
        "section_title": "9. Fire Protection",
        "subsection": 13,
        "heading": "Fire Alarm Details",
        "kind": "fields",
        "fields": [
            "Alarm Signaling Services",
            "Fire Panel Model / Manufacturer",
            "Alarm Signals Monitored",
        ],
    }
    assert alarm["text"].endswith(
        "with the fields Alarm Signaling Services, "
        "Fire Panel Model / Manufacturer, Alarm Signals Monitored."
    )
    # Sections 4 and 5 say whose their figures are.
    assert "the engineer's figures" in guiding.template_parts("4", "4. Risk")[0]["text"]
    assert guiding.template_parts("1", "1. Purpose") == []


def test_an_answer_cites_the_template_and_the_standards_and_leaves_one_trace(monkeypatch):
    events, sent = run(
        monkeypatch,
        [
            "Section 7 holds the observations tagged Construction, in four parts. [T1]",
            "Construction Table is a table completed from measured values. [T3]",
            'FM Global 1-1 requires fire walls of noncombustible materials [C1 "constructed of '
            'noncombustible materials"].',
        ],
    )

    assert [e["type"] for e in events] == [
        "step",
        "step",
        "statement",
        "statement",
        "statement",
        "result",
    ]
    result = result_of(events)
    assert [s["text"] for s in result["statements"]] == [
        "Section 7 holds the observations tagged Construction, in four parts.",
        "Construction Table is a table completed from measured values.",
        "FM Global 1-1 requires fire walls of noncombustible materials.",
    ]
    assert result["statements"][1]["citations"] == [
        {"ref": "T:7.1", "kind": "template", "quote": None, "verified": True, "described": False}
    ]
    # A template part's source says which part it is, so the review workspace can go to it.
    assert result["sources"]["T:7.1"] == {
        "text": "Construction Table: a table completed from measured values.",
        "section_id": "7",
        "section_title": "7. Construction",
        "subsection": 1,
        "heading": "Construction Table",
        "kind": "table",
        "fields": [],
    }
    assert result["sources"]["C:fm14:3"]["page_start"] == 3
    assert result["confidence"] == "high"
    trace = result["trace"]
    assert trace["story"] == "AS-08"
    assert trace["prompt_version"] == guiding.PROMPT_VERSION
    assert trace["pipeline"] == ["retrieve", "assemble", "generate", "guardrail"]
    assert trace["guide"] == {
        "kind": "cover",
        "section_id": "7",
        "template_parts": 5,
        "template_parts_cited": 2,
    }
    assert trace["retrieved"]["template"] == ["T:7", "T:7.0", "T:7.1", "T:7.2", "T:7.3"]
    assert trace["retrieved"]["standards"] == ["fm14:3"]
    assert trace["scope"]["observations"] == 0
    assert sent["stream"][0]["feature"] == "ask"
    # The prompt holds the labelled template and the named standard.
    prompt = sent["prompts"][0]
    assert "[T3] Construction Table: a table completed from measured values." in prompt
    assert "FM Global 1-1 (2026) > Fire walls, p. 3-3" in prompt


def test_only_the_selected_standards_are_searched_once_per_part(monkeypatch):
    _, sent = run(monkeypatch, ["Section 7 holds four parts. [T1]"])

    # The section as a whole, then each of its four parts; never past reports or observations.
    assert [f for _, f, _ in sent["search"]] == [{"doc_id": ["fm14"]}] * 5
    assert sent["search"][2][0].startswith("Construction Table")
    # The hits are reranked once, together, against the section and its parts.
    assert len(sent["rerank"]) == 1
    assert sent["rerank"][0] == (
        "What the 7. Construction section covers: Construction Narrative, Construction Table, "
        "Compartmentalization and Fire Divisions, Details on Combustible Construction",
        ["fm14:3"],
    )

    # With no standard selected, none is searched, and the answer says so.
    events, sent = run(
        monkeypatch, ["Section 7 holds four parts. [T1]"], {**REQUEST, "standard_ids": []}
    )
    assert sent["search"] == []
    assert result_of(events)["missing"] == [
        "No standards are selected for this assessment, so none was searched."
    ]


def test_a_line_without_a_citation_or_that_advises_is_never_shown(monkeypatch):
    events, _ = run(
        monkeypatch,
        [
            "Fire walls matter for any site.",
            "The engineer should describe each fire wall. [T2]",
            "I see four parts. [T1]",
            "Section 7 has four parts. [T1]",
            "Missing: no selected standard has a passage on combustible construction.",
        ],
    )

    result = result_of(events)
    assert [s["text"] for s in result["statements"]] == ["Section 7 has four parts."]
    assert [d["reason"] for d in result["trace"]["guardrail"]["dropped"]] == [
        "uncited",
        "recommendation",
        "first_person",
    ]
    assert result["missing"] == ["no selected standard has a passage on combustible construction."]
    assert result["confidence"] == "low"


def test_a_standard_scoring_below_the_floor_is_left_out(monkeypatch):
    events, sent = run(monkeypatch, ["Section 7 holds four parts. [T1]"], scores={"fm14:3": 0.01})
    result = result_of(events)
    assert result["trace"]["retrieved"]["standards"] == []
    assert "<standards>\n(none)\n</standards>" in sent["prompts"][0]
    assert result["missing"][0].startswith("It found no passage on this section")


def test_a_failure_states_its_cause_and_keeps_what_was_said(monkeypatch):
    events, _ = run(
        monkeypatch,
        ["Section 7 holds four parts. [T1]", "Construction Table is a table. [T3]"],
        fail_at=1,
    )
    result = result_of(events)
    assert [s["text"] for s in result["statements"]] == ["Section 7 holds four parts."]
    assert result["error"]["step"] == "generate"
    assert result["error"]["cause"] == "the model provider did not respond"


def test_guidance_is_asked_on_its_own_and_only_for_sections_4_to_12(monkeypatch):
    with_passage = {
        **REQUEST,
        "passage": {"section_id": "7", "section_title": "7. Construction", "text": "Walls."},
    }
    assert client.post("/assessments/ask", json=with_passage).status_code == 422
    section_2 = {**REQUEST, "guide": {**REQUEST["guide"], "section_id": "2"}}
    assert client.post("/assessments/ask", json=section_2).status_code == 422

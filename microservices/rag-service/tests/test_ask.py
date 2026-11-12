"""AS-01: asking a question about one assessment. Search, rerank and the model are mocked; the
answer runs through the orchestrator's retrieve -> assemble -> generate -> guardrail steps."""

import json

from fastapi.testclient import TestClient

from app import config
from app.generation import ask as asking
from app.generation.llm import GenerationFailed
from app.main import app

client = TestClient(app)

REQUEST = {
    "question": "Was the B1 sprinkler control valve found shut?",
    "assessment": {"reference": "RPT-2026-0001", "jurisdiction": "SG", "facility_type": "Office"},
    "observations": [
        {
            "id": "obs1",
            "COPE_dimension": ["Protection"],
            "note": "B1 sprinkler control valve found shut, no tamper switch.",
            "severity": "high",
            "location": "Block A, Basement 1, Pump room",
        },
        # Uncategorised observations are asked about too (CP-02: null, never []).
        {"id": "obs2", "COPE_dimension": None, "note": "Lobby lights flicker."},
        # Nothing recorded: not usable evidence.
        {"id": "obs3", "COPE_dimension": ["Occupancy"]},
    ],
    "standard_ids": ["fm25"],
    "documents": [{"id": "fm25", "name": "FM Global 2-81 (2026)"}],
}
STANDARD = {
    "id": "fm25:4",
    "text": "Sprinkler control valves shall be supervised in the open position.",
    "metadata": {"doc_id": "fm25", "headings": ["Valves"], "page_start": 4, "page_end": 4},
}
REPORT = {
    "id": "rep:9",
    "text": "The control valve was locked open with a chain.",
    "metadata": {"doc_id": "rep", "headings": ["Fire Protection"], "page_start": 12},
}


def run(monkeypatch, lines, request=REQUEST, scores=None, fail_at=None):
    """Asks through the route; returns the events and what search, rerank and the model got."""
    sent = {"search": [], "rerank": [], "prompts": [], "stream": []}

    def search(requests, protection=None):
        sent["search"].extend(requests)
        return [
            [REPORT] if f.get("source_type") == "marsh_report" else [STANDARD]
            for _, f, _ in requests
        ]

    def rerank(query, passages, top_n=None):
        sent["rerank"].append((query, [p["text"] for p in passages]))
        return [{**p, "relevance_score": (scores or {}).get(p["id"], 0.9)} for p in passages]

    def stream_text(system, messages, *, provider, model, effort, feature):
        sent["stream"].append({"provider": provider, "model": model, "feature": feature})
        sent["prompts"].append(system + "\n" + messages[-1]["content"])
        for n, line in enumerate(lines):
            if fail_at == n:
                raise GenerationFailed("The language model could not be reached.")
            # Split mid-line, as a stream does.
            yield line[:7]
            yield line[7:] + "\n"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.orchestrator.orchestrator.rerank", rerank)
    monkeypatch.setattr("app.orchestrator.orchestrator.stream_text", stream_text)
    response = client.post("/assessments/ask", json=request)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    events = [json.loads(b[6:]) for b in response.text.split("\n\n") if b.startswith("data: ")]
    return events, sent


def result_of(events):
    assert events[-1]["type"] == "result"
    return events[-1]["value"]


def test_an_answer_streams_cited_statements_and_ends_with_one_trace(monkeypatch):
    events, sent = run(
        monkeypatch,
        [
            "The B1 sprinkler control valve was found shut. [O1]",
            'FM Global 2-81 requires such valves to be supervised open [C1 "supervised in the '
            'open position"].',
        ],
    )

    assert [e["type"] for e in events] == [
        "step",
        "step",
        "statement",
        "statement",
        "result",
    ]
    assert events[1] == {
        "type": "step",
        "step": "generate",
        "found": {"observations": 2, "standards": 1, "reports": 1},
    }
    result = result_of(events)
    assert [s["text"] for s in result["statements"]] == [
        "The B1 sprinkler control valve was found shut.",
        "FM Global 2-81 requires such valves to be supervised open.",
    ]
    assert result["statements"][1]["citations"] == [
        {
            "ref": "C:fm25:4",
            "kind": "standard",
            "quote": "supervised in the open position",
            "verified": True,
        }
    ]
    assert set(result["sources"]) == {"O:obs1", "C:fm25:4"}
    # Each statement brings its own sources, so a citation opens while the answer is written.
    first, second = [e for e in events if e["type"] == "statement"]
    assert set(first["sources"]) == {"O:obs1"}
    assert first["sources"]["O:obs1"]["note"].startswith("B1 sprinkler control valve")
    assert set(second["sources"]) == {"C:fm25:4"}
    assert result["sources"]["C:fm25:4"]["page_start"] == 4
    assert result["confidence"] == "high"
    assert result["error"] is None
    trace = result["trace"]
    assert trace["pipeline"] == ["retrieve", "assemble", "generate", "guardrail"]
    assert trace["prompt_version"] == asking.PROMPT_VERSION
    assert trace["retrieved"] == {
        "observations": ["obs1", "obs2"],
        "standards": ["fm25:4"],
        "reports": ["rep:9"],
    }
    assert trace["guardrail"]["passed"] is True
    # The named document reaches the prompt, so the model can name it.
    assert "FM Global 2-81 (2026) > Valves, p. 4-4" in sent["prompts"][0]


def test_retrieval_is_limited_to_the_selected_standards_and_matching_past_reports(monkeypatch):
    _, sent = run(monkeypatch, ["The valve was shut. [O1]"])

    filters = [f for _, f, _ in sent["search"]]
    assert filters == [
        {"doc_id": ["fm25"]},
        {"jurisdiction": "SG", "facility_type": "Office", "source_type": "marsh_report"},
    ]

    # With no standard selected, no standard is searched at all.
    _, sent = run(monkeypatch, ["The valve was shut. [O1]"], {**REQUEST, "standard_ids": []})
    assert [f for _, f, _ in sent["search"]] == [
        {"jurisdiction": "SG", "facility_type": "Office", "source_type": "marsh_report"}
    ]


def test_an_uncited_or_off_rule_line_is_never_shown(monkeypatch):
    events, _ = run(
        monkeypatch,
        [
            "Sprinklers are generally reliable.",
            "I found the valve shut. [O1]",
            "The client should install a tamper switch. [O1]",
            "The valve was shut. [O1] 🚨",
            "The valve was 90% confidently shut. [O1]",
        ],
    )

    result = result_of(events)
    assert [s["text"] for s in result["statements"]] == ["The valve was shut."]
    assert [(d["text"], d["reason"]) for d in result["trace"]["guardrail"]["dropped"]] == [
        ("Sprinklers are generally reliable.", "uncited"),
        ("I found the valve shut.", "first_person"),
        ("The client should install a tamper switch.", "recommendation"),
        ("The valve was 90% confidently shut.", "percentage"),
    ]
    # Something was left out, so the answer is not of high confidence.
    assert result["confidence"] == "low"
    shown = [e for e in events if e["type"] == "statement"]
    assert [e["text"] for e in shown] == ["The valve was shut."]


def test_when_nothing_supports_an_answer_it_says_what_is_missing(monkeypatch):
    events, _ = run(
        monkeypatch,
        [
            "Missing: no observation records when the fire pump was last tested.",
            "Fire pumps are tested weekly.",
        ],
    )

    result = result_of(events)
    assert result["statements"] == []
    assert result["missing"] == ["no observation records when the fire pump was last tested."]
    assert result["declined"] is True
    assert result["confidence"] is None

    # Every line dropped: the answer still says evidence is missing, and cites nothing.
    events, _ = run(monkeypatch, ["Fire pumps are tested weekly."])
    result = result_of(events)
    assert result["statements"] == []
    assert result["missing"] == [asking.NO_SUPPORTED_ANSWER]


def test_no_model_is_asked_when_nothing_in_scope_is_relevant(monkeypatch):
    low = {"O:obs1": 0.01, "O:obs2": 0.01, "fm25:4": 0.02, "rep:9": 0.0}
    events, sent = run(monkeypatch, ["unused"], scores=low)

    assert sent["stream"] == []
    result = result_of(events)
    assert result["missing"] == [
        "It found nothing on this in the assessment's 2 observations, 1 selected standard, "
        "or past reports on Office sites in SG."
    ]
    assert result["trace"]["model"] is None


def test_the_provider_comes_from_llm_provider(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "openai")
    monkeypatch.setattr(config, "ASK_MODEL", "some-model")
    _, sent = run(monkeypatch, ["The valve was shut. [O1]"])

    assert sent["stream"] == [{"provider": "openai", "model": "some-model", "feature": "ask"}]


def test_a_failure_states_its_cause_and_keeps_the_answer_so_far(monkeypatch):
    events, _ = run(
        monkeypatch,
        ["The valve was shut. [O1]", "The lights flicker. [O2]"],
        fail_at=1,
    )

    result = result_of(events)
    assert [s["text"] for s in result["statements"]] == ["The valve was shut."]
    assert result["error"]["cause"] == "the model provider did not respond"
    assert result["error"]["step"] == "generate"
    # What was shown before it stopped can still be opened.
    assert set(result["sources"]) == {"O:obs1"}
    assert result["error"]["at"]
    assert result["declined"] is False


def test_a_quote_not_in_its_passage_is_marked_unverified(monkeypatch):
    events, _ = run(monkeypatch, ['Valves must be locked [C1 "locked with a padlock"].'])

    result = result_of(events)
    [statement] = result["statements"]
    assert statement["citations"][0]["verified"] is False
    assert result["confidence"] == "low"
    assert result["trace"]["guardrail"]["unverified_citations"] == 1


def test_no_client_detail_reaches_cohere_or_the_model(monkeypatch, fake_privacy):
    request = {
        **REQUEST,
        "question": "What did John Tan say about the Acme Holdings valve?",
        "privacy": {
            "enabled": True,
            "known_entities": [
                {"type": "CLIENT", "names": ["Acme Holdings"]},
                {"type": "PERSON", "names": ["John Tan"]},
            ],
        },
        "observations": [
            {
                "id": "obs1",
                "COPE_dimension": ["Protection"],
                "note": "John Tan says the Acme Holdings valve was shut.",
            }
        ],
    }
    events, sent = run(
        monkeypatch, ["[PERSON_1] reported the valve shut at [CLIENT_1]. [O1]"], request
    )

    payloads = (
        [q for q, _, _ in sent["search"]]
        + [t for q, texts in sent["rerank"] for t in [q, *texts]]
        + sent["prompts"]
    )
    for payload in payloads:
        assert "John Tan" not in payload and "Acme Holdings" not in payload, payload
    result = result_of(events)
    assert result["statements"][0]["text"] == "John Tan reported the valve shut at Acme Holdings."
    assert result["trace"]["privacy"]["enabled"] is True


def test_parse_line_reads_citations_wherever_they_sit():
    assert asking.parse_line('- The valve was shut [O1, C2] and [P1 "chained open"].') == (
        "The valve was shut and.",
        [("O1", None), ("C2", None), ("P1", "chained open")],
        False,
    )
    assert asking.parse_line("**Missing:** no record of the pump test.") == (
        "no record of the pump test.",
        [],
        True,
    )
    assert asking.content_problem("A Class I standpipe serves Level 2.") is None
    assert asking.content_problem("We noted the valve.") == "first_person"


# AS-02: a question about a passage the engineer selected in the draft.
PUMP = {
    "id": "fm37:2",
    "text": "The pump shall deliver a churn pressure of 10 bar at the test header.",
    "metadata": {"doc_id": "fm37", "headings": ["Fire Pumps"], "page_start": 2},
}
PASSAGE = {
    "section_id": "9",
    "section_title": "9. Fire Protection",
    "text": "The fire pump churn pressure was 10 bar.",
    "citations": ["O:pump", "C:fm37:2"],
    "sources": [{"kind": "standard", **PUMP}],
    "findings": [
        {
            "text": "The fire pump churn pressure was 10 bar.",
            "state": "pending",
            "citations": ["O:pump", "C:fm37:2"],
            "in_passage": True,
        },
        {"text": "The B1 valve was found shut.", "state": "accepted", "citations": ["O:obs1"]},
    ],
}
PASSAGE_REQUEST = {
    **REQUEST,
    "question": "Where does this figure come from?",
    "observations": [
        *REQUEST["observations"],
        {
            "id": "pump",
            "COPE_dimension": ["Protection"],
            "note": "Fire pump churn test read 7 bar at the test header.",
            "location": "Pump room",
        },
    ],
    "documents": [*REQUEST["documents"], {"id": "fm37", "name": "FM Global 3-7 (2026)"}],
    "passage": PASSAGE,
}


def test_a_passage_question_shows_the_passage_its_sources_and_the_findings(monkeypatch):
    events, sent = run(
        monkeypatch,
        ["The fire pump test read 7 bar. [O1]", 'FM Global 3-7 sets 10 bar [C1 "10 bar"].'],
        PASSAGE_REQUEST,
    )

    prompt = sent["prompts"][0]
    assert '<passage section="9. Fire Protection">\nThe fire pump churn pressure was 10 bar.' in (
        prompt
    )
    # The sources the passage cites are labelled first and marked, whatever search found.
    assert "[O1] (Pump room; Protection; severity not set; cited by the passage)" in prompt
    assert "[C1] (FM Global 3-7 (2026) > Fire Pumps, p. 2; cited by the passage)" in prompt
    assert "[C2] (FM Global 2-81 (2026) > Valves, p. 4-4)\n" in prompt
    # The section's findings, which say which evidence each cites; never citable themselves.
    assert "- (pending; in the passage; cites O1, C1) The fire pump churn" in prompt
    assert "- (accepted; cites O2) The B1 valve was found shut." in prompt
    # The passage's words are searched with the question; what it cites is not ranked again.
    assert all("The fire pump churn pressure" in q for q, _, _ in sent["search"])
    ranked = [t for _, texts in sent["rerank"] for t in texts]
    assert PUMP["text"] not in ranked
    assert not any(t.startswith("Fire pump churn test") for t in ranked)

    result = result_of(events)
    assert [c["ref"] for s in result["statements"] for c in s["citations"]] == [
        "O:pump",
        "C:fm37:2",
    ]
    assert result["sources"]["C:fm37:2"]["page_start"] == 2
    trace = result["trace"]
    assert trace["story"] == "AS-02"
    assert trace["passage"] == {
        "section_id": "9",
        "chars": len(PASSAGE["text"]),
        "citations": ["O:pump", "C:fm37:2"],
        "findings": 2,
        "findings_in_passage": 1,
    }
    assert trace["retrieved"]["observations"][0] == "pump"
    assert trace["retrieved"]["standards"] == ["fm37:2", "fm25:4"]
    # The trace never holds the passage's words.
    assert "churn pressure was 10 bar" not in json.dumps(trace)


def test_where_the_passages_sources_disagree_it_names_both_and_never_chooses(monkeypatch):
    differs = (
        "Differs: the observation records a churn pressure of 7 bar [O1], while FM Global 3-7 "
        'sets 10 bar [C1 "10 bar"].'
    )
    events, _ = run(
        monkeypatch,
        [
            differs,
            # Naming one side only is not a disagreement.
            "Differs: the observation records 7 bar [O1].",
            # Choosing between them is never shown.
            'The standard is more reliable than the observation [C1 "10 bar"].',
            'The correct figure is 10 bar [C1 "10 bar"].',
            "The observation is likely a typo [O1].",
        ],
        PASSAGE_REQUEST,
    )

    result = result_of(events)
    [statement] = result["statements"]
    assert statement == {
        "text": "the observation records a churn pressure of 7 bar, while FM Global 3-7 sets "
        "10 bar.",
        "citations": [
            {"ref": "O:pump", "kind": "observation", "quote": None, "verified": True},
            {"ref": "C:fm37:2", "kind": "standard", "quote": "10 bar", "verified": True},
        ],
        "differs": True,
    }
    assert [e for e in events if e["type"] == "statement"][0]["differs"] is True
    assert [d["reason"] for d in result["trace"]["guardrail"]["dropped"]] == [
        "one_source",
        "chooses",
        "chooses",
        "chooses",
    ]

    # Sources that disagree make an answer Medium at most, even with every check passed.
    events, _ = run(monkeypatch, [differs], PASSAGE_REQUEST)
    assert result_of(events)["confidence"] == "medium"


def test_a_passage_and_its_findings_are_masked_before_cohere_or_the_model(
    monkeypatch, fake_privacy
):
    request = {
        **PASSAGE_REQUEST,
        "privacy": {
            "enabled": True,
            "known_entities": [
                {"type": "CLIENT", "names": ["Acme Holdings"]},
                {"type": "PERSON", "names": ["John Tan"]},
            ],
        },
        "passage": {
            **PASSAGE,
            "text": "John Tan said the Acme Holdings pump read 10 bar.",
            "findings": [{**PASSAGE["findings"][0], "text": "Acme Holdings pump: 10 bar."}],
        },
    }
    _, sent = run(monkeypatch, ["The pump read 7 bar. [O1]"], request)

    payloads = (
        [q for q, _, _ in sent["search"]]
        + [t for q, texts in sent["rerank"] for t in [q, *texts]]
        + sent["prompts"]
    )
    for payload in payloads:
        assert "John Tan" not in payload and "Acme Holdings" not in payload, payload
    assert "[PERSON_1] said the [CLIENT_1] pump read 10 bar." in sent["prompts"][0]


def test_a_passage_cites_only_what_the_gateway_sent_with_it(monkeypatch):
    # A citation with no source sent is not evidence; nor is a source it does not cite.
    passage = {
        **PASSAGE,
        "citations": ["C:fm37:2", "C:gone:1"],
        "sources": [
            {"kind": "standard", **PUMP},
            {"kind": "report", "id": "rep:3", "text": "Not cited.", "metadata": {}},
        ],
    }
    events, sent = run(
        monkeypatch, ["The valve was shut. [O1]"], {**PASSAGE_REQUEST, "passage": passage}
    )

    prompt = sent["prompts"][0]
    assert "cited by the passage" in prompt
    assert "Not cited." not in prompt
    assert result_of(events)["trace"]["retrieved"]["standards"][0] == "fm37:2"


def test_line_kinds_and_choosing_words():
    assert asking.line_kind("**Differs:** 7 bar [O1] against 10 bar [C1].")[0] == "differs"
    assert asking.line_kind("Sources disagree: 7 bar [O1], 10 bar [C1].")[0] == "differs"
    assert asking.line_kind("- Missing: no test record.") == ("missing", "no test record.")
    assert asking.content_problem("The 2024 figure takes precedence.") == "chooses"
    assert asking.content_problem("The report is outdated.") == "chooses"
    # Facts about what a source says are not choosing.
    assert asking.content_problem("FM Global 2-0 describes the preferred arrangement.") is None
    assert asking.content_problem("The gauge reading was incorrect.") is None
    assert asking.content_problem("The observation records 7 bar; the standard sets 10.") is None

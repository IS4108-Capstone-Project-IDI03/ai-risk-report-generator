"""POST /chat (CB-01): real cited answers, through the stream's events.

The plan model, the answer model and search are faked; nothing paid runs.
"""

import copy
import json

import pytest
from fastapi.testclient import TestClient

from app.chat import answer
from app.main import app

client = TestClient(app)

P1 = {
    "id": "fm:4",
    "text": "Provide at least 18 in. (450 mm) clearance between deflectors and storage.",
    "metadata": {"doc_id": "fm", "page_start": 12, "page_end": 13, "headings": ["2.1"]},
    "relevance_score": 0.9,
}
OLD = {
    "id": "nfpa19:7",
    "text": "The 2019 edition requires 0.20 gpm/ft2.",
    "metadata": {"doc_id": "nfpa19", "page_start": 40, "page_end": 40, "status": "withdrawn"},
    "relevance_score": 0.8,
}

GOOD_ANSWER = [
    "Here is the answer.\n",  # prose before the program, which the server drops
    "root = Answer([s1, s2])\n",
    's1 = Statement("Keep 18 in. between deflectors and storage.", [c1])\n',
    'c1 = Cite("P1", "at least 18 in. (450 mm) clearance")\n',
    's2 = Statement("Racks need more.", [c2])\n',
    'c2 = Cite("P1", "words that are not in the passage")\n',
]


@pytest.fixture
def fake(monkeypatch):
    """Fakes the three paid seams; tests set what each returns and read what each got."""
    calls = {"search": [], "answer": []}
    state = {
        "plan": answer.Plan(kind="search", query="deflector clearance", reply=""),
        "passages": [P1],
        "chunks": GOOD_ANSWER,
        "calls": calls,
    }

    def complete_json(system, user, schema, **kwargs):
        calls.setdefault("plan", []).append(user)
        return state["plan"]

    def retrieve(query, filters=None, include_withdrawn=False, **options):
        calls["search"].append((query, filters, include_withdrawn))
        calls.setdefault("options", []).append(options)
        return state["passages"]

    def stream_text(system, messages, **kwargs):
        calls["answer"].append((system, messages))
        yield from state["chunks"]

    monkeypatch.setattr(answer, "complete_json", complete_json)
    monkeypatch.setattr(answer, "retrieve", retrieve)
    monkeypatch.setattr(answer, "stream_text", stream_text)
    monkeypatch.setattr(answer, "WORD_DELAY_SECONDS", 0)
    return state


def _ask(*turns: str) -> list[dict]:
    roles = ["user", "assistant"] * len(turns)
    body = {
        "threadId": "t1",
        "runId": "r1",
        "tools": [],
        "context": [],
        "messages": [
            {"id": f"m{i}", "role": r, "content": t} for i, (r, t) in enumerate(zip(roles, turns))
        ],
    }
    response = client.post("/chat", json=body)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    return [
        json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")
    ]


def _program(events):
    return "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")


def _result(events):
    return next(e["value"] for e in events if e["type"] == "CUSTOM" and e["name"] == "chat_result")


def _search_result(events):
    return json.loads(next(e for e in events if e["type"] == "TOOL_CALL_RESULT")["content"])


def test_searches_then_streams_a_cited_answer_then_the_check(fake):
    events = _ask("What clearance is needed above storage?")
    types = [e["type"] for e in events]
    # AC8: the search step comes first, the answer streams, the result comes last.
    assert types.index("TOOL_CALL_START") < types.index("TEXT_MESSAGE_START")
    assert types.count("TEXT_MESSAGE_CONTENT") > 3
    assert types[-1] == "CUSTOM"
    program = _program(events)
    assert program.startswith("root = Answer([s1, s2], meta)\n")  # prose dropped, meta joined
    assert program.rstrip().splitlines()[-1].startswith("meta = Meta(")


def test_each_citation_is_checked_against_its_passage(fake):
    result = _result(_ask("What clearance is needed above storage?"))
    good, bad = result["citations"]
    assert good == {
        "label": "P1",
        "passage_id": "fm:4",
        "document_id": "fm",
        "page_start": 12,
        "page_end": 13,
        "quote": "at least 18 in. (450 mm) clearance",
        "verified": True,
        "withdrawn": False,
    }
    assert bad["verified"] is False  # AC2
    assert result["declined"] is False
    assert result["prompt_version"] == answer.PROMPT_VERSION
    # The screen reads the same check from the program's last line.
    assert '"words that are not in the passage"' in _program(_ask("again?")).splitlines()[-1]


def test_passages_reach_the_model_as_labelled_data_not_ids(fake):
    _ask("What clearance is needed above storage?")
    system, messages = fake["calls"]["answer"][0]
    assert "Statement(" in system  # the component prompt shared with the client
    last = messages[-1]["content"]
    assert "[P1]" in last and P1["text"] in last and "fm:4" not in last


def test_declines_without_citations_when_nothing_is_relevant(fake):
    fake["passages"] = [P1 | {"relevance_score": 0.01}]
    events = _ask("What does the knowledge base say about earthquakes?")
    result = _result(events)
    assert result["declined"] is True and result["citations"] == []  # AC3
    assert answer.DECLINE in _program(events)
    assert fake["calls"]["answer"] == []  # no model call to say no


def test_declines_when_the_model_says_the_passages_dont_answer(fake):
    fake["chunks"] = [f'root = Answer([s1])\ns1 = Statement("{answer.DECLINE}", [])\n']
    assert _result(_ask("Something oddly specific?"))["declined"] is True


def test_named_filters_reach_search_and_are_shown(fake):
    fake["plan"] = answer.Plan(
        kind="search",
        query="sprinkler testing",
        filters=answer.Filters(
            jurisdiction="SG", facility_type="Office", source_type="marsh_report"
        ),
        reply="",
    )
    events = _ask("What did Singapore office reports say about sprinkler testing?")
    filters = {"jurisdiction": "SG", "facility_type": "Office", "source_type": "marsh_report"}
    assert fake["calls"]["search"] == [("sprinkler testing", filters, False)]  # AC6
    assert _search_result(events)["filters"] == filters
    assert _result(events)["filters"] == filters


def test_a_named_edition_may_cite_withdrawn_passages_labelled(fake):
    fake["plan"] = answer.Plan(
        kind="search", query="NFPA 13 2019 density", include_withdrawn=True, reply=""
    )
    fake["passages"] = [OLD]
    fake["chunks"] = [
        "root = Answer([s1])\n",
        's1 = Statement("It was 0.20.", [Cite("P1", "requires 0.20 gpm/ft2")])\n',
    ]
    result = _result(_ask("What did the 2019 edition require?"))
    assert fake["calls"]["search"][0][2] is True
    assert result["citations"][0]["withdrawn"] is True  # AC14
    assert "withdrawn edition" in fake["calls"]["answer"][0][1][-1]["content"]


def test_an_ambiguous_follow_up_gets_a_question_back_without_searching(fake):
    fake["plan"] = answer.Plan(
        kind="clarify", query="", reply="Do you mean sprinklers or fire doors?"
    )
    events = _ask("Sprinkler spacing?", "…", "What about 2022?")
    assert fake["calls"]["search"] == [] and fake["calls"]["answer"] == []  # AC5
    assert "Do you mean sprinklers or fire doors?" in _program(events)
    assert _result(events)["citations"] == []


def test_a_request_outside_property_risk_is_declined_without_searching(fake):
    fake["plan"] = answer.Plan(kind="decline", query="", reply="")
    events = _ask("Something with nothing to do with property risk?")
    result = _result(events)
    assert result["declined"] is True and result["citations"] == []  # AC3, AC10
    assert answer.DECLINE in _program(events)
    assert fake["calls"]["search"] == [] and fake["calls"]["answer"] == []


def test_follow_ups_send_the_conversation_as_plain_text(fake):
    earlier = (
        'root = Answer([s1])\ns1 = Statement("Keep 18 in. clear.", [c1])\nc1 = Cite("P1", "x")'
    )
    _ask("What clearance above storage?", earlier, "And for racks?")
    _, messages = fake["calls"]["answer"][0]
    assert [m["role"] for m in messages] == ["user", "assistant", "user"]  # AC4
    assert messages[1]["content"] == "Keep 18 in. clear."


def test_a_model_failure_ends_the_answer_with_a_plain_message(fake, monkeypatch):
    def broken(*args, **kwargs):
        raise answer.GenerationFailed("The language model could not be reached.")
        yield  # pragma: no cover

    monkeypatch.setattr(answer, "stream_text", broken)
    events = _ask("What clearance is needed above storage?")
    assert "could not be reached" in _program(events)
    assert events[-1]["type"] == "CUSTOM"


def test_requires_a_question_from_the_engineer():
    response = client.post("/chat", json={"messages": []})
    assert response.status_code == 422


def test_usage_from_every_step_reaches_the_result(fake, monkeypatch):
    # The server runs each step of the stream on a fresh thread; usage recorded by a
    # later step (search, the answer) must still land in the result for the cost log.
    from app import usage

    def retrieve(query, filters=None, include_withdrawn=False, **options):
        usage.record("retrieval", "cohere-rerank", "rerank-v3.5", 0.0, search_units=1)
        return fake["passages"]

    monkeypatch.setattr(answer, "retrieve", retrieve)
    items = _result(_ask("What clearance is needed above storage?"))["usage"]
    assert [i["billed_service"] for i in items] == ["cohere-rerank"]


# Review fixes (CB-01 Check step).


def _broken_after(chunks, error):
    def stream_text(system, messages, **kwargs):
        yield from chunks
        raise error

    return stream_text


def test_a_search_failure_ends_the_answer_with_a_plain_message(fake, monkeypatch):
    def retrieve(*args, **kwargs):
        raise RuntimeError("Cohere timed out")

    monkeypatch.setattr(answer, "retrieve", retrieve)
    events = _ask("What clearance is needed above storage?")
    assert events[-2]["type"] == "TEXT_MESSAGE_END" and events[-1]["type"] == "CUSTOM"
    assert "couldn't answer" in _program(events)
    assert _result(events)["error"]


def test_a_failure_after_the_answer_started_keeps_one_program_and_its_check(fake, monkeypatch):
    error = answer.GenerationFailed("The model's answer was cut off before it was complete.")
    monkeypatch.setattr(answer, "stream_text", _broken_after(GOOD_ANSWER, error))
    events = _ask("What clearance is needed above storage?")
    program = _program(events)
    assert program.count("root =") == 1  # no second program clobbering the first
    assert program.rstrip().splitlines()[-1].startswith("meta = Meta(")
    assert "cut off" in _result(events)["error"]


def test_a_malformed_earlier_answer_does_not_break_the_follow_up(fake):
    earlier = 'root = Answer([s1])\ns1 = Statement("use 1\\/2 in. \\d pipe", [])'
    _ask("Pipe size?", earlier, "And for racks?")
    assert fake["calls"]["answer"]  # the follow-up was answered


def test_the_question_is_the_engineers_last_message(fake):
    _ask("What clearance is needed above storage?", "An earlier answer.")
    _, messages = fake["calls"]["answer"][0]
    assert messages[-1]["role"] == "user"
    assert messages[-1]["content"].endswith("Question: What clearance is needed above storage?")


def test_a_conversation_without_a_question_gets_a_plain_message(fake):
    response = client.post("/chat", json={"messages": [{"role": "system", "content": "x"}]})
    events = [json.loads(x[6:]) for x in response.text.splitlines() if x.startswith("data: ")]
    assert "couldn't answer" in _program(events) and fake["calls"]["answer"] == []


def test_empty_turns_and_table_programs_reach_the_model_as_text(fake):
    table = (
        "root = Answer([t1], meta)\n"
        't1 = CitedTable(["Edition", "Density"], [[Cell("2019", [c1]), Cell("0.20", [c1])]])\n'
        'c1 = Cite("P1", "x")\nmeta = Meta([], [])'
    )
    _ask("Compare editions", table, "", "", "And 2022?")
    _, messages = fake["calls"]["answer"][0]
    assert all(m["content"] for m in messages)
    assert "meta" not in messages[1]["content"] and "2019" in messages[1]["content"]


def test_unverified_is_marked_per_citation_not_per_quote(fake):
    fake["passages"] = [P1, P1 | {"id": "fm:9", "text": "Something else entirely."}]
    fake["chunks"] = [
        "root = Answer([s1])\n",
        's1 = Statement("Keep 18 in.", [c1, c2])\n',
        'c1 = Cite("P1", "at least 18 in. (450 mm) clearance")\n',
        'c2 = Cite("P2", "at least 18 in. (450 mm) clearance")\n',
    ]
    meta = _program(_ask("Clearance?")).rstrip().splitlines()[-1]
    assert '{label: "P2", quote: "at least 18 in. (450 mm) clearance"}' in meta
    assert '{label: "P1", quote:' not in meta


def test_a_root_split_over_lines_still_reaches_the_check(fake):
    fake["chunks"] = [
        "root = Answer([\n",
        "  s1])\n",
        's1 = Statement("Keep 18 in.", [c1])\n',
        'c1 = Cite("P1", "at least 18 in. (450 mm) clearance")',
    ]
    program = _program(_ask("Clearance?"))
    assert "s1], meta)" in program and "meta = Meta(" in program


def test_a_passage_without_a_document_id_still_gives_a_readable_check(fake):
    fake["passages"] = [P1 | {"metadata": {"page_start": 1, "page_end": 1}}]
    assert 'documentId: ""' in _program(_ask("Clearance?"))


def test_the_check_line_arrives_whole_not_word_by_word(fake, monkeypatch):
    monkeypatch.setattr(answer, "WORD_DELAY_SECONDS", 0.0001)
    events = _ask("Clearance?")
    deltas = [e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT"]
    assert any(d.lstrip().startswith("meta = Meta(") and d.rstrip().endswith(")") for d in deltas)


def _passages(prefix, n):
    return [
        {
            "id": f"{prefix}:{i}",
            "text": f"{prefix} passage {i}.",
            "metadata": {"doc_id": prefix, "page_start": i, "page_end": i},
            "relevance_score": 0.9 - i / 100,
        }
        for i in range(n)
    ]


def test_extra_searches_each_run_and_the_model_gets_the_best_three_of_each(fake, monkeypatch):
    fake["plan"] = answer.Plan(
        kind="search",
        query="NFPA 25 inspection",
        filters=answer.Filters(source_type="nfpa_standard"),
        extra_searches=[
            answer.ExtraSearch(
                query="FM 2-81 inspection", filters=answer.Filters(source_type="fm_standard")
            )
        ],
        reply="",
    )
    nfpa, fm = _passages("nfpa", 5), _passages("fm", 5)
    fm[0] = nfpa[1]  # a repeated passage must reach the model once only

    def retrieve(query, filters=None, include_withdrawn=False, **options):
        fake["calls"]["search"].append((query, filters, include_withdrawn))
        return nfpa if "NFPA" in query else fm

    monkeypatch.setattr(answer, "retrieve", retrieve)
    events = _ask("NFPA 25 or FM 2-81, do they differ?")
    assert fake["calls"]["search"] == [
        ("NFPA 25 inspection", {"source_type": "nfpa_standard"}, False),
        ("FM 2-81 inspection", {"source_type": "fm_standard"}, False),
    ]
    sent = fake["calls"]["answer"][0][1][-1]["content"]
    assert sent.count("[P") == 5  # 3 + 3, minus the repeat
    assert "[P6]" not in sent
    call = next(e for e in events if e["type"] == "TOOL_CALL_ARGS")
    assert json.loads(call["delta"]) == {
        "query": "NFPA 25 inspection",
        "filters": {"source_type": "nfpa_standard"},
        "also": ["FM 2-81 inspection"],
    }
    assert sum(e["type"] == "TOOL_CALL_START" for e in events) == 1


def test_a_plan_without_extra_searches_searches_once_and_keeps_five(fake, monkeypatch):
    def retrieve(query, filters=None, include_withdrawn=False, **options):
        fake["calls"]["search"].append(query)
        return _passages("a", 5)

    monkeypatch.setattr(answer, "retrieve", retrieve)
    events = _ask("What clearance is needed above storage?")
    assert fake["calls"]["search"] == ["deflector clearance"]
    assert fake["calls"]["answer"][0][1][-1]["content"].count("[P") == 5
    call = next(e for e in events if e["type"] == "TOOL_CALL_ARGS")
    assert "also" not in json.loads(call["delta"])


def test_an_old_plan_without_extra_searches_still_validates():
    old = {"kind": "search", "query": "q", "filters": {}, "include_withdrawn": False, "reply": ""}
    assert answer.Plan.model_validate(old).extra_searches == []


# ---- document names (CB-01): the gateway sends each document's details ----------------------

FM_DOC = {
    "id": "fm",
    "title": "Dry pipe systems",
    "issuingBody": "FM Global",
    "standardNumber": "2-81",
    "edition": "2026",
}
NFPA_DOC = {"id": "nfpa19", "title": "NFPA 13", "issuingBody": "NFPA", "standardNumber": "13"}
REPORT_DOC = {"id": "rep", "title": "Orchard Tower survey 2024"}


def test_document_name_is_the_standard_with_its_edition_or_else_the_title():
    assert answer.document_name(FM_DOC) == "FM Global 2-81 (2026)"
    assert answer.document_name(NFPA_DOC) == "NFPA 13"  # no edition: no brackets
    assert answer.document_name(REPORT_DOC) == "Orchard Tower survey 2024"


def test_passages_reach_the_model_labelled_with_their_document_name(fake):
    fake["passages"] = [copy.deepcopy(P1), copy.deepcopy(OLD)]
    body = {"messages": [{"role": "user", "content": "q"}], "documents": [FM_DOC]}
    assert client.post("/chat", json=body).status_code == 200
    last = fake["calls"]["answer"][0][1][-1]["content"]
    assert "[P1] (FM Global 2-81 (2026) > 2.1, p. 12-13)" in last
    # A passage whose document isn't listed keeps today's header.
    assert "[P2] (, p. 40-40, withdrawn edition)" in last


def test_without_documents_the_header_is_unchanged(fake):
    _ask("What clearance is needed above storage?")
    assert "[P1] (2.1, p. 12-13)" in fake["calls"]["answer"][0][1][-1]["content"]


def test_the_name_is_set_on_the_passage_for_the_eval_cache(fake):
    passage = copy.deepcopy(P1)
    fake["passages"] = [passage]
    list(answer.answer_events([{"role": "user", "content": "q"}], [], [FM_DOC]))
    assert passage["metadata"]["document_name"] == "FM Global 2-81 (2026)"


# ---- follow-ups after merge (16 Oct): every report, named documents, follow-up questions ------


def _report(doc: str, score: float) -> dict:
    return {
        "id": f"{doc}:{score}",
        "text": f"{doc} found the fire pump was not run weekly.",
        "metadata": {"doc_id": doc, "page_start": 3, "page_end": 3},
        "relevance_score": score,
    }


def test_report_searches_keep_the_best_passage_of_every_report(fake):
    fake["plan"] = answer.Plan(
        kind="search",
        query="fire pump testing",
        filters=answer.Filters(source_type="marsh_report"),
        reply="",
    )
    # Ranked most relevant first, as search returns them; rep-c is below the cut-off.
    fake["passages"] = [
        _report("rep-a", 0.9),
        _report("rep-a", 0.8),
        _report("rep-b", 0.7),
        _report("rep-d", 0.5),
        _report("rep-c", 0.1),
    ]
    _ask("What did past reports say about fire pump testing?")
    assert fake["calls"]["options"] == [{"candidates": 40, "top_n": None}]
    sent = fake["calls"]["answer"][0][1][-1]["content"]
    assert sent.count("[P") == 3  # one passage each for rep-a, rep-b and rep-d
    assert "rep-a found" in sent and "rep-b found" in sent and "rep-d found" in sent
    assert "rep-c found" not in sent


def test_other_searches_keep_the_default_top_five(fake):
    _ask("What clearance is needed above storage?")
    assert fake["calls"]["options"] == [{"expand": True}]


def test_the_planner_sees_the_documents_it_can_name(fake):
    body = {"messages": [{"role": "user", "content": "q"}], "documents": [FM_DOC, REPORT_DOC]}
    client.post("/chat", json=body)
    planned = fake["calls"]["plan"][0]
    assert "FM Global 2-81 (2026)" in planned and "Orchard Tower survey 2024" in planned


def test_a_named_document_limits_the_search_to_it_and_shows_its_name(fake):
    fake["plan"] = answer.Plan(
        kind="search",
        query="smoke control",
        filters=answer.Filters(source_type="marsh_report", document="orchard tower SURVEY 2024"),
        reply="",
    )
    fake["passages"] = [_report("rep", 0.9)]
    body = {"messages": [{"role": "user", "content": "q"}], "documents": [REPORT_DOC]}
    events = [
        json.loads(line[6:])
        for line in client.post("/chat", json=body).text.splitlines()
        if line.startswith("data: ")
    ]
    assert fake["calls"]["search"][0][1] == {"source_type": "marsh_report", "doc_id": ["rep"]}
    shown = json.loads(next(e for e in events if e["type"] == "TOOL_CALL_ARGS")["delta"])
    assert shown["filters"]["document"] == "orchard tower SURVEY 2024"


def test_an_unknown_document_name_searches_without_it(fake):
    fake["plan"] = answer.Plan(
        kind="search", query="q", filters=answer.Filters(document="No such report"), reply=""
    )
    _ask("q")
    assert fake["calls"]["search"][0][1] == {}


def test_a_follow_up_question_stays_in_the_conversation(fake):
    earlier = (
        "root = Answer([p1, f1])\n"
        'p1 = Paragraph([s1])\ns1 = Statement("Office 1 ran its pump weekly.", [])\n'
        'f1 = FollowUp("Want me to go through the other office reports?")\n'
    )
    _ask("Fire pump testing in office reports?", earlier, "Yes please")
    planned = fake["calls"]["plan"][0]
    assert "Want me to go through the other office reports?" in planned


def test_local_standards_are_a_source_type_filter():
    assert answer.Filters(source_type="local_standard").source_type == "local_standard"


def test_a_local_standard_without_an_issuing_body_is_named_by_its_number():
    doc = {
        "id": "cp",
        "title": "Code of practice for sprinklers",
        "standardNumber": "CP 52",
        "edition": "2004",
    }
    assert answer.document_name(doc) == "CP 52 (2004)"


def test_a_named_report_gets_its_top_passages_not_one(fake):
    fake["plan"] = answer.Plan(
        kind="search",
        query="smoke control",
        filters=answer.Filters(source_type="marsh_report", document="Orchard Tower survey 2024"),
        reply="",
    )
    fake["passages"] = [_report("rep", 0.9), _report("rep", 0.8), _report("rep", 0.7)]
    body = {"messages": [{"role": "user", "content": "q"}], "documents": [REPORT_DOC]}
    client.post("/chat", json=body)
    assert fake["calls"]["options"] == [{"expand": True}]  # the default top 5 of that one report
    assert fake["calls"]["answer"][0][1][-1]["content"].count("[P") == 3


def test_the_meta_line_names_each_passage_id_so_the_panel_can_open_it(fake):
    # CB-02: the citation panel fetches the passage by this id.
    assert f"passageId: {json.dumps(P1['id'])}" in _program(_ask("Clearance?"))

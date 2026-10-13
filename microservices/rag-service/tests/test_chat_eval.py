"""The CB-01 chat eval runner and grader (eval/chat_*.py). Every paid call is faked.

The plan step and search are faked at app.chat.answer's seams; the answer model at the
SDK client (live) or the batch client (batch), so the real pipeline runs in between.
"""

import json
from types import SimpleNamespace as NS

import anthropic
import httpx
import pytest

from app import config, usage
from app.chat import answer
from app.generation import llm
from eval import chat_eval, chat_grade, chat_transport

FM = {"document": "FM.pdf", "pages": [12], "key_phrase": "18 in. (450 mm) clearance"}
P_FM = {
    "id": "fm:4",
    "text": "Provide at least 18 in. (450 mm) clearance between deflectors and storage.",
    "metadata": {"doc_id": "fm", "page_start": 12, "page_end": 13, "headings": ["2.1"]},
    "relevance_score": 0.9,
}
P_OTHER = {
    "id": "nfpa:1",
    "text": "Sprinkler density is 0.20 gpm/ft2 over 1500 ft2.",
    "metadata": {"doc_id": "nfpa", "page_start": 40, "page_end": 40},
    "relevance_score": 0.8,
}
CASES = [
    {
        "id": "a1",
        "tags": ["single_fact", "fm"],
        "turns": [{"user": "What clearance above storage?", "expect": "answer", "gold": FM}],
    },
    {
        "id": "d1",
        "tags": ["near_miss", "fm"],
        "turns": [{"user": "What about earthquakes?", "expect": "decline", "gold": None}],
    },
    {
        "id": "c1",
        "tags": ["coreference", "conversation"],
        "turns": [
            {"user": "What clearance above storage?", "expect": "answer", "gold": FM},
            {
                "user": "And does that apply to racks?",
                "expect": "answer",
                "gold": FM,
                "topic": "storage clearance",
            },
        ],
    },
]
GOOD = (
    "root = Answer([s1, s2])\n"
    's1 = Statement("Keep 18 in. clear.", [c1])\n'
    'c1 = Cite("P1", "at least 18 in. (450 mm) clearance")\n'
    's2 = Statement("Racks need more.", [c2])\n'
    'c2 = Cite("P1", "words that are not in the passage")\n'
)
MODEL = "claude-sonnet-5-5"


# ---- fakes ---------------------------------------------------------------------------------


@pytest.fixture
def env(tmp_path, monkeypatch):
    """A flow dir, case file and doc map, plus fake plan and search that count calls."""
    flow, cases = tmp_path / "flow", tmp_path / "cases.json"
    flow.mkdir()
    cases.write_text(json.dumps(CASES))
    (flow / "doc_ids.json").write_text(json.dumps({"FM.pdf": ["fm"]}))
    calls = {"search": [], "plan": 0}

    def complete_json(system, user, schema, **kwargs):
        calls["plan"] += 1
        last = user.strip().splitlines()[-1]
        return answer.Plan(kind="search", query=last, reply="")

    def retrieve(query, filters=None, include_withdrawn=False):
        calls["search"].append(query)
        if "earthquake" in query:
            return [P_FM | {"relevance_score": 0.01}]
        return [P_FM, P_OTHER]

    monkeypatch.setattr(answer, "complete_json", complete_json)
    monkeypatch.setattr(answer, "retrieve", retrieve)
    monkeypatch.setattr(config, "CHAT_MIN_RELEVANCE", 0.2)
    monkeypatch.setattr(chat_transport, "sleep", lambda s: None)
    base = ["--flow", str(flow), "--cases-file", str(cases)]
    return NS(flow=flow, cases=cases, calls=calls, base=base)


def final_message(model=MODEL, stop="end_turn"):
    u = NS(input_tokens=100, output_tokens=20, cache_read_input_tokens=0)
    u.cache_creation_input_tokens = 50
    return NS(model=model, stop_reason=stop, usage=u)


class FakeStream:
    def __init__(self, text, final):
        self.text_stream, self._final = iter([text[:10], text[10:]]), final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self._final


def live_anthropic(monkeypatch, outcomes=None, model=MODEL):
    """Fake the Anthropic SDK client; `outcomes` are raised in order before answers flow."""
    sent, outcomes = [], list(outcomes or [])

    def stream(**kw):
        sent.append(kw)
        if outcomes:
            raise outcomes.pop(0)
        return FakeStream(GOOD, final_message(model))

    monkeypatch.setattr(llm, "_anthropic_client", lambda: NS(beta=NS(messages=NS(stream=stream))))
    return sent


def api_error(status):
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    return anthropic.APIStatusError(
        "boom", response=httpx.Response(status, request=request), body=None
    )


def run(env, *extra, variant="baseline"):
    args = ["run", *env.base, "--variant", variant, "--provider", "anthropic", "--model", MODEL]
    # Live unless the test says batch (argparse keeps the last --transport).
    return chat_eval.main([*args, "--transport", "live", "--approve-harness", "--yes", *extra])


def rows(env, variant="baseline"):
    path = env.flow / variant / "results.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()]


def errors(env, variant="baseline"):
    path = env.flow / variant / "errors.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def prepare(env):
    return chat_eval.main(["prepare", *env.base, "--approve-harness", "--yes"])


# ---- prepare: search once ------------------------------------------------------------------


def test_first_turns_are_searched_once_for_every_candidate(env, monkeypatch):
    live_anthropic(monkeypatch)
    assert prepare(env) == 0
    first_turns = list(env.calls["search"])
    assert len(first_turns) == 3  # a1, d1 and c1's first turn
    assert run(env, variant="baseline") == 0
    assert run(env, variant="v1") == 0
    follow_ups = env.calls["search"][3:]
    # Only the follow-up (it depends on each candidate's own earlier answer) is searched again.
    assert follow_ups == [follow_ups[0]] * 2 and "racks" in follow_ups[0]


def test_run_refuses_until_first_turns_are_prepared(env, monkeypatch):
    sent = live_anthropic(monkeypatch)
    assert run(env) == 2
    assert sent == []


# ---- live transport ------------------------------------------------------------------------


def test_live_rows_carry_the_answer_usage_model_and_trace(env, monkeypatch):
    live_anthropic(monkeypatch)
    prepare(env)
    assert run(env, "--transport", "live") == 0
    by_id = {r["prompt_id"]: r for r in rows(env)}
    a1 = by_id["a1"]
    assert a1["model"] == MODEL and a1["status"] == "ok" and a1["rep"] == 0
    assert a1["usage"] == {
        "input_tokens": 100,
        "output_tokens": 20,
        "cache_read_input_tokens": 0,
        "cache_creation_input_tokens": 50,
    }
    assert a1["latency_s"] >= 0 and a1["ttft_s"] >= 0
    assert a1["meta"]["prompt_version"] == answer.PROMPT_VERSION
    assert a1["meta"]["transport"] == "live" and a1["meta"]["provider"] == "anthropic"
    assert a1["grade"]["retrieval_hit"] == 1 and a1["grade"]["quote_found"] == 0.5
    trace = json.loads((env.flow / "baseline" / "traces" / "a1_rep0.json").read_text())
    roles = [t["role"] for t in trace]
    assert roles == ["system", "user", "tool_call", "tool_result", "assistant"]
    assert by_id["d1"]["grade"]["decline_rate"] == 1  # below the relevance cut-off
    assert by_id["c1"]["prompt"].count("\n") >= 1  # both user turns shown


def test_resume_skips_completed_case_reps(env, monkeypatch):
    sent = live_anthropic(monkeypatch)
    prepare(env)
    run(env)
    first = len(sent)
    assert run(env, "--reps", "2") == 0
    # Rep 0 is done; only rep 1 runs: a1 and both c1 turns (d1 declines without a call).
    assert len(sent) - first == first
    assert sorted((r["prompt_id"], r["rep"]) for r in rows(env)) == [
        (c, rep) for c in ["a1", "c1", "d1"] for rep in (0, 1)
    ]


def test_a_failed_call_goes_to_errors_not_results(env, monkeypatch):
    live_anthropic(monkeypatch, outcomes=[api_error(400)] * 10)
    prepare(env)
    assert run(env, "--cases", "a1") == 1
    assert not (env.flow / "baseline" / "results.jsonl").exists() or rows(env) == []
    [error] = errors(env)
    assert error["prompt_id"] == "a1" and error["rep"] == 0
    assert error["failure_class"] == "api_error"


def test_a_rate_limit_is_retried_and_the_retry_counted(env, monkeypatch):
    live_anthropic(monkeypatch, outcomes=[api_error(429)])
    prepare(env)
    assert run(env, "--cases", "a1") == 0
    [row] = rows(env)
    assert row["meta"]["retries"] == 1


def test_a_different_served_model_fails_the_attempt(env, monkeypatch):
    live_anthropic(monkeypatch, model="claude-haiku-5-5")
    prepare(env)
    assert run(env, "--cases", "a1") == 1
    [error] = errors(env)
    assert error["failure_class"] == "serving_substitution"
    assert error["model"] == "claude-haiku-5-5" and error["usage"]["output_tokens"] == 20


def test_served_model_accepts_a_dated_snapshot():
    assert chat_transport.served_ok(MODEL, MODEL + "-20261001")
    assert chat_transport.served_ok("gpt-6.1-sol", "gpt-6.1-sol-2026-09-01")
    assert not chat_transport.served_ok(MODEL, "claude-haiku-5-5")


# ---- batch transport -----------------------------------------------------------------------


def fake_anthropic_batches(monkeypatch, text_for=lambda params: GOOD):
    seen = {"create": [], "results": 0}

    def create(requests, betas=None):
        seen["create"].append({"requests": list(requests), "betas": betas})
        return NS(id=f"b{len(seen['create'])}")

    def results(batch_id):
        seen["results"] += 1
        batch = seen["create"][int(batch_id[1:]) - 1]
        for r in batch["requests"]:
            message = {
                "model": MODEL,
                "stop_reason": "end_turn",
                "content": [{"type": "text", "text": text_for(r["params"])}],
                "usage": {"input_tokens": 7, "output_tokens": 3, "cache_read_input_tokens": 1},
            }
            yield NS(custom_id=r["custom_id"], result=NS(type="succeeded", message=message))

    batches = NS(create=create, retrieve=lambda i: NS(processing_status="ended"), results=results)
    client = NS(beta=NS(messages=NS(batches=batches)))
    monkeypatch.setattr(chat_transport, "_client", lambda provider: client)
    return seen


def test_batch_answers_replay_through_the_real_pipeline(env, monkeypatch):
    seen = fake_anthropic_batches(monkeypatch)
    prepare(env)
    assert run(env, "--transport", "batch") == 0
    # One batch per turn round: round 0 has a1 and c1's first turn; round 1 c1's follow-up.
    assert [len(b["requests"]) for b in seen["create"]] == [2, 1]
    first = seen["create"][0]
    assert first["betas"] == llm.ANSWER_BETAS
    params = first["requests"][0]["params"]
    assert params["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert params["model"] == MODEL and "[P1]" in params["messages"][-1]["content"]
    assert all(len(r["custom_id"]) <= 64 for r in first["requests"])
    by_id = {r["prompt_id"]: r for r in rows(env)}
    a1 = by_id["a1"]
    cites = a1["turns"][0]["citations"]
    assert [c["verified"] for c in cites] == [True, False]  # the real quote check ran
    assert a1["usage"]["input_tokens"] == 7 and a1["meta"]["transport"] == "batch"
    assert by_id["d1"]["turns"][0]["declined"] is True
    # The follow-up saw the first answer's statements as plain text.
    follow_up = seen["create"][1]["requests"][0]["params"]["messages"]
    assert follow_up[1] == {"role": "assistant", "content": "Keep 18 in. clear. Racks need more."}


def test_a_model_decline_sentence_counts_as_declined_in_batch(env, monkeypatch):
    decline = f'root = Answer([s1])\ns1 = Statement("{answer.DECLINE}", [])\n'
    fake_anthropic_batches(monkeypatch, text_for=lambda params: decline)
    prepare(env)
    run(env, "--transport", "batch", "--cases", "a1")
    [row] = rows(env)
    assert row["grade"]["false_decline"] == 1 and row["grade"]["decline_correct"] == 0


def test_a_rerun_after_a_crash_reuses_the_submitted_batch(env, monkeypatch):
    seen = fake_anthropic_batches(monkeypatch)
    prepare(env)
    run(env, "--transport", "batch", "--cases", "a1")
    (env.flow / "baseline" / "results.jsonl").unlink()  # as if it crashed before writing
    run(env, "--transport", "batch", "--cases", "a1")
    assert len(seen["create"]) == 1 and len(rows(env)) == 1


def test_openai_batch_uploads_responses_requests_and_reads_the_output_file(env, monkeypatch):
    uploads = {}

    def files_create(file, purpose):
        uploads["purpose"], uploads["lines"] = purpose, file[1].decode().splitlines()
        return NS(id="file-in")

    def content(file_id):
        out = []
        for line in uploads["lines"]:
            req = json.loads(line)
            body = {
                "model": "gpt-6.1-sol-2026-09-01",
                "status": "completed",
                "output": [{"type": "message", "content": [{"type": "output_text", "text": GOOD}]}],
                "usage": {
                    "input_tokens": 50,
                    "output_tokens": 9,
                    "input_tokens_details": {"cached_tokens": 10},
                },
            }
            out.append(
                {"custom_id": req["custom_id"], "response": {"status_code": 200, "body": body}}
            )
        return NS(text="\n".join(json.dumps(o) for o in out))

    client = NS(
        files=NS(create=files_create, content=content),
        batches=NS(
            create=lambda **kw: NS(id="batch-1", **kw),
            retrieve=lambda i: NS(status="completed", output_file_id="out", error_file_id=None),
        ),
    )
    monkeypatch.setattr(chat_transport, "_client", lambda provider: client)
    prepare(env)
    args = ["run", *env.base, "--variant", "baseline", "--provider", "openai"]
    args += ["--model", "gpt-6.1-sol", "--transport", "batch", "--cases", "a1"]
    assert chat_eval.main([*args, "--approve-harness", "--yes"]) == 0
    line = json.loads(uploads["lines"][0])
    assert uploads["purpose"] == "batch"
    assert line["method"] == "POST" and line["url"] == "/v1/responses"
    assert line["body"]["instructions"].startswith(answer.COMPONENTS[:20])
    [row] = rows(env)
    # OpenAI counts cached tokens inside input_tokens; the row splits them out.
    assert row["usage"]["input_tokens"] == 40 and row["usage"]["cache_read_input_tokens"] == 10
    assert row["turns"][0]["citations"][0]["verified"] is True


# ---- gates ---------------------------------------------------------------------------------


def test_paid_commands_print_their_scope_and_stop_without_yes(env, monkeypatch, capsys):
    sent = live_anthropic(monkeypatch)
    args = ["prepare", *env.base, "--approve-harness"]
    assert chat_eval.main(args) == 2
    assert env.calls["plan"] == 0
    assert "3 case" in capsys.readouterr().err
    prepare(env)
    args = ["run", *env.base, "--variant", "baseline", "--provider", "anthropic"]
    assert chat_eval.main([*args, "--model", MODEL]) == 2
    assert sent == []


def test_the_harness_gate_refuses_a_changed_harness(env, monkeypatch):
    live_anthropic(monkeypatch)
    prepare(env)  # records the approved sha
    state = json.loads((env.flow / "_state.json").read_text())
    state["harness_sha"] = "0" * 64
    (env.flow / "_state.json").write_text(json.dumps(state))
    args = ["run", *env.base, "--variant", "baseline", "--provider", "anthropic"]
    assert chat_eval.main([*args, "--model", MODEL, "--yes"]) == 2
    assert not (env.flow / "baseline" / "results.jsonl").exists()


def test_split_is_stratified_by_type_and_fixed(env, tmp_path):
    many = [{"id": f"{t}-{n}", "tags": [t], "turns": []} for t in "xy" for n in range(6)]
    (tmp_path / "many.json").write_text(json.dumps(many))
    args = ["split", "--flow", str(env.flow), "--cases-file", str(tmp_path / "many.json")]
    assert chat_eval.main([*args, "--seed", "0", "--train", "0.67"]) == 0
    state = json.loads((env.flow / "_state.json").read_text())
    train, test = state["train_ids"], state["test_ids"]
    assert sorted(train + test) == sorted(c["id"] for c in many) and not set(train) & set(test)
    assert sum(i.startswith("x") for i in train) == sum(i.startswith("y") for i in train) == 4
    assert chat_eval.main([*args, "--seed", "1", "--train", "0.67"]) == 2  # never re-drawn


# ---- grading -------------------------------------------------------------------------------

DOCS = {"FM.pdf": ["fm"], "NFPA.pdf": ["nfpa"]}
NFPA = {"document": "NFPA.pdf", "pages": [40], "key_phrase": "0.20 gpm/ft2"}


def test_retrieval_hit_gold_object_list_and_any():
    both = [P_FM, P_OTHER]
    hit = chat_grade.retrieval_hit
    assert hit({"gold": FM}, both, DOCS) == 1
    assert hit({"gold": FM}, [P_OTHER], DOCS) == 0
    # A list needs every location (comparison, multi-passage).
    assert hit({"gold": [FM, NFPA]}, both, DOCS) == 1
    assert hit({"gold": [FM, NFPA]}, [P_FM], DOCS) == 0
    # gold_any needs one location (near-identical text in two reports).
    assert hit({"gold_any": [NFPA, FM]}, [P_FM], DOCS) == 1
    assert hit({"gold_any": [NFPA]}, [P_FM], DOCS) == 0
    assert hit({"gold": None}, both, DOCS) is None


def test_retrieval_hit_needs_the_document_the_page_and_the_phrase():
    hit = chat_grade.retrieval_hit
    assert hit({"gold": FM | {"pages": [13]}}, [P_FM], DOCS) == 1  # page range 12-13
    assert hit({"gold": FM | {"pages": [14]}}, [P_FM], DOCS) == 0
    assert hit({"gold": FM | {"key_phrase": "18 in (450 mm)  CLEARANCE"}}, [P_FM], DOCS) == 1
    assert hit({"gold": FM | {"document": "NFPA.pdf"}}, [P_FM], DOCS) == 0


def record(**kw):
    base = {"searched": True, "declined": False, "passages": [P_FM], "citations": []}
    return base | {"program": "", "kind": "search"} | kw


def test_decline_metrics_split_unanswerable_from_answerable():
    unanswerable = {"turns": [{"expect": "decline", "gold": None}]}
    answerable = {"turns": [{"expect": "answer", "gold": FM}]}
    g = chat_grade.code_grade(unanswerable, [record(declined=True, passages=[])], DOCS)
    assert g["declined"] == 1 and g["decline_correct"] == 1 and g["decline_rate"] == 1
    assert g["false_decline"] is None
    g = chat_grade.code_grade(answerable, [record(declined=True, passages=[])], DOCS)
    assert g["decline_correct"] == 0 and g["false_decline"] == 1 and g["decline_rate"] is None
    assert g["retrieval_hit"] == 0  # declined below the cut-off: nothing reached the model
    g = chat_grade.code_grade(answerable, [record()], DOCS)
    assert g["decline_correct"] == 1 and g["false_decline"] == 0


def test_clarified_means_a_question_back_without_a_search():
    case = {"turns": [{"expect": "clarify", "gold": None}]}
    asked = record(searched=False, kind="clarify", passages=[])
    asked["program"] = 'root = Answer([s1])\ns1 = Statement("Sprinklers or doors?", [])\n'
    assert chat_grade.code_grade(case, [asked], DOCS)["clarified"] == 1
    assert chat_grade.code_grade(case, [record()], DOCS)["clarified"] == 0


def test_quote_found_is_the_share_of_verified_citations():
    case = {"turns": [{"expect": "answer", "gold": FM}]}
    cites = [{"verified": True}, {"verified": False}, {"verified": True}, {"verified": True}]
    assert chat_grade.code_grade(case, [record(citations=cites)], DOCS)["quote_found"] == 0.75
    assert chat_grade.code_grade(case, [record()], DOCS)["quote_found"] is None


def test_statements_and_their_cites_come_from_the_program():
    program = GOOD + 't1 = CitedTable(["A"], [[x1, x2]])\nx1 = Cell("2019", [])\n'
    program += 'x2 = Cell("0.20 gpm", [Cite("P2", "0.20 gpm/ft2")])\n'
    statements = chat_grade.parse_statements(program)
    assert [s["text"] for s in statements] == ["Keep 18 in. clear.", "Racks need more.", "0.20 gpm"]
    assert statements[0]["cites"] == [("P1", "at least 18 in. (450 mm) clearance")]
    assert statements[2]["cites"] == [("P2", "0.20 gpm/ft2")]


def test_the_judge_sees_cited_passages_first_and_the_answer_last():
    statements = chat_grade.parse_statements(GOOD)
    system, user = chat_grade.judge_prompt([P_FM, P_OTHER], statements, topic="clearance")
    assert user.index("<passages>") < user.index("<topic>") < user.index("<answer>")
    assert P_FM["text"] in user and P_OTHER["text"] not in user  # only the cited passage
    assert "untrusted" in system


def judged(statements, verdicts, on_topic=None):
    return chat_grade.Judgement(
        verdicts=[
            chat_grade.Verdict(
                statement=n,
                facts_in_passage=ok,
                numbers_match=ok,
                scope_kept=ok,
                reason="",
            )
            for n, ok in enumerate(verdicts, 1)
        ],
        on_topic=on_topic,
    )


def test_judges_are_averaged_over_runs_then_over_judges(env, monkeypatch):
    live_anthropic(monkeypatch)
    prepare(env)
    run(env, "--cases", "a1,c1")
    answers = {"anthropic": [[True, True], [True, False]], "openai": [[True, True]] * 2}
    asked = []

    def complete_json(system, user, schema, *, provider, model, effort, feature):
        asked.append((provider, user))
        usage.record(feature, provider, model + "-served", 0.0, input_tokens=5, output_tokens=2)
        # The nth time this judge sees this answer = judge run n (calls may run in parallel).
        verdicts = answers[provider][(asked.count((provider, user)) - 1) % 2]
        return judged(None, verdicts, on_topic=provider == "openai")

    monkeypatch.setattr(chat_grade, "complete_json", complete_json)
    monkeypatch.setattr(chat_transport, "served_ok", lambda want, got: True)
    args = ["grade", *env.base, "--variant", "baseline", "--judge", "anthropic:claude-x"]
    # One at a time: the fake counts calls per prompt to tell the judge runs apart.
    args += ["--judge", "openai:gpt-y", "--judge-runs", "2", "--transport", "live"]
    args += ["--concurrency", "1"]
    assert chat_eval.main([*args, "--approve-harness", "--yes"]) == 0
    by_id = {r["prompt_id"]: r for r in rows(env)}
    a1 = by_id["a1"]["grade"]
    assert a1["supported_anthropic"] == 0.75 and a1["supported_openai"] == 1.0
    assert a1["supported"] == 0.875
    c1 = by_id["c1"]["grade"]
    assert c1["on_topic_openai"] == 1 and c1["on_topic_anthropic"] == 0 and c1["on_topic"] == 0.5
    assert by_id["a1"]["judge_model"] == "claude-x-served"
    assert by_id["a1"]["judge_usage"]["input_tokens"] == 10  # two runs
    assert a1["retrieval_hit"] == 1  # code metrics kept
    calls = len(asked)
    assert chat_eval.main([*args, "--yes"]) == 0  # already judged: no new calls
    assert len(asked) == calls


def test_a_statement_without_cites_is_unsupported_whatever_the_judge_says():
    statements = chat_grade.parse_statements(
        'root = Answer([s1, s2])\ns1 = Statement("I don\'t know.", [])\n'
        's2 = Statement("Keep 18 in.", [Cite("P1", "18 in.")])\n'
    )
    share = chat_grade.supported_share(statements, judged(None, [True, True]))
    assert share == (1, 2)


def test_batch_judges_send_a_json_schema_and_parse_the_verdicts(env, monkeypatch):
    live_anthropic(monkeypatch)
    prepare(env)
    run(env, "--cases", "a1")
    verdict = judged(None, [True, False]).model_dump_json()
    seen = fake_anthropic_batches(monkeypatch, text_for=lambda params: verdict)
    monkeypatch.setattr(chat_transport, "served_ok", lambda want, got: True)
    args = ["grade", *env.base, "--variant", "baseline", "--judge", f"anthropic:{MODEL}"]
    assert chat_eval.main([*args, "--transport", "batch", "--approve-harness", "--yes"]) == 0
    params = seen["create"][0]["requests"][0]["params"]
    assert params["output_config"]["format"]["type"] == "json_schema"
    [row] = rows(env)
    assert row["grade"]["supported"] == 0.5


# ---- self-check ----------------------------------------------------------------------------


def test_selfcheck_scores_the_oracle_full_and_the_null_empty(env, capsys):
    assert chat_eval.main(["selfcheck", "--cases-file", str(env.cases)]) == 0
    out = capsys.readouterr().err
    assert "oracle" in out and "null" in out and "FAIL" not in out


def test_clarify_replies_need_no_support_and_only_follow_ups_check_topic():
    clarify = 'root = Answer([s1])\ns1 = Statement("Sprinklers or doors?", [])\n'
    case = {
        "turns": [
            {"expect": "answer", "gold": FM, "topic": "clearance"},
            {"expect": "clarify", "gold": None, "topic": "clearance"},
            {"expect": "answer", "gold": FM, "topic": "clearance"},
        ]
    }
    turns = [
        record(program=GOOD),
        record(program=clarify, searched=False, kind="clarify", passages=[]),
        record(program=GOOD),
    ]
    needs = [chat_grade._needs_judge(t, r, n) for n, (t, r) in enumerate(zip(case["turns"], turns))]
    assert needs == [True, False, True]
    verdicts = judged(None, [True, True], on_topic=True).model_dump()
    row = {
        "turns": turns,
        "judgements": {"anthropic:x": {"runs": 1, "turns": {"0": [verdicts], "2": [verdicts]}}},
    }
    metrics, _ = chat_grade.judge_grade(case, row)
    assert metrics["supported"] == 1.0  # the clarifying question isn't an unsupported claim
    assert metrics["on_topic"] == 1.0  # one topic check: the answerable follow-up only

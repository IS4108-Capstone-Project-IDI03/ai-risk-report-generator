"""The CB-01 eval's oracle / null self-check: proves the grader can tell right from wrong.

Called by eval/chat_eval.py `selfcheck`. Pushes a perfect answerer (the oracle) and two
broken ones (decline everything; answer nothing) through the real runner and grader, with
fake plan, search, answer model and judge, so nothing paid runs. Then feeds the judge prompt
an empty answer, "I don't know" and a confident wrong answer. A real-judge version of the
last check needs the human's approval (it costs money).
"""

import json
import re
import tempfile
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace as NS
from unittest import mock

from app import config, usage
from app.chat import answer
from app.generation import llm
from eval import chat_grade, chat_runner

MODEL, JUDGE = "selfcheck-model", "selfcheck-judge"
_PASSAGE = re.compile(r"\[(P\d+)\] \([^\n]*\)\n(.*?)(?=\n\n\[P\d+\] \(|\n</passages>)", re.S)
_STATEMENT = re.compile(r"^S(\d+) \(cites ([^)]*)\): (.*)$", re.M)


def _golds(turn: dict) -> list[dict]:
    gold = turn.get("gold") or []
    return (gold if isinstance(gold, list) else [gold]) + (turn.get("gold_any") or [])


def _gold_passages(turn: dict) -> list[dict]:
    """Return one passage per gold location: its key phrase, on its pages, in its document."""
    return [
        {
            "id": f"gold:{n}",
            "text": loc["key_phrase"],
            "metadata": {
                "doc_id": loc["document"],
                "page_start": min(loc["pages"]),
                "page_end": max(loc["pages"]),
            },
            "relevance_score": 0.9,
        }
        for n, loc in enumerate(_golds(turn))
    ]


def oracle_program(prompt: str) -> str:
    """Return an answer that quotes every passage in the prompt word for word."""
    passages = _PASSAGE.findall(prompt)
    lines = [f"root = Answer([{', '.join(f's{n}' for n in range(1, len(passages) + 1))}])"]
    for n, (label, text) in enumerate(passages, 1):
        lines.append(f"s{n} = Statement({json.dumps(text)}, [c{n}])")
        lines.append(f"c{n} = Cite({json.dumps(label)}, {json.dumps(text)})")
    return "\n".join(lines) + "\n"


def fake_judge(system, user, schema, *, provider, model, effort, feature):
    """Judge as the prompt implies: supported only if the cited passages hold the statement."""
    usage.record(feature, provider, model, 0.0, input_tokens=1, output_tokens=1)
    passages = dict(_PASSAGE.findall(user))
    verdicts = []
    for number, cites, text in _STATEMENT.findall(user):
        cited = " ".join(passages.get(label.strip(), "") for label in cites.split(","))
        ok = cites != "nothing" and chat_grade._norm(text) in chat_grade._norm(cited)
        verdicts.append(
            chat_grade.Verdict(
                statement=int(number),
                facts_in_passage=ok,
                numbers_match=ok,
                scope_kept=ok,
                reason="",
            )
        )
    on_topic = bool(verdicts) if "<topic>" in user else None
    return chat_grade.Judgement(verdicts=verdicts, on_topic=on_topic)


class _Stream:
    """A fake Anthropic stream that says `text`, so the real llm.stream_text code runs."""

    def __init__(self, text):
        self.text_stream = iter([text] if text else [])

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        u = NS(input_tokens=1, output_tokens=1, cache_read_input_tokens=0)
        return NS(model=MODEL, stop_reason="end_turn", usage=u)


def _fakes(cases: list[dict], mode: str):
    """Return patches for plan, search and the answer model, as the oracle or a null."""
    turns = {t["user"]: t for c in cases for t in c["turns"]}

    def plan(system, user, schema, **kwargs):
        text = user.rsplit("user: ", 1)[-1].strip()
        expect = turns.get(text, {}).get("expect")
        if mode == "oracle" and expect == "clarify":
            return answer.Plan(kind="clarify", query="", reply="Which one do you mean?")
        if mode == "oracle" and expect == "chat":
            return answer.Plan(kind="chat", query="", reply="Glad to help.")
        return answer.Plan(kind="search", query=text, reply="")

    def search(query, filters=None, include_withdrawn=False):
        turn = turns.get(query, {})
        if mode == "null-decline" or turn.get("expect") == "decline":
            return []
        return _gold_passages(turn)

    def stream(**kwargs):
        prompt = kwargs["messages"][-1]["content"]
        return _Stream(oracle_program(prompt) if mode == "oracle" else "")

    client = NS(beta=NS(messages=NS(stream=stream)))
    return [
        mock.patch.object(answer, "complete_json", plan),
        mock.patch.object(answer, "retrieve", search),
        mock.patch.object(llm, "_anthropic_client", lambda: client),
        mock.patch.object(chat_grade, "complete_json", fake_judge),
        mock.patch.object(config, "CHAT_PROVIDER", "anthropic"),
        mock.patch.object(config, "CHAT_MODEL", MODEL),
        mock.patch.object(config, "CHAT_MIN_RELEVANCE", 0.2),
    ]


def _scores(cases: list[dict], mode: str, flow: Path) -> dict:
    """Run every case through the runner and grader under `mode`; return each metric's mean."""
    doc_ids = {
        loc["document"]: [loc["document"]] for c in cases for t in c["turns"] for loc in _golds(t)
    }
    ctx = chat_runner.Context(
        flow=flow,
        variant="baseline",
        provider="anthropic",
        model=MODEL,
        effort="low",
        transport="live",
        doc_ids=doc_ids,
        timeout_s=0,
        concurrency=1,
        log=lambda *a: None,
    )
    (ctx.vdir / "traces").mkdir(parents=True)
    with ExitStack() as stack:
        for patch in _fakes(cases, mode):
            stack.enter_context(patch)
        chat_runner.prepare(cases, flow, log=lambda *a: None)
        chat_runner.run_live([(c, 0) for c in cases], ctx)
        rows = [json.loads(x) for x in (ctx.vdir / "results.jsonl").read_text().splitlines()]
        by_id = {c["id"]: c for c in cases}
        opts = {"concurrency": 1, "poll_s": 0, "batch_timeout_s": 0}
        chat_grade.grade_rows(
            rows,
            by_id,
            [f"anthropic:{JUDGE}"],
            runs=1,
            transport_name="live",
            effort="low",
            vdir=ctx.vdir,
            opts=opts,
            log=lambda *a: None,
        )
        chat_grade.apply_grades(rows, by_id, doc_ids)
    metrics = {k for r in rows for k in r["grade"]}
    return {m: chat_grade._mean([r["grade"].get(m) for r in rows]) for m in sorted(metrics)} | {
        "rows": len(rows)
    }


# What each run must score; a metric no case exercises (None) is skipped.
WANT = {
    "oracle": {
        "retrieval_hit": 1,
        "quote_found": 1,
        "decline_correct": 1,
        "clarified": 1,
        "supported": 1,
        "on_topic": 1,
    },
    "null-decline": {"retrieval_hit": 0, "false_decline": 1, "supported": None, "on_topic": 0},
    "null-empty": {"supported": 0, "quote_found": None, "on_topic": 0},
}


def selfcheck(cases: list[dict], log=print) -> bool:
    """Return True if the oracle scores full marks, the nulls score nothing, and the judge
    prompt leaves an empty, an "I don't know" and a confidently wrong answer unsupported."""
    passed = True
    with tempfile.TemporaryDirectory() as tmp:
        for mode, want in WANT.items():
            got = _scores(cases, mode, Path(tmp) / mode)
            for metric, value in want.items():
                score = got.get(metric)
                skip = value is not None and score is None
                ok = skip or (score == value if value is None else abs(score - value) < 1e-9)
                passed &= ok
                status = "skip" if skip else "PASS" if ok else "FAIL"
                log(f"{status} {mode:<12} {metric:<16} {score} (want {value}), {got['rows']} rows")
    gold = next(t for c in cases for t in c["turns"] if _golds(t))
    passage = _gold_passages(gold)[0]
    phrase = json.dumps(passage["text"])
    answers = {
        "empty answer": "",
        "I don't know": 'root = Answer([s1])\ns1 = Statement("I don\'t know.", [])\n',
        "confident wrong answer": (
            'root = Answer([s1])\ns1 = Statement("It must be 99999 units, always.", '
            f'[Cite("P1", {phrase})])\n'
        ),
    }
    for name, program in answers.items():
        statements = chat_grade.parse_statements(program)
        system, user = chat_grade.judge_prompt([passage], statements, None)
        shaped = "untrusted" in system and user.index("<passages>") < user.index("<answer>")
        judgement = fake_judge(system, user, None, provider="x", model="x", effort="", feature="")
        rec = {"declined": False, "program": program}
        share = chat_grade._turn_support({"expect": "answer"}, rec, judgement)
        ok = shaped and share is not None and share[0] == 0
        passed &= ok
        log(f"{'PASS' if ok else 'FAIL'} judge prompt {name:<22} supported {share}")
    return passed

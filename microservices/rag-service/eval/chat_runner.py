"""Runs CB-01 eval cases through the real chat pipeline (app/chat/answer.py answer_events).

Called by eval/chat_eval.py (prepare, run) and eval/chat_selfcheck.py. Calls the plan step
and search once per turn and caches them, so every candidate model gets the same passages;
only the answer-model call goes through a transport: live (streaming, as in production) or
batch (one provider batch per turn round, each result replayed through the pipeline).
"""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from pathlib import Path

from app import config, usage
from app.chat import answer
from app.generation import llm
from eval import chat_grade
from eval import chat_transport as transport
from eval.chat_transport import AttemptFailed

# The usage keys the report prices (cache writes 1.25x input, cache reads 0.1x).
USAGE_KEYS = (
    "input_tokens",
    "output_tokens",
    "cache_read_input_tokens",
    "cache_creation_input_tokens",
)
# The pipeline pass in progress on this thread (a contextvar: live cases run in parallel).
_pass: ContextVar = ContextVar("eval_pass", default=None)


@dataclass
class Pass:
    """One trip through answer_events: what it replays, and what it saw."""

    cached: dict | None  # the plan and passages from an earlier trip, if any
    answer: object  # stands in for stream_text: (pass, system, messages, **kw) -> chunks
    new: dict = field(default_factory=dict)
    called: bool = False
    pre_usage: list = field(default_factory=list)
    request: dict | None = None
    response: object = None  # the provider's final message, for model/usage/stop
    error: Exception | None = None
    t0: float | None = None
    first: float | None = None
    t1: float | None = None


@contextmanager
def pipeline_hooks():
    """Patch the pipeline's seams for the eval; yield the real stream_text.

    The plan and search replay the cache when there is one; the answer call goes to the
    pass's transport; the usage readers also keep the final message, for its model and
    cache-write tokens (the app's usage log drops those).
    """
    real = {
        "plan": answer.complete_json,
        "search": answer.search_passages,
        "stream": answer.stream_text,
        "anthropic": llm._anthropic_usage,
        "openai": llm._openai_usage,
    }

    def plan(system, user, schema, **kwargs):
        p = _pass.get()
        if p.cached is not None:
            return answer.Plan.model_validate(p.cached["plan"])
        result = real["plan"](system, user, schema, **kwargs)
        p.new["plan"] = result.model_dump()
        return result

    def search(plan, names=None):
        p = _pass.get()
        if p.cached is not None:
            return p.cached.get("passages") or []
        passages = real["search"](plan, names)
        p.new["passages"] = passages
        return passages

    def stream(system, messages, **kwargs):
        p = _pass.get()
        p.called = True
        p.pre_usage = list(usage._items.get() or [])  # the plan and search usage so far
        return p.answer(p, system, messages, **kwargs)

    def keeper(name):
        def read(response):
            p = _pass.get()
            if p is not None:
                p.response = response
            return real[name](response)

        return read

    patches = {
        (answer, "complete_json"): plan,
        (answer, "search_passages"): search,
        (answer, "stream_text"): stream,
        # Production paces words for the screen; the eval would only time the pause.
        (answer, "WORD_DELAY_SECONDS"): 0,
        (llm, "_anthropic_usage"): keeper("anthropic"),
        (llm, "_openai_usage"): keeper("openai"),
    }
    old = {target: getattr(*target) for target in patches}
    for (module, name), value in patches.items():
        setattr(module, name, value)
    try:
        yield real["stream"]
    finally:
        for (module, name), value in old.items():
            setattr(module, name, value)


# ---- answer stand-ins -----------------------------------------------------------------------


def collect(p, system, messages, **kwargs):
    """Keep the answer request for a batch instead of sending it."""
    p.request = {"system": system, "messages": messages, **kwargs}
    return iter(())


def live(real_stream):
    """Return a stand-in that streams the real answer call, timing it."""

    def answer_live(p, system, messages, **kwargs):
        p.t0 = time.perf_counter()
        try:
            for chunk in real_stream(system, messages, **kwargs):
                p.first = p.first or time.perf_counter()
                yield chunk
        except llm.GenerationFailed as error:
            p.error = error
            raise
        finally:
            p.t1 = time.perf_counter()

    return answer_live


def replay(provider: str, response: dict):
    """Return a stand-in that yields a batch result's text, then records it as production does."""

    def answer_replay(p, system, messages, **kwargs):
        p.response = response
        n = transport.normalize(provider, response)
        yield n["text"]
        u = n["usage"]
        try:
            # Same bookkeeping as a live call: usage recorded, refusal or cut-off raised.
            llm._finish(
                "chat",
                provider,
                time.perf_counter(),
                n["model"],
                (u["input_tokens"], u["output_tokens"], u["cache_read_input_tokens"]),
                n["stop"],
            )
        except llm.GenerationFailed as error:
            p.error = error
            raise

    return answer_replay


# ---- one turn -------------------------------------------------------------------------------


@dataclass
class Context:
    """Everything a run needs; built by chat_eval.py from its flags."""

    flow: Path
    variant: str
    provider: str
    model: str
    effort: str
    transport: str
    doc_ids: dict
    # Raw document details from `docmap`, so answers get names as in production.
    documents: list = field(default_factory=list)
    timeout_s: float = 600
    concurrency: int = 4
    poll_s: float = 30
    batch_timeout_s: float = 86400
    log: object = print
    lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def vdir(self) -> Path:
        return self.flow / self.variant


def cache_path(flow: Path, variant: str, case_id: str, rep: int, t: int) -> Path:
    """Return where a turn's plan and passages are cached.

    A first turn is shared by every candidate (search once). A later turn depends on the
    candidate's own earlier answers, so it is cached per variant and rep.
    """
    if t == 0:
        return flow / "_cache" / f"{case_id}_t0.json"
    return flow / variant / "_cache" / f"{case_id}_rep{rep}_t{t}.json"


def _load(path: Path) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None


def run_pass(
    messages: list[dict], cached: dict | None, stand_in, documents: list[dict] | None = None
) -> tuple[Pass, list[dict]]:
    """Run answer_events once; return the pass and its events."""
    p = Pass(cached=cached, answer=stand_in)
    token = _pass.set(p)
    try:
        events = [
            json.loads(line[6:])
            for chunk in answer.answer_events(messages, [], documents)
            for line in chunk.splitlines()
            if line.startswith("data: ")
        ]
    finally:
        _pass.reset(token)
    return p, events


def save_new(path: Path, p: Pass, events: list[dict]) -> None:
    """Cache a freshly planned turn's plan, passages and their usage."""
    if p.cached is not None or "plan" not in p.new:
        return
    # A search plan with no passages key means the search raised (e.g. a Cohere 429). Without
    # this, the error would be cached as "found nothing" and scored as the model declining.
    if p.new["plan"]["kind"] == "search" and "passages" not in p.new:
        raise AttemptFailed("the search failed", "search_error")
    result = next(e["value"] for e in events if e["type"] == "CUSTOM")
    spent = p.pre_usage if p.called else result["usage"]
    entry = {
        "plan": p.new["plan"],
        "passages": p.new.get("passages"),
        "usage": spent,
        "plan_model": config.CHAT_PLAN_MODEL,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(entry))


def turn_record(user: str, p: Pass, events: list[dict], ctx: Context) -> dict:
    """Return what one turn did, for grading; raise AttemptFailed if it isn't scorable."""
    cached = p.cached or p.new
    if not cached.get("plan"):  # the plan call failed, so nothing ran
        raise AttemptFailed("the plan step failed", "api_error")
    program = "".join(e["delta"] for e in events if e["type"] == "TEXT_MESSAGE_CONTENT")
    args = next((json.loads(e["delta"]) for e in events if e["type"] == "TOOL_CALL_ARGS"), None)
    result = next(e["value"] for e in events if e["type"] == "CUSTOM")
    retrieved = cached.get("passages") or []
    reply = None
    if p.called:
        if p.response is None:  # the call itself failed: retried, then errors.jsonl
            raise p.error or AttemptFailed("the answer call returned nothing", "api_error")
        n = transport.normalize(ctx.provider, p.response)
        reply = {k: n[k] for k in ("model", "usage", "stop_reason")}
        if p.t0 is not None:
            reply["latency_s"] = round(p.t1 - p.t0, 3)
            reply["ttft_s"] = round((p.first or p.t1) - p.t0, 3)
        if not transport.served_ok(ctx.model, n["model"]):
            # A silently substituted model would invalidate the comparison.
            raise AttemptFailed(
                f"served model {n['model']} != requested {ctx.model}",
                "serving_substitution",
                n["model"],
                n["usage"],
            )
    return {
        "user": user,
        "kind": cached["plan"]["kind"],
        "searched": args is not None,
        "query": args and args["query"],
        "filters": result["filters"],
        "include_withdrawn": cached["plan"].get("include_withdrawn", False),
        "best_relevance": max((x.get("relevance_score", 0) for x in retrieved), default=None),
        # Only passages the answer model saw count (none when declined below the cut-off).
        "passages": retrieved if p.called else [],
        "citations": result["citations"],
        "declined": result["declined"],
        "program": program,
        "refused": bool(p.error and "declined" in str(p.error)),
        "answer": reply,
        "pipeline_usage": cached.get("usage") or [],
    }


# ---- rows and traces ------------------------------------------------------------------------


def trace(records: list[dict]) -> list[dict]:
    """Return the conversation as report turns: system, user, search call/result, answer."""
    turns = [{"role": "system", "content": answer.COMPONENTS + answer.ANSWER_RULES}]
    for r in records:
        turns.append({"role": "user", "content": r["user"]})
        if r["searched"]:
            args = {"query": r["query"], "filters": r["filters"]}
            args["include_withdrawn"] = r["include_withdrawn"]
            turns.append(
                {
                    "role": "tool_call",
                    "name": answer.SEARCH_TOOL,
                    "content": json.dumps(args, indent=2),
                }
            )
            shown = [
                {
                    "label": f"P{n}",
                    "doc_id": x["metadata"].get("doc_id"),
                    "pages": [x["metadata"].get("page_start"), x["metadata"].get("page_end")],
                    "relevance": x.get("relevance_score"),
                    "text": x["text"],
                }
                for n, x in enumerate(r["passages"], 1)
            ]
            found = shown or {"declined_below_cut_off": True, "best": r["best_relevance"]}
            turns.append(
                {
                    "role": "tool_result",
                    "name": answer.SEARCH_TOOL,
                    "content": json.dumps(found, indent=2),
                }
            )
        turns.append({"role": "assistant", "content": r["program"]})
    return turns


def build_row(case: dict, rep: int, records: list[dict], ctx: Context, retries: int) -> dict:
    """Return the results.jsonl row for one finished case rep, code metrics graded."""
    replies = [r["answer"] for r in records if r["answer"]]
    spent = {k: sum((a["usage"].get(k) or 0) for a in replies) for k in USAGE_KEYS}
    row = {
        "prompt_id": case["id"],
        "rep": rep,
        "prompt": "\n".join(t["user"] for t in case["turns"]),
        "tags": case["tags"],
        "model": replies[-1]["model"] if replies else None,
        "usage": spent,
        "stop_reason": replies[-1]["stop_reason"] if replies else None,
        "status": "truncated" if any(a["stop_reason"] == "max_tokens" for a in replies) else "ok",
        "grade": chat_grade.code_grade(case, records, ctx.doc_ids),
        "meta": {
            "prompt_version": answer.PROMPT_VERSION,
            "provider": ctx.provider,
            "transport": ctx.transport,
            "requested_model": ctx.model,
            "effort": ctx.effort,
            "plan_model": config.CHAT_PLAN_MODEL,
            "refused": any(r["refused"] for r in records),
            **({"retries": retries} if retries else {}),
        },
        "turns": records,
    }
    timed = [a for a in replies if "latency_s" in a]
    if timed:  # live only: a batch's wait says nothing about answer speed
        row["latency_s"] = round(sum(a["latency_s"] for a in timed), 3)
        row["ttft_s"] = round(sum(a["ttft_s"] for a in timed) / len(timed), 3)
    return row


def write_row(ctx: Context, row: dict) -> None:
    """Append the row as the case completes, then its trace (crash-safe, one line each)."""
    with ctx.lock:
        with (ctx.vdir / "results.jsonl").open("a") as f:
            f.write(json.dumps(row) + "\n")
    trace_path = ctx.vdir / "traces" / f"{row['prompt_id']}_rep{row['rep']}.json"
    trace_path.write_text(json.dumps(trace(row["turns"]), indent=2))


def write_error(ctx: Context, case_id: str, rep: int, error: Exception, retries: int, t0: float):
    """Append a failed attempt to errors.jsonl, with its billed model and usage if any."""
    failure = getattr(error, "failure_class", None)
    if failure is None:
        failure = "api_error" if isinstance(error, llm.GenerationFailed) else "harness_error"
    entry = {
        "prompt_id": case_id,
        "rep": rep,
        "failure_class": failure,
        "error": str(error)[:500],
        "retries": retries,
        "model": getattr(error, "model", None),
        "usage": getattr(error, "usage", None),
        "latency_s": round(time.monotonic() - t0, 3),
    }
    with ctx.lock:
        with (ctx.vdir / "errors.jsonl").open("a") as f:
            f.write(json.dumps(entry) + "\n")
    ctx.log(f"  {case_id} rep{rep} FAILED ({failure}): {str(error)[:200]}")


# ---- prepare --------------------------------------------------------------------------------


def prepare(cases: list[dict], flow: Path, log=print) -> int:
    """Plan and search every case's first turn once, caching it; return the failure count."""
    failed = 0
    with pipeline_hooks():
        for case in cases:
            path = cache_path(flow, "", case["id"], 0, 0)
            if path.exists():
                continue
            messages = [{"role": "user", "content": case["turns"][0]["user"]}]
            try:
                p, events = run_pass(messages, None, collect)  # stops before the answer model
                if "plan" not in p.new:
                    raise AttemptFailed("the plan step failed", "api_error")
                save_new(path, p, events)
            except Exception as error:
                failed += 1
                log(f"  {case['id']} prepare FAILED: {str(error)[:200]}")
    return failed


def missing_first_turns(cases: list[dict], flow: Path) -> list[str]:
    """Return the ids of cases whose first turn has not been prepared."""
    return [c["id"] for c in cases if not cache_path(flow, "", c["id"], 0, 0).exists()]


# ---- live -----------------------------------------------------------------------------------


def _with_ceiling(fn, seconds: float):
    """Return fn(), or raise a timeout after `seconds` of wall clock, however the call is doing.

    A hung stream can send keep-alives forever; only a hard ceiling frees the slot. The
    abandoned call may still finish in the background (Python can't kill a thread).
    """
    if not seconds:
        return fn()
    box = {}

    def target():
        try:
            box["value"] = fn()
        except BaseException as error:
            box["error"] = error

    thread = threading.Thread(target=target, daemon=True)
    thread.start()
    thread.join(seconds)
    if thread.is_alive():
        raise AttemptFailed(f"exceeded the {seconds}s wall-clock ceiling", "timeout")
    if "error" in box:
        raise box["error"]
    return box["value"]


def _converse_live(case: dict, rep: int, ctx: Context, real_stream, retries: dict, deadline):
    """Return the turn records for one case rep, each turn live and retried when transient."""
    messages, records = [], []
    for t, turn in enumerate(case["turns"]):
        messages.append({"role": "user", "content": turn["user"]})
        path = cache_path(ctx.flow, ctx.variant, case["id"], rep, t)

        def attempt():
            p, events = run_pass(messages, _load(path), live(real_stream), ctx.documents)
            save_new(path, p, events)
            return turn_record(turn["user"], p, events, ctx)

        record = transport.with_backoff(attempt, retries, deadline)
        records.append(record)
        messages.append({"role": "assistant", "content": record["program"]})
    return records


def run_live(todo: list[tuple[dict, int]], ctx: Context) -> tuple[int, int]:
    """Answer each (case, rep) live, in parallel; return (ok, failed)."""
    counts = {"ok": 0, "failed": 0}
    with pipeline_hooks() as real_stream:

        def one(case, rep):
            t0, retries = time.monotonic(), {"count": 0}
            deadline = t0 + ctx.timeout_s if ctx.timeout_s else float("inf")
            try:
                records = _with_ceiling(
                    lambda: _converse_live(case, rep, ctx, real_stream, retries, deadline),
                    ctx.timeout_s,
                )
                write_row(ctx, build_row(case, rep, records, ctx, retries["count"]))
                outcome = "ok"
            except Exception as error:
                write_error(ctx, case["id"], rep, error, retries["count"], t0)
                outcome = "failed"
            with ctx.lock:  # cases finish on several threads at once
                counts[outcome] += 1

        with ThreadPoolExecutor(ctx.concurrency) as pool:
            for future in [pool.submit(one, case, rep) for case, rep in todo]:
                future.result()
    return counts["ok"], counts["failed"]


# ---- batch ----------------------------------------------------------------------------------


@dataclass
class Conversation:
    case: dict
    rep: int
    messages: list = field(default_factory=list)
    records: list = field(default_factory=list)
    error: Exception | None = None


def run_batch(todo: list[tuple[dict, int]], ctx: Context) -> tuple[int, int]:
    """Answer each (case, rep) with one provider batch per turn round; return (ok, failed).

    Round t holds every conversation's turn t: later turns need the earlier real answers,
    so a conversation of n turns takes n batches. No retries: a rerun resumes instead.
    """
    t0 = time.monotonic()
    convs = [Conversation(case, rep) for case, rep in todo]
    ok = failed = 0
    with pipeline_hooks():
        for t in range(max((len(c.case["turns"]) for c in convs), default=0)):
            active = [c for c in convs if c.error is None and t < len(c.case["turns"])]
            pending = {}
            # a. Plan and search (cached), keeping each answer request for the batch.
            for c in active:
                user = c.case["turns"][t]["user"]
                c.messages.append({"role": "user", "content": user})
                path = cache_path(ctx.flow, ctx.variant, c.case["id"], c.rep, t)
                try:
                    p, events = run_pass(c.messages, _load(path), collect, ctx.documents)
                    save_new(path, p, events)
                    if p.request:
                        pending[json.dumps([c.case["id"], c.rep, t, ctx.model])] = (c, p.request)
                    else:  # clarify, small talk or a decline: no answer call
                        c.records.append(turn_record(user, p, events, ctx))
                except Exception as error:
                    c.error = error
            # b. One batch for the round's answer calls.
            requests = {
                key: transport.answer_params(
                    ctx.provider, r["system"], r["messages"], r["model"], r["effort"]
                )
                for key, (c, r) in pending.items()
            }
            results = {}
            if requests:
                try:
                    results = transport.batch_results(
                        ctx.vdir / "batches" / f"answers_t{t}.json",
                        ctx.provider,
                        requests,
                        prefix=f"t{t}-",
                        deadline=time.monotonic() + ctx.batch_timeout_s,
                        poll_s=ctx.poll_s,
                        log=ctx.log,
                    )
                except AttemptFailed as error:
                    for c, _ in pending.values():
                        c.error = error
            # c. Replay each result through the rest of the pipeline (program, quote check).
            for key, (c, _) in pending.items():
                if c.error is not None:
                    continue
                result = results.get(key, {"error": "no result"})
                if "error" in result:
                    c.error = AttemptFailed(result["error"], "api_error")
                    continue
                path = cache_path(ctx.flow, ctx.variant, c.case["id"], c.rep, t)
                try:
                    p, events = run_pass(
                        c.messages, _load(path), replay(ctx.provider, result["ok"]), ctx.documents
                    )
                    c.records.append(turn_record(c.case["turns"][t]["user"], p, events, ctx))
                except Exception as error:
                    c.error = error
            # d. Write each conversation that just finished or failed.
            for c in active:
                if c.error is not None:
                    write_error(ctx, c.case["id"], c.rep, c.error, 0, t0)
                    failed += 1
                    continue
                c.messages.append({"role": "assistant", "content": c.records[-1]["program"]})
                if t == len(c.case["turns"]) - 1:
                    write_row(ctx, build_row(c.case, c.rep, c.records, ctx, 0))
                    ok += 1
    return ok, failed

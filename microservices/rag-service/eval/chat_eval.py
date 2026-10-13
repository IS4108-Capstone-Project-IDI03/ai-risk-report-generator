"""CB-01 chat eval: the command line (AC9-AC12). Nothing paid runs without --yes.

Run from microservices/rag-service:  uv run --extra dev python -m eval.chat_eval <command>
  init       write _state.json (metrics, perf fields, harness paths) and metrics.md
  docmap     map gold PDF file names to knowledge-document ids (reads MONGODB_URI;
             pymongo isn't a rag-service dependency: `uv run --extra dev --with pymongo ...`)
  split      draw the train/test split once, stratified by tags[0]
  prepare    plan + search every first turn once (shared by every candidate)   [paid]
  run        answer every case through the real pipeline, live or batch        [paid]
  grade      code metrics; with --judge, the judges too                          [paid with --judge]
  selfcheck  oracle / null / judge-prompt checks with fakes                      [free]
Output: .claude/hillclimb/cb01-chat/ at the repo root. Calls eval/chat_runner.py and
eval/chat_grade.py; the human approves the harness (--approve-harness) and every spend (--yes).
"""

import argparse
import hashlib
import json
import os
import random
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

from app import config
from eval import chat_grade, chat_runner, chat_selfcheck

HERE = Path(__file__).parent
SERVICE = HERE.parent
REPO = SERVICE.parent.parent
FLOW = REPO / ".claude" / "hillclimb" / "cb01-chat"
CASES = HERE / "chat_cases" / "cases.json"
# The runner itself, always in the harness sha (paths relative to the repo root).
RUNNER = [
    "microservices/rag-service/eval/chat_eval.py",
    "microservices/rag-service/eval/chat_runner.py",
    "microservices/rag-service/eval/chat_transport.py",
    "microservices/rag-service/eval/chat_grade.py",
    "microservices/rag-service/eval/chat_selfcheck.py",
    "microservices/rag-service/uv.lock",
]
# What a hillclimb round may change; listed in _state.json so the human sees it.
HARNESS_PATHS = [
    "microservices/rag-service/app/chat/answer.py",
    "microservices/rag-service/app/chat/answer_components.txt",
    "microservices/rag-service/app/chat/quotes.py",
    "microservices/rag-service/app/generation/llm.py",
]
METRICS = [
    # Headline first. All "float": a "binary" metric would take the headline from it.
    ("supported", "Supported"),
    ("retrieval_hit", "Retrieval hit"),
    ("quote_found", "Quote found"),
    ("decline_rate", "Decline rate"),
    ("false_decline", "False decline"),
    ("on_topic", "On topic"),
    ("clarified", "Clarified"),
    ("decline_correct", "Decline right"),
    ("supported_anthropic", "Supported (A)"),
    ("supported_openai", "Supported (O)"),
    ("on_topic_anthropic", "On topic (A)"),
    ("on_topic_openai", "On topic (O)"),
]
METRICS_MD = """# CB-01 chat eval metrics

Each is a mean over the turns of a case it applies to; blank = does not apply.

- **supported** (headline, AC9): share of answer statements a judge finds supported by
  their cited passages: every fact in the passage, numbers and units exact, scope not
  widened (all three). Averaged over judge runs, then over judges (`supported_<provider>`).
  A statement citing nothing is unsupported; an empty answer to an answerable question
  counts as 0 of 1; declines, clarifying questions and small talk are left out.
- **retrieval_hit** (AC9): 1 if the passages given to the answer model hold the gold: same
  document id, page inside the passage's page range, key phrase in the passage text
  (lower-cased, punctuation and spacing ignored). `gold` (object or list) needs EVERY
  location; `gold_any` needs ONE. Declined below the relevance cut-off = nothing given = 0.
- **quote_found** (AC9): share of citations whose quoted words were found in the passage.
- **decline_rate** (AC10): declined, on questions the knowledge base cannot answer.
- **false_decline** (AC10, lower is better): declined, on answerable questions.
- **decline_right**: declined exactly when it should (both groups together).
- **on_topic** (AC11): judge yes/no that the answer is about the intended topic, on
  answerable follow-ups (turn 2 on) that carry a `topic`.
- **clarified** (AC5): on an ambiguous turn, asked a question back and did not search.
"""


def eprint(*parts) -> None:
    print(*parts, file=sys.stderr, flush=True)


# ---- files ----------------------------------------------------------------------------------


def load_cases(path: Path) -> list[dict]:
    """Return the cases, refusing ids that can't be file names or that collide."""
    cases = json.loads(path.read_text())
    seen = set()
    for case in cases:
        cid = case["id"]
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", cid) or cid.lower() in seen:
            raise SystemExit(f"case id {cid!r} is not a unique path-safe id")
        seen.add(cid.lower())
    return cases


def load_doc_ids(flow: Path) -> dict | None:
    """Return {gold PDF file name: [knowledge-document ids]} written by `docmap`, or None."""
    path = flow / "doc_ids.json"
    return json.loads(path.read_text()) if path.exists() else None


def fetch_doc_ids() -> dict[str, list[str]]:
    """Return {fileName: [_id, ...]} from MongoDB knowledge_documents (re-uploads give several)."""
    from pymongo import MongoClient

    docs = MongoClient(os.environ["MONGODB_URI"]).get_default_database()["knowledge_documents"]
    found = defaultdict(list)
    for doc in docs.find({}, {"fileName": 1}):
        found[doc["fileName"]].append(str(doc["_id"]))
    return dict(found)


def read_state(flow: Path) -> dict:
    path = flow / "_state.json"
    return json.loads(path.read_text()) if path.exists() else {}


def write_state(flow: Path, state: dict) -> None:
    flow.mkdir(parents=True, exist_ok=True)
    (flow / "_state.json").write_text(json.dumps(state, indent=2) + "\n")


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


# ---- gates ----------------------------------------------------------------------------------


def harness_ok(flow: Path, approve: bool) -> bool:
    """Return True if the harness matches the sha the human approved (or they approve it now).

    A change detector: without it, an edited runner or prompt could run unreviewed in an
    unattended hillclimb round. Only the human passes --approve-harness.
    """
    state = read_state(flow)
    paths = sorted(set(RUNNER + state.get("harness_paths", HARNESS_PATHS)))
    digest = hashlib.sha256()
    for rel in paths:
        path = REPO / rel
        if not path.exists():
            eprint(f"warning: harness path {rel} not found - skipped")
            continue
        digest.update(rel.encode() + b"\0" + path.read_bytes() + b"\0")
    sha = digest.hexdigest()
    if state.get("harness_sha") == sha:
        return True
    if approve:
        write_state(flow, state | {"harness_sha": sha})
        eprint(f"harness approved: sha256 {sha[:12]} over {len(paths)} file(s)")
        return True
    if state.get("harness_sha") is None:
        eprint(f"no approved harness sha (now {sha[:12]} over: {', '.join(paths)}).")
        eprint("Review the harness, then run once with --approve-harness.")
    else:
        eprint(f"harness changed since approval ({state['harness_sha'][:12]} -> {sha[:12]}).")
        eprint("Review the diff, then re-run with --approve-harness.")
    return False


def consent(lines: list[str], yes: bool) -> bool:
    """Print what is about to be spent; return True only if --yes was given."""
    for line in lines:
        eprint(line)
    if not yes:
        eprint("Nothing was spent. Re-run with --yes to go ahead.")
    return yes


# ---- commands -------------------------------------------------------------------------------


def cmd_init(args) -> int:
    """Write _state.json's report config (keeping what's there) and metrics.md."""
    state = read_state(args.flow)
    state.setdefault(
        "metrics",
        [{"id": i, "kind": "float", "label": label, "scale": 1} for i, label in METRICS],
    )
    state["metrics"][4].setdefault("better", "lower")  # false_decline
    state.setdefault(
        "perf_fields",
        [
            {"id": "cost_usd", "label": "Cost", "unit": "$"},
            {"id": "latency_s", "label": "Latency", "unit": "s"},
            {"id": "ttft_s", "label": "First text", "unit": "s"},
        ],
    )
    state.setdefault("harness_paths", HARNESS_PATHS)
    write_state(args.flow, state)
    if not (args.flow / "metrics.md").exists():
        (args.flow / "metrics.md").write_text(METRICS_MD)
    eprint(f"wrote {args.flow / '_state.json'}")
    return 0


def cmd_docmap(args) -> int:
    """Write doc_ids.json from MongoDB (free: no model call)."""
    found = fetch_doc_ids()
    args.flow.mkdir(parents=True, exist_ok=True)
    (args.flow / "doc_ids.json").write_text(json.dumps(found, indent=1))
    eprint(f"mapped {len(found)} file name(s)")
    return 0


def cmd_split(args) -> int:
    """Draw train/test once, stratified by tags[0]; refuse to redraw a fixed split."""
    state = read_state(args.flow)
    if state.get("train_ids"):
        eprint("_state.json already has a split; it is fixed once and never re-drawn.")
        return 2
    groups = defaultdict(list)
    for case in load_cases(args.cases_file):
        groups[case["tags"][0]].append(case["id"])
    rng, train, test = random.Random(args.seed), [], []
    for tag in sorted(groups):
        ids = sorted(groups[tag])
        rng.shuffle(ids)
        cut = round(len(ids) * args.train)
        train += ids[:cut]
        test += ids[cut:]
    write_state(args.flow, state | {"train_ids": sorted(train), "test_ids": sorted(test)})
    eprint(f"split: {len(train)} train, {len(test)} test (seed {args.seed})")
    return 0


def _select(cases: list[dict], ids: str | None) -> list[dict]:
    if not ids:
        return cases
    wanted = set(ids.split(","))
    return [c for c in cases if c["id"] in wanted]


def cmd_prepare(args) -> int:
    """Plan and search every first turn once (shared by all candidates)."""
    cases = _select(load_cases(args.cases_file), args.cases)
    if not harness_ok(args.flow, args.approve_harness):
        return 2
    todo = [c for c in cases if c["id"] in chat_runner.missing_first_turns(cases, args.flow)]
    scope = [
        f"prepare: {len(todo)} case(s) to plan and search ({len(cases) - len(todo)} cached):",
        f"  {len(todo)} plan call(s) on {config.CHAT_PLAN_PROVIDER}:{config.CHAT_PLAN_MODEL}"
        f" + up to {len(todo)} search(es) (Cohere embed + rerank)",
    ]
    if not consent(scope, args.yes):
        return 2
    failed = chat_runner.prepare(todo, args.flow, log=eprint)
    eprint(f"prepare done: {len(todo) - failed} cached, {failed} failed")
    return 1 if failed else 0


def cmd_run(args) -> int:
    """Answer every (case, rep) not yet in results.jsonl; rows land as each case completes."""
    cases = _select(load_cases(args.cases_file), args.cases)
    if not harness_ok(args.flow, args.approve_harness):
        return 2
    missing = chat_runner.missing_first_turns(cases, args.flow)
    if missing:
        eprint(f"{len(missing)} first turn(s) not prepared (e.g. {missing[0]}): run prepare first.")
        return 2
    doc_ids = load_doc_ids(args.flow)
    if doc_ids is None:
        eprint(f"no {args.flow / 'doc_ids.json'}: run docmap first (retrieval_hit needs it).")
        return 2
    vdir = args.flow / args.variant
    done = {(r["prompt_id"], r["rep"]) for r in read_rows(vdir / "results.jsonl")}
    todo = [(c, rep) for c in cases for rep in range(args.reps) if (c["id"], rep) not in done]
    turns = sum(len(c["turns"]) for c, _ in todo)
    follow_ups = turns - len(todo)
    scope = [
        f"run {args.variant}: {len(todo)} (case, rep) of {len(cases)} case(s) x {args.reps}"
        f" rep(s) ({len(done)} done), {turns} turn(s)",
        f"  answer model {args.provider}:{args.model}, effort {args.effort},"
        f" transport {args.transport}: up to {turns} answer call(s)",
        f"  plus up to {follow_ups} follow-up plan call(s) on"
        f" {config.CHAT_PLAN_PROVIDER}:{config.CHAT_PLAN_MODEL} and search(es)",
    ]
    if not consent(scope, args.yes):
        return 2
    for sub in ("traces", "_cache", "batches"):
        (vdir / sub).mkdir(parents=True, exist_ok=True)
    ctx = chat_runner.Context(
        flow=args.flow,
        variant=args.variant,
        provider=args.provider,
        model=args.model,
        effort=args.effort,
        transport=args.transport,
        doc_ids=doc_ids,
        timeout_s=args.timeout_s,
        concurrency=args.concurrency,
        poll_s=args.poll_s,
        batch_timeout_s=args.batch_timeout_s,
        log=eprint,
    )
    # answer_events reads these at call time: the candidate under test.
    saved = (config.CHAT_PROVIDER, config.CHAT_MODEL, config.CHAT_EFFORT)
    config.CHAT_PROVIDER, config.CHAT_MODEL, config.CHAT_EFFORT = (
        args.provider,
        args.model,
        args.effort,
    )
    started = time.monotonic()
    try:
        runner = chat_runner.run_batch if args.transport == "batch" else chat_runner.run_live
        ok, failed = runner(todo, ctx)
    finally:
        config.CHAT_PROVIDER, config.CHAT_MODEL, config.CHAT_EFFORT = saved
    eprint(f"[{args.variant}] done in {time.monotonic() - started:.0f}s: {ok} ok, {failed} failed")
    return 1 if failed else 0


def cmd_grade(args) -> int:
    """Regrade a variant's rows: code metrics always, judges when --judge is given."""
    cases = {c["id"]: c for c in load_cases(args.cases_file)}
    path = args.flow / args.variant / "results.jsonl"
    rows = read_rows(path)
    doc_ids = load_doc_ids(args.flow) or {}
    errors = 0
    if args.judge:
        providers = [spec.split(":", 1)[0] for spec in args.judge]
        if len(set(providers)) != len(providers) or any(":" not in s for s in args.judge):
            eprint("--judge takes provider:model, one per provider")
            return 2
        if not harness_ok(args.flow, args.approve_harness):
            return 2
        answers = sum(
            chat_grade._needs_judge(turn, rec, t)
            for row in rows
            for t, (turn, rec) in enumerate(
                zip(cases[row["prompt_id"]]["turns"], row["turns"], strict=False)
            )
        )
        scope = [
            f"grade {args.variant}: {len(rows)} row(s), {answers} answer(s) to judge",
            f"  x {args.judge_runs} run(s) x judges {', '.join(args.judge)}"
            f" (effort {args.judge_effort}), transport {args.transport}"
            " (rows already judged are skipped)",
        ]
        if not consent(scope, args.yes):
            return 2
        opts = {
            "concurrency": args.concurrency,
            "poll_s": args.poll_s,
            "batch_timeout_s": args.batch_timeout_s,
        }
        errors = chat_grade.grade_rows(
            rows,
            cases,
            args.judge,
            runs=args.judge_runs,
            transport_name=args.transport,
            effort=args.judge_effort,
            vdir=args.flow / args.variant,
            opts=opts,
            log=eprint,
        )
    chat_grade.apply_grades(rows, cases, doc_ids)
    chat_grade.rewrite(path, rows)
    eprint(f"graded {len(rows)} row(s); {errors} judge call(s) failed (re-run grade to retry)")
    return 1 if errors else 0


def cmd_selfcheck(args) -> int:
    """Run the oracle / null / judge-prompt checks with fakes; no network."""
    return 0 if chat_selfcheck.selfcheck(load_cases(args.cases_file), log=eprint) else 1


# ---- parsing --------------------------------------------------------------------------------


def parse(argv: list[str]) -> argparse.Namespace:
    top = argparse.ArgumentParser(prog="eval.chat_eval", description=__doc__.split("\n")[0])
    sub = top.add_subparsers(dest="command", required=True)

    def command(name, *, paid=True):
        p = sub.add_parser(name)
        p.add_argument("--flow", type=Path, default=FLOW)
        p.add_argument("--cases-file", type=Path, default=CASES)
        if paid:
            p.add_argument("--yes", action="store_true", help="spend: confirms the printed scope")
            p.add_argument(
                "--approve-harness", action="store_true", help="the human's approval only"
            )
            p.add_argument("--cases", help="comma-separated case ids (default: all)")
        return p

    def batching(p):
        p.add_argument("--transport", choices=["batch", "live"], default="batch")
        p.add_argument("--concurrency", type=int, default=4)
        p.add_argument("--poll-s", type=float, default=30)
        p.add_argument("--batch-timeout-s", type=float, default=86400)

    def variant(value):
        if not re.fullmatch(r"baseline|v[1-9]\d*", value):
            raise argparse.ArgumentTypeError(
                "must be 'baseline' or 'v<N>' (the report reads only those)"
            )
        return value

    command("init", paid=False)
    command("docmap", paid=False)
    split = command("split", paid=False)
    split.add_argument("--seed", type=int, default=0)
    split.add_argument("--train", type=float, default=0.67)
    command("prepare")
    run = command("run")
    run.add_argument("--variant", type=variant, required=True)
    run.add_argument("--provider", choices=["anthropic", "openai"], required=True)
    run.add_argument("--model", required=True)
    run.add_argument("--effort", default=config.CHAT_EFFORT)
    run.add_argument("--reps", type=int, default=1)
    run.add_argument("--timeout-s", type=float, default=600, help="live, per case; 0 = none")
    batching(run)
    grade = command("grade")
    grade.add_argument("--variant", type=variant, required=True)
    grade.add_argument("--judge", action="append", help="provider:model; repeat for two judges")
    grade.add_argument("--judge-runs", type=int, default=2)
    grade.add_argument("--judge-effort", default="medium")
    batching(grade)
    command("selfcheck", paid=False)
    return top.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Run one command; return its exit code (0 ok, 1 some failed, 2 refused)."""
    args = parse(sys.argv[1:] if argv is None else argv)
    handlers = {
        "init": cmd_init,
        "docmap": cmd_docmap,
        "split": cmd_split,
        "prepare": cmd_prepare,
        "run": cmd_run,
        "grade": cmd_grade,
        "selfcheck": cmd_selfcheck,
    }
    return handlers[args.command](args)


if __name__ == "__main__":
    sys.exit(main())

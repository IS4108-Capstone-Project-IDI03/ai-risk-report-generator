"""Labelling evaluation (IN-05, AC11): scores the five candidates against golden.json.

Run by hand from microservices/ingestion-service (it costs money, under $1, and needs the
keys in the root .env, so it is not in CI):
    uv run python -m eval.labelling.run_eval [--split tune|test|all] [--only id1,id2] [--no-cache]
Use --split tune while tuning prompts; run the test split once, at the end.
Calls app/labelling/ directly on PDF cuts (no upload). Scoring lives in scoring.py.
Raw answers are cached in results/cache.json, so a rerun only calls what changed.
Output is printed and saved to results/<date>[-tune].md.
"""

# ruff: noqa: E501  (markdown table strings are long)
import argparse
import hashlib
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import pymupdf

from app.labelling import config, models, pages, prompt
from eval.labelling import scoring as sc

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]  # repo root; golden "file" paths are relative to it
CACHE = HERE / "results" / "cache.json"
# Skip Jev above this size: its context is ~32k tokens.
JEV_MAX_CHARS = 120_000
LLM_SETTINGS = {
    "haiku": ("anthropic", "claude-haiku-4-5-20251001", models.anthropic_extract),
    "haiku-5.5": ("anthropic", "claude-haiku-5-5", models.anthropic_extract),
    "luna": ("openai", "gpt-6-luna", models.openai_extract),
}
CLASSIFIER_CALLS = {
    "jev": models.jev_classify,
    "openai-decisions": models.openai_decisions_classify,
}
LABELS = {
    "jev": "Jev",
    "openai-decisions": "OpenAI Decisions",
    "haiku": "Haiku 4.5",
    "haiku-5.5": "Haiku 5.5",
    "luna": "GPT-6 Luna",
}


def pct(x) -> str:
    return "-" if x is None else f"{x * 100:.0f}%"


# ── Cache ────────────────────────────────────────────────────────────────


def load_cache(use: bool) -> dict:
    if use and CACHE.exists():
        return json.loads(CACHE.read_text())
    return {"pages": {}, "answers": {}}


def digest(*parts: str) -> str:
    return hashlib.sha256("\x00".join(parts).encode()).hexdigest()[:20]


# ── Step 1: cut and read pages ───────────────────────────────────────────


def read_case(case: dict, cache: dict) -> tuple[str, str]:
    """Return (page_text, wrapped) for a case: its page range cut out, then read like production."""
    path = ROOT / case["file"]
    stat = path.stat()
    key = f"{case['id']}|{case['pages']}|{stat.st_size}|{stat.st_mtime_ns}|{config.OCR_MAX_PAGES}"
    if key in cache["pages"]:
        return tuple(cache["pages"][key])
    with pymupdf.open(path) as src, pymupdf.open() as cut:
        if case["pages"] == "all":
            cut.insert_pdf(src)
        else:
            cut.insert_pdf(src, from_page=case["pages"][0] - 1, to_page=case["pages"][1] - 1)
        count, data = cut.page_count, cut.tobytes()
    os.environ["LABEL_PAGES"] = str(count)
    page_list = pages.read_pages(data)
    result = ("\n".join(t for _, t in page_list), pages.wrap(page_list))
    cache["pages"][key] = list(result)
    return result


# ── Step 2: the five calls ───────────────────────────────────────────────


def call_key(case_id: str, cand: str, wrapped: str) -> str:
    if cand in sc.CLASSIFIERS:
        setup = json.dumps(
            {d: (models._QUESTIONS[d], models._options(d)) for d in config.FIXED_LIST}
        )
    else:
        provider, model, _ = LLM_SETTINGS[cand]
        setup = f"{provider}|{model}|{prompt.SYSTEM_PROMPT}|{json.dumps(prompt.SCHEMA)}"
    return f"{case_id}|{cand}|{digest(wrapped, setup)}"


def run_one(cand: str, wrapped: str) -> dict:
    """Return {status, answers, usage, error} for one call; a raise becomes status 'error'."""
    if cand == "jev" and len(wrapped) > JEV_MAX_CHARS:
        return {"status": "na", "answers": None, "usage": None, "error": "too long"}
    try:
        if cand in sc.CLASSIFIERS:
            answers, usage = CLASSIFIER_CALLS[cand](wrapped)
        else:
            # Settings are process-wide env vars, so the LLMs run one after the other.
            provider, model, fn = LLM_SETTINGS[cand]
            os.environ["LABEL_LLM_PROVIDER"], os.environ["LABEL_LLM_MODEL"] = provider, model
            answers, usage = fn(wrapped)
        return {"status": "ok", "answers": answers, "usage": usage, "error": None}
    except Exception as exc:  # recorded and counted as all-null for that candidate
        return {
            "status": "error",
            "answers": None,
            "usage": None,
            "error": f"{type(exc).__name__}: {exc}"[:200],
        }


def call_case(case: dict, wrapped: str, cache: dict) -> tuple[dict, float]:
    """Return ({candidate: result}, dollars spent on fresh calls) for one case."""
    out, todo = {}, []
    for cand in sc.GROUP_CANDS["fixed"]:
        key = call_key(case["id"], cand, wrapped)
        if key in cache["answers"]:
            out[cand] = cache["answers"][key]
        else:
            todo.append((cand, key))

    def work(group):
        return [(cand, key, run_one(cand, wrapped)) for cand, key in group]

    # Two classifiers in parallel with the LLMs (which share env settings, so go in turn).
    groups = [[t] for t in todo if t[0] in sc.CLASSIFIERS] + [[t for t in todo if t[0] in sc.LLMS]]
    spent = 0.0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for batch in pool.map(work, [g for g in groups if g]):
            for cand, key, result in batch:
                out[cand] = result
                if result["status"] == "ok":
                    cache["answers"][key] = result  # errors are not cached: they should be retried
                    spent += result["usage"]["cost_usd"]
    return out, spent


# ── Report sections ──────────────────────────────────────────────────────


def mean(values):
    values = list(values)
    return sum(values) / len(values) if values else None


def usage_mean(cases, raw, cand, field) -> float | None:
    return mean(
        raw[c["id"]][cand]["usage"][field] for c in cases if raw[c["id"]][cand]["status"] == "ok"
    )


def fmt_cost(x) -> str:
    return "-" if x is None else f"${x:.5f}"


def fmt_time(x) -> str:
    return "-" if x is None else f"{x:.1f}s"


def comparison_tables(rows, cases, raw, cutoff) -> list[str]:
    out = []
    for group, title in (("fixed", "Fixed-list details"), ("free", "Free-text details")):
        note = f" (cutoff {cutoff:.2f})" if group == "fixed" else " (grounded in the page text)"
        for name in ("all", "reports", "standards"):
            subset = [c for c in cases if name == "all" or sc.subset_of(c) == name]
            out += [
                f"### {title}: {name}{note}", "",
                "| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |",
                "|---|---|---|---|---|---|---|",
            ]  # fmt: skip
            for cand in sc.GROUP_CANDS[group]:
                ids = {c["id"] for c in subset}
                m = sc.metrics(
                    [
                        r
                        for r in rows
                        if r["cand"] == cand and r["group"] == group and r["case"] in ids
                    ]
                )
                out.append(
                    f"| {LABELS[cand]} | {m['n']} | {pct(m['correct'])} | {pct(m['auto'])} | "
                    f"{pct(m['cwaf'])} ({m['n_auto']} filled) | "
                    f"{fmt_cost(usage_mean(subset, raw, cand, 'cost_usd'))} | "
                    f"{fmt_time(usage_mean(subset, raw, cand, 'seconds'))} |"
                )
            out.append("")
    return out


def rows_for(cases, raw, texts, cutoff):
    return [
        r
        for c in cases
        for cand in sc.GROUP_CANDS["fixed"]
        for r in sc.score_case(c, cand, raw[c["id"]], texts[c["id"]], cutoff)
    ]


def sweep(cases_by_split, raw, texts):
    """Return {cand: {split: {cutoff: metrics}}} for the fixed-list group."""
    out = {c: {} for c in sc.GROUP_CANDS["fixed"]}
    for cutoff in sc.CUTOFFS:
        for split, cases in cases_by_split.items():
            rows = [r for r in rows_for(cases, raw, texts, cutoff) if r["group"] == "fixed"]
            for cand in out:
                out[cand].setdefault(split, {})[cutoff] = sc.metrics(
                    [r for r in rows if r["cand"] == cand]
                )
    return out


def sweep_section(sw, test_shown) -> tuple[list[str], dict]:
    head = "| Candidate | Cutoff (90% on tune, most auto-filled) | Tune auto-filled | Tune correct when auto-filled |"
    head += " Test correct when auto-filled | Test auto-filled |" if test_shown else ""
    out = ["## Cutoff sweep (fixed-list group)", "", head, "|---" * (6 if test_shown else 4) + "|"]
    chosen = {}
    for cand, by_split in sw.items():
        cutoff = sc.best_cutoff(by_split["tune"])
        chosen[cand] = cutoff
        if cutoff is None:
            best = by_split["tune"][sc.CUTOFFS[-1]]
            line = f"| {LABELS[cand]} | none (at 0.99: {pct(best['cwaf'])}, auto {pct(best['auto'])}) | - | - |"
            out.append(line + (" - | - |" if test_shown else ""))
            continue
        t = by_split["tune"][cutoff]
        line = f"| {LABELS[cand]} | {cutoff:.2f} | {pct(t['auto'])} | {pct(t['cwaf'])} |"
        if test_shown:
            e = by_split["test"][cutoff]
            line += f" {pct(e['cwaf'])} ({e['n_auto']} filled) | {pct(e['auto'])} |"
        out.append(line)
    return out + [""], chosen


def winners(sw, chosen, tune_cases, raw, texts):
    """Return (fixed winner, free winner, cutoff) chosen on the tune split only."""
    fixed_stats = {
        cand: {
            "cutoff": chosen[cand],
            "auto": sw[cand]["tune"][chosen[cand]]["auto"] if chosen[cand] else 0,
            "cwaf": sw[cand]["tune"][chosen[cand]]["cwaf"] if chosen[cand] else 0,
            "cost": usage_mean(tune_cases, raw, cand, "cost_usd") or 0,
        }
        for cand in sw
    }
    rows = [
        r for r in rows_for(tune_cases, raw, texts, config.min_confidence()) if r["group"] == "free"
    ]
    free_stats = {}
    for cand in sc.LLMS:
        m = sc.metrics([r for r in rows if r["cand"] == cand])
        free_stats[cand] = {
            "cwaf": m["cwaf"],
            "auto": m["auto"] or 0,
            "cost": usage_mean(tune_cases, raw, cand, "cost_usd") or 0,
        }
    fixed = sc.pick_fixed_winner(fixed_stats)
    return fixed, sc.pick_free_winner(free_stats), chosen.get(fixed) if fixed else None


def final_section(fixed, free, cutoff, test_cases, raw, texts) -> list[str]:
    rows = [
        r
        for c in test_cases
        for r in sc.final_rows(c, fixed, free, raw[c["id"]], texts[c["id"]], cutoff)
    ]
    m = sc.metrics(rows)
    passed = m["cwaf"] is not None and m["cwaf"] >= sc.TARGET
    verdict = "PASS" if passed else "FAIL"
    return [
        "## Final result (test split, production combination)", "",
        f"Fixed-list: {LABELS[fixed]} at cutoff {cutoff:.2f}. Free-text: {LABELS[free]}.", "",
        f"Correct when auto-filled: {pct(m['cwaf'])} ({m['n_auto']} of {m['n']} details auto-filled, "
        f"{pct(m['auto'])}); correct (all): {pct(m['correct'])}.", "",
        f"**{verdict}** (target 90%)", "",
    ]  # fmt: skip


def sufficiency(golden_cases, cases, raw, texts, full_shown, cutoff) -> list[str]:
    out = ["## First-pages sufficiency", "", "### Evidence beyond the pages read (model-free)", "",
           "Whole-document cases only (extracts are mid-document on purpose).", ""]  # fmt: skip
    late = []
    for c in golden_cases:
        if c["kind"] == "extract":
            continue
        limit = config.OCR_MAX_PAGES if c.get("text_layer") is False else config.DEFAULT_PAGES
        for d, ev in (c["evidence"] or {}).items():
            if ev and ev["page"] > limit:
                late.append(f"| {c['id']} | {d} | {ev['page']} | {limit} |")
    out += (
        ["| Case | Detail | Evidence page | Pages read |", "|---|---|---|---|"]
        + (late or ["| none | | | |"])
        + [""]
    )
    if not full_shown:
        return out + [
            "Full vs first-pages comparison: runs with the test split (full cases are test only).",
            "",
        ]
    out += ["### Full document vs its first pages (details that differ)", ""]
    for full in (c for c in cases if c["kind"] == "full"):
        base = next(
            (
                c
                for c in cases
                if c["file"] == full["file"] and c["pages"] != "all" and c["pages"][0] == 1
            ),
            None,
        )
        if base is None:
            continue
        for cand in sc.GROUP_CANDS["fixed"]:
            statuses = [raw[x["id"]][cand]["status"] for x in (full, base)]
            if "na" in statuses:
                out.append(f"- {full['id']} / {LABELS[cand]}: n/a (too long)")
                continue
            a = {
                (r["group"], r["detail"]): r["got"]
                for r in sc.score_case(full, cand, raw[full["id"]], texts[full["id"]], cutoff)
            }
            b = {
                (r["group"], r["detail"]): r["got"]
                for r in sc.score_case(base, cand, raw[base["id"]], texts[base["id"]], cutoff)
            }
            diff = [
                f"{k[1]}: first pages={b[k]!r}, full={a.get(k)!r}" for k in b if a.get(k) != b[k]
            ]
            out.append(
                f"- {full['id']} / {LABELS[cand]}: "
                + ("; ".join(diff) if diff else "no differences")
            )
    return out + [""]


def mistakes(rows) -> list[str]:
    out = [
        "## Mistakes",
        "",
        "| Case | Candidate | Detail | Expected | Got | Confidence | Evidence |",
        "|---|---|---|---|---|---|---|",
    ]
    for r in sorted(
        (r for r in rows if not r["ok"]), key=lambda r: (r["case"], r["cand"], r["detail"])
    ):
        got = (
            r["got"]
            if r["got"] is not None or r["raw"] is None
            else f"null (model said {r['raw']!r})"
        )
        conf = "-" if r["conf"] is None else f"{r['conf']:.2f}"
        quote = r["quote"].replace("|", "/").replace("\n", " ")[:80]
        out.append(
            f"| {r['case']} | {LABELS[r['cand']]} | {r['detail']} | {r['expected']} | {got} | {conf} | {quote} |"
        )
    return out + [""]


def errors_section(cases, raw) -> list[str]:
    bad = [
        f"- {c['id']} / {LABELS[k]}: {v['error']}"
        for c in cases
        for k, v in raw[c["id"]].items()
        if v["status"] != "ok"
    ]
    return ["## Call errors and n/a", ""] + (bad or ["none"]) + [""]


# ── Main ─────────────────────────────────────────────────────────────────


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--split", choices=["tune", "test", "all"], default="all")
    ap.add_argument("--only", help="comma-separated case ids")
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()
    started = time.monotonic()

    golden = json.loads((HERE / "golden.json").read_text())["cases"]
    only = set(args.only.split(",")) if args.only else None
    shown = [
        c for c in golden if args.split in ("all", c["split"]) and (only is None or c["id"] in only)
    ]
    # Winners are chosen on tune, so tune cases are always run (from cache when unchanged).
    run = shown + [c for c in golden if c["split"] == "tune" and c not in shown and only is None]
    cache, raw, texts, spent = load_cache(not args.no_cache), {}, {}, 0.0
    for case in run:
        texts[case["id"]], wrapped = read_case(case, cache)
        raw[case["id"]], cost = call_case(case, wrapped, cache)
        spent += cost
        print(f"done {case['id']}", file=sys.stderr)
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache))

    main_cases = [c for c in shown if c["kind"] != "full"]
    cutoff = config.min_confidence()  # tables use the config default; the sweep covers the rest
    rows = rows_for(main_cases, raw, texts, cutoff)
    tune = [c for c in run if c["split"] == "tune" and c["kind"] != "full"]
    test = [c for c in run if c["split"] == "test" and c["kind"] != "full"]
    test_shown = args.split != "tune" and only is None

    md = [
        f"# Labelling evaluation ({date.today().isoformat()}"
        + (", tune split only" if args.split == "tune" else "") + ")", "",
        "- Prices (USD per 1M tokens, dated 2026-10-07; Haiku 5.5 2026-10-08): "
        + "; ".join(f"{k} {v[0]} in / {v[1]} out" for k, v in config.PRICES.items()),
        f"- LABEL_PAGES: {config.DEFAULT_PAGES} (OCR capped at the first {config.OCR_MAX_PAGES}); "
        f"each case reads its whole cut. Fixed-list tables use cutoff {cutoff:.2f}.",
        f"- Golden cases shown: {len(shown)} ({sum(c['split'] == 'tune' for c in shown)} tune, "
        f"{sum(c['split'] == 'test' for c in shown)} test; {sum(c['kind'] == 'full' for c in shown)} full-length, "
        "excluded from the tables).",
        "- Known coverage gap: every report is Singapore and only three facility types appear "
        "(office, shopping mall, mixed-use). Other countries and facility types are untested.", "",
        "## Comparison", "",
    ]  # fmt: skip
    md += comparison_tables(rows, main_cases, raw, cutoff)
    md += errors_section(run, raw)
    if tune:
        sw = sweep({"tune": tune, **({"test": test} if test_shown else {})}, raw, texts)
        section, chosen = sweep_section(sw, test_shown)
        md += section
        fixed, free, win_cutoff = winners(sw, chosen, tune, raw, texts)
        md += ["## Winners (chosen on the tune split only)", "",
               f"- Fixed-list: {LABELS[fixed] + f' at cutoff {win_cutoff:.2f}' if fixed else 'none reaches 90% on tune'}",
               f"- Free-text: {LABELS[free] if free else 'none'}", ""]  # fmt: skip
        if test_shown and test:
            if fixed and free:
                section = final_section(fixed, free, win_cutoff, test, raw, texts)
                md += section
            else:
                md += [
                    "## Final result",
                    "",
                    "**FAIL** (no fixed-list winner reached 90% on tune)",
                    "",
                ]
    md += sufficiency(
        golden, run, raw, texts, test_shown and any(c["kind"] == "full" for c in run), cutoff
    )
    md += mistakes(rows)
    md += [
        f"Run cost (fresh calls only): ${spent:.4f}. Wall time: {time.monotonic() - started:.0f}s."
    ]

    text = "\n".join(md)
    print(text)
    suffix = "-tune" if args.split == "tune" else ("-partial" if only else "")
    (HERE / "results" / f"{date.today().isoformat()}{suffix}.md").write_text(text + "\n")


if __name__ == "__main__":
    main()

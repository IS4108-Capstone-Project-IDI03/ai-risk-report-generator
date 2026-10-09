"""Duplicate-detection evaluation (IN-07, AC16): picks the passage similarity T and share S.

Run by hand from microservices/ingestion-service (needs Chroma, Cohere and the OCR models,
so run it inside the ingestion-worker container; not in CI):
    uv run python -m eval.matching.run_eval [--pdfs DIR] [--fresh]
Ingests each PDF once with the real pipeline into its own Chroma collection, scores every
pair with app/matching.py's own counting, and writes results/<date>.md. Scoring: scoring.py.
"""

# ruff: noqa: E501  (markdown table strings are long)
import os

# Must happen before any app module is imported: retrieval_config reads it once.
# A separate collection means the eval never touches the real knowledge base.
os.environ["CHROMA_COLLECTION"] = "in07_eval"

import argparse  # noqa: E402
import json  # noqa: E402
import time  # noqa: E402
from datetime import date  # noqa: E402
from pathlib import Path  # noqa: E402

import numpy as np  # noqa: E402

from app import matching  # noqa: E402
from app.pipeline import run  # noqa: E402
from app.retrieval_config import COLLECTION, chroma_client  # noqa: E402
from eval.matching import scoring as sc  # noqa: E402

HERE = Path(__file__).resolve().parent
CACHE = HERE / "results" / "cache.json"
DEFAULT_PDFS = (
    HERE.parents[min(3, len(HERE.parents) - 1)] / ".local-docs" / "golden" / "try-it" / "in-07"
)
SLOW_SECONDS = 120
# (new, stored, must_flag, note). The edition pair is only reported: the edition rule handles it.
PAIRS = [
    ("C", "A", True, "re-saved copy"),
    ("D", "A", True, "scanned copy (OCR)"),
    ("E", "A", True, "copy without cover"),
    ("B", "A", None, "2022 vs 2019 edition"),
    ("G", "F", False, "two reports, same template"),
    ("I", "H", False, "FM 2.81 vs NFPA 13 chapter 8"),
    ("F", "A", False, "report vs standard"),
    ("H", "A", False, "NFPA 13 chapter 8 vs chapter 4: same headers, different text"),
]


def ingest_all(pdfs: Path, fresh: bool) -> dict:
    """Return {letter: {file, seconds, passages}}; ingest only what the cache lacks."""
    assert COLLECTION.startswith("in07_eval"), "refusing to touch a non-eval collection"
    client = chroma_client()
    cache = {}
    if CACHE.exists() and not fresh:
        cache = json.loads(CACHE.read_text())
    else:
        try:
            client.delete_collection(COLLECTION)
        except Exception:  # first run: nothing to delete
            pass
    for pdf in sorted(pdfs.glob("*.pdf")):
        letter = pdf.name.split("-")[0]
        if letter in cache:
            continue
        start = time.time()
        summary = run(str(pdf), doc_id=letter)
        cache[letter] = {
            "file": pdf.name,
            "seconds": round(time.time() - start, 1),
            "passages": summary["chunks_indexed"],
        }
        print(f"ingested {pdf.name}: {cache[letter]}", flush=True)
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache, indent=2))
    return cache


def best_similarities(new: str, stored: str) -> list[float]:
    """Return, for each passage of `new`, its highest cosine similarity to any passage of `stored`."""
    a = np.array([p["vector"] / np.linalg.norm(p["vector"]) for p in matching._passages(new)])
    b = np.array([p["vector"] / np.linalg.norm(p["vector"]) for p in matching._passages(stored)])
    # A document with no passages has nothing to compare (without this, matmul crashes).
    if not len(a) or not len(b):
        return []
    return (a @ b.T).max(axis=1).tolist()


def score_pairs() -> list[dict]:
    """Return per-pair counts at each T, using matching.py's own counting."""
    rows = []
    for new, stored, must, note in PAIRS:
        by_t = {}
        for t in sc.THRESHOLDS:
            os.environ["MATCH_PASSAGE_SIMILARITY"] = str(
                t
            )  # matching.similarity() reads it per call
            by_t[t] = matching._counts(new, [stored], {stored})[stored]
        sims = best_similarities(new, stored)
        rows.append(
            {"new": new, "stored": stored, "must": must, "note": note, "by_t": by_t, "sims": sims}
        )
    return rows


def pct(x: float) -> str:
    return f"{x * 100:.0f}%"


def write_report(cache: dict, rows: list[dict], pick: dict) -> str:
    """Return the markdown report."""
    out = [f"# Duplicate-detection evaluation ({date.today()})", ""]
    out += [
        f"- Collection: `{COLLECTION}` (isolated). Passages per file: "
        + ", ".join(f"{k} {v['passages']}" for k, v in sorted(cache.items())),
        f"- Top-N per new passage: {matching.TOP_N}. Share of a pair = max(newShare, storedShare).",
        "",
        "## Chosen settings",
        "",
        f"- **T = {pick['T']:.2f}**, **S = {pct(pick['S'])}** (midpoint of the gap).",
        f"- Margin at T={pick['T']:.2f}: **{pct(pick['margin'])}** (lowest copy {pct(pick['low'])}, highest non-copy {pct(pick['high'])}). Any S in that gap classifies every pair correctly.",
        "",
        "## Margin by T",
        "",
        "| T | Lowest copy share | Highest non-copy share | Margin |",
        "|---|---|---|---|",
    ]
    for t, (m, lo, hi) in pick["per_t"].items():
        out.append(f"| {t:.2f} | {pct(lo)} | {pct(hi)} | {pct(m)} |")
    out += ["", "## Pairs (new vs stored)", ""]
    head = "| New | Stored | What | Must flag |" + "".join(
        f" T={t:.2f} new / stored |" for t in sc.THRESHOLDS
    )
    out += [head, "|" + "---|" * (4 + len(sc.THRESHOLDS))]
    for r in rows:
        must = {True: "yes", False: "no", None: "(edition rule)"}[r["must"]]
        cells = ""
        for t in sc.THRESHOLDS:
            c = r["by_t"][t]
            cells += f" {c['newMatched']}/{c['newTotal']} ({pct(c['newMatched'] / max(c['newTotal'], 1))}) / {c['storedMatched']}/{c['storedTotal']} ({pct(c['storedMatched'] / max(c['storedTotal'], 1))}) |"
        out.append(f"| {r['new']} | {r['stored']} | {r['note']} | {must} |{cells}")
    out += [
        "",
        "## Verdict at chosen T and S",
        "",
        "| New | Stored | Share | Flagged as copy | Correct |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        s = sc.share(r["by_t"][pick["T"]])
        flagged = s >= pick["S"]
        ok = "n/a" if r["must"] is None else ("yes" if flagged == r["must"] else "NO")
        out.append(
            f"| {r['new']} | {r['stored']} | {pct(s)} | {'yes' if flagged else 'no'} | {ok} |"
        )
    out += [
        "",
        "## Best-match similarity per new passage",
        "",
        "| New | Stored | min | median | max |",
        "|---|---|---|---|---|",
    ]
    for r in rows:
        a = np.array(r["sims"])
        out.append(
            f"| {r['new']} | {r['stored']} | {a.min():.3f} | {np.median(a):.3f} | {a.max():.3f} |"
        )
    out += [
        "",
        "## Ingest time per file",
        "",
        "| File | Passages | Seconds | |",
        "|---|---|---|---|",
    ]
    for k, v in sorted(cache.items()):
        flag = f"OVER {SLOW_SECONDS}s" if v["seconds"] > SLOW_SECONDS else ""
        out.append(f"| {v['file']} | {v['passages']} | {v['seconds']} | {flag} |")
    out += [
        "",
        "## Rerun",
        "",
        "From the repo root, copy the PDFs and code into the worker and run (cached ingests are skipped; add `--fresh` to rebuild):",
        "",
        "```",
        "docker compose cp microservices/ingestion-service/eval ingestion-worker:/app/eval",
        "docker compose cp .local-docs/golden/try-it/in-07 ingestion-worker:/tmp/in07",
        "docker compose exec -T ingestion-worker uv run python -m eval.matching.run_eval --pdfs /tmp/in07",
        "```",
        "",
        "Then copy `results/` back out with `docker compose cp ingestion-worker:/app/eval/matching/results/. microservices/ingestion-service/eval/matching/results/`.",
    ]
    return "\n".join(out) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdfs", type=Path, default=DEFAULT_PDFS)
    parser.add_argument(
        "--fresh", action="store_true", help="delete the eval collection and re-ingest"
    )
    args = parser.parse_args()
    cache = ingest_all(args.pdfs, args.fresh)
    rows = score_pairs()
    judged = [r for r in rows if r["must"] is not None]
    pick = sc.pick(
        {
            t: {f"{r['new']}{r['stored']}": sc.share(r["by_t"][t]) for r in judged}
            for t in sc.THRESHOLDS
        },
        {f"{r['new']}{r['stored']}": r["must"] for r in judged},
    )
    report = write_report(cache, rows, pick)
    path = HERE / "results" / f"{date.today()}.md"
    path.write_text(report)
    print(report)


if __name__ == "__main__":
    main()

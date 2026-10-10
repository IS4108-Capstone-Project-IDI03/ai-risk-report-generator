"""Table/formula OCR comparison (IN-12): GLM-OCR vs an API provider on FM-200 crops.

Run by hand from microservices/ingestion-service (API calls cost money, well under
$1; GLM needs Ollama with glm-ocr running on localhost:11434):
    uv run python -m eval.ocr.run_eval [--providers anthropic,glm] [--no-cache]
Each table PyMuPDF finds on FM-200 pages 45-56 is cropped (as production does) and
read through `ocr_model.recognise` once per provider. Numbers are scored against
the PDF's own text layer (scoring.py); formulas are printed side by side for a
person to judge. Answers are cached in results/cache.json; the report is printed
and saved to results/<date>.md.
"""

# ruff: noqa: E501  (markdown table strings are long)
import argparse
import json
import os
import time
from datetime import date
from pathlib import Path

import pymupdf
from dotenv import load_dotenv

from app.pipeline.chunking_helper import ocr_model
from app.pipeline.chunking_helper.image_crop import crop_png
from eval.ocr.scoring import number_scores

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
FM200 = (
    ROOT
    / "microservices/ingestion-service/tests/test_files/Tyco Hygood FM-200 Engineered Manual.pdf"
)
CACHE = HERE / "results" / "cache.json"
PAGES = range(45, 57)
# Top-left-origin formula boxes (PyMuPDF has no formula finder).
FORMULAS = [("p49-agent-weight", 49, (126, 174, 300, 198))]
# provider -> model (None: the provider's own setting)
PROVIDERS = {"anthropic": "claude-haiku-5-5", "gemini": "gemini-3.8-flash", "glm": None}


def regions(document: pymupdf.Document) -> list[dict]:
    found = []
    for page_no in PAGES:
        page = document[page_no - 1]
        for n, table in enumerate(page.find_tables().tables, start=1):
            box = tuple(round(v, 1) for v in table.bbox)
            text_layer = page.get_text(clip=pymupdf.Rect(*box))
            found.append(
                {
                    "id": f"p{page_no}-t{n}",
                    "page": page_no,
                    "box": box,
                    "task": "table",
                    "text_layer": text_layer,
                }
            )
    for region_id, page_no, box in FORMULAS:
        text_layer = document[page_no - 1].get_text(clip=pymupdf.Rect(*box)).strip()
        found.append(
            {
                "id": region_id,
                "page": page_no,
                "box": box,
                "task": "formula",
                "text_layer": text_layer,
            }
        )
    return found


def read(provider: str, document: pymupdf.Document, region: dict) -> tuple[str | None, float]:
    os.environ["OCR_PROVIDER"] = provider
    if PROVIDERS[provider]:
        os.environ["OCR_MODEL"] = PROVIDERS[provider]
    png = crop_png(document, region["box"], region["page"], coord_origin="TOPLEFT")
    started = time.monotonic()
    text = ocr_model.recognise(png, region["task"])
    return text, time.monotonic() - started


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--providers", default="anthropic,glm")
    parser.add_argument("--no-cache", action="store_true")
    args = parser.parse_args()
    providers = args.providers.split(",")
    load_dotenv(ROOT / ".env")

    cache = (
        {} if args.no_cache or not CACHE.exists() else json.loads(CACHE.read_text(encoding="utf-8"))
    )
    document = pymupdf.open(FM200)
    found = regions(document)
    for provider in providers:
        for region in found:
            key = f"{provider}:{PROVIDERS[provider]}:{region['id']}:{region['box']}"
            if key not in cache:
                text, seconds = read(provider, document, region)
                cache[key] = {"text": text, "seconds": round(seconds, 1)}
                print(f"{provider:9} {region['id']:18} {seconds:6.1f}s", flush=True)
                CACHE.parent.mkdir(exist_ok=True)
                CACHE.write_text(json.dumps(cache, indent=1, ensure_ascii=False), encoding="utf-8")
            region[provider] = cache[key]

    lines = [
        f"# Table/formula OCR comparison, {date.today()}",
        "",
        f"FM-200 pp. {PAGES.start}-{PAGES.stop - 1}. Recall: share of the PDF's numbers read back. Precision: share of the model's numbers the PDF contains.",
        "",
    ]
    header = (
        "| table | " + " | ".join(f"{p} recall | {p} precision | {p} s" for p in providers) + " |"
    )
    lines += [header, "|" + "---|" * (1 + 3 * len(providers))]
    totals = {p: [0.0, 0.0, 0.0] for p in providers}
    tables = [r for r in found if r["task"] == "table"]
    for region in tables:
        cells = []
        for p in providers:
            recall, precision = number_scores(region[p]["text"], region["text_layer"])
            totals[p][0] += recall
            totals[p][1] += precision
            totals[p][2] += region[p]["seconds"]
            cells.append(f"{recall:.0%} | {precision:.0%} | {region[p]['seconds']}")
        lines.append(f"| {region['id']} | " + " | ".join(cells) + " |")
    n = len(tables) or 1
    lines.append(
        "| **mean** | "
        + " | ".join(
            f"**{t[0] / n:.0%}** | **{t[1] / n:.0%}** | {t[2] / n:.1f}" for t in totals.values()
        )
        + " |"
    )
    lines += ["", "## Formulas", ""]
    for region in (r for r in found if r["task"] == "formula"):
        lines.append(f"**{region['id']}** - PDF text: `{region['text_layer']}`")
        lines += [f"- {p}: `{region[p]['text']}`" for p in providers]
    report = "\n".join(lines) + "\n"
    print(report)
    (HERE / "results" / f"{date.today()}.md").write_text(report, encoding="utf-8")


if __name__ == "__main__":
    main()

"""Automatic document labelling for knowledge-base uploads (IN-05).

Called by POST /label (app/api/routes.py), which the gateway calls during upload
(server/src/services/ingestion.service.ts). Calls pages.py, models.py and decide.py.
"""

import logging
from concurrent.futures import ThreadPoolExecutor

from app.labelling import config, decide, models, pages

logger = logging.getLogger(__name__)


def label_pdf(pdf: bytes) -> dict:
    """Return {details, unconfirmed, usage} for a PDF; never raises for model problems."""
    # 1. Read the first pages (OCR for scanned ones).
    page_list = pages.read_pages(pdf)
    wrapped = pages.wrap(page_list)
    page_text = "\n".join(text for _, text in page_list)

    # 2. Classifier (fixed-list) and LLM (all six) run at once.
    classifier = config.classifier()
    names = {"fixed": classifier if classifier != "none" else config.llm_model(),
             "free": config.llm_model()}  # fmt: skip
    usage: list[dict] = []
    results, failed = {}, False
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {"extract": pool.submit(models.extract_details, wrapped)}
        if classifier != "none":
            futures["classify"] = pool.submit(models.classify_details, wrapped)
        for name, future in futures.items():
            try:
                results[name], used = future.result()
                usage.append(used)
            except Exception:
                # Without this, a model outage would block uploads. Everything becomes
                # Unconfirmed instead.
                logger.exception("Labelling call %s failed", name)
                failed = True
    classified, extracted = (None, {}) if failed else (results.get("classify"), results["extract"])

    # 3. Apply the rules and return the contract shape.
    details = decide.decide(classified, extracted, page_text, names)
    return {"details": details, "unconfirmed": decide.unconfirmed(details), "usage": usage}

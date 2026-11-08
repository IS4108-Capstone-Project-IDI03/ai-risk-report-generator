"""Automatic document labelling for knowledge-base uploads (IN-05).

Called by POST /label (app/api/routes.py), which the gateway calls during upload
(server/src/services/ingestion.service.ts). Calls pages.py, models.py and decide.py.
"""

import datetime
import logging
from concurrent.futures import ThreadPoolExecutor

from app.labelling import config, decide, models, pages
from app.privacy import PrivacyUnavailable, session

logger = logging.getLogger(__name__)


# Singapore (UTC+8, no daylight saving). Without it, a container on UTC would date
# an upload before 8 am Singapore time to the day before.
# Must match server/src/services/knowledge-document.service.ts (uploadDay).
_SINGAPORE = datetime.timezone(datetime.timedelta(hours=8))


def _today() -> str:
    """Return today's Singapore date as YYYY-MM-DD (a function so tests can freeze it)."""
    return datetime.datetime.now(_SINGAPORE).date().isoformat()


def _call_models(wrapped: str, classifier: str) -> tuple[dict, set, list[dict]]:
    """Run the extractor and, unless switched off, the classifier at once.

    Returns each call's answers by name, the names that failed, and the usage of those that
    answered. A failed call is logged, not raised: without that, a model outage would block
    uploads, and the details it would have given become Unconfirmed instead.
    """
    results, failed, usage = {}, set(), []
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {"extract": pool.submit(models.extract_details, wrapped)}
        if classifier != "none":
            futures["classify"] = pool.submit(models.classify_details, wrapped)
        for name, future in futures.items():
            try:
                results[name], used = future.result()
                usage.append(used)
            except Exception:
                logger.exception("Labelling call %s failed", name)
                failed.add(name)
    return results, failed, usage


def label_pdf(pdf: bytes, privacy: dict | None = None) -> dict:
    """Return {details, unconfirmed, usage} for a PDF; never raises for model problems.

    With `privacy` on (PV-05), the pages' client details are masked before any model reads them.
    """
    # 1. Read the first pages (OCR for scanned ones), masked in one call when protected.
    page_list = pages.read_pages(pdf)
    protection = session(privacy)
    try:
        masked = protection.mask([text for _, text in page_list])
    except PrivacyUnavailable:
        # Fail closed (Rule 3): no model reads the pages, and every detail they would have
        # given becomes Unconfirmed, as in a model outage (below). The message holds no text.
        logger.exception("Masking the pages failed; labelling without the models")
        masked = None
    page_list = [(number, text) for (number, _), text in zip(page_list, masked or [])]
    wrapped = pages.wrap(page_list)
    page_text = "\n".join(text for _, text in page_list)

    # 2. Classifier (fixed-list) and LLM (all six) run at once.
    classifier = config.classifier()
    names = {"fixed": classifier if classifier != "none" else config.llm_model(),
             "free": config.llm_model()}  # fmt: skip
    if masked is None:
        results, failed, usage = {}, {"extract", "classify"}, []
    else:
        results, failed, usage = _call_models(wrapped, classifier)
    if "extract" in failed:
        # Keep the classifier's fixed-list answers (None if it failed too). Only the
        # free-text details become Unconfirmed; without this, one LLM outage would
        # throw away source type, country and facility type that Jev already gave.
        classified, extracted = results.get("classify"), {}
    elif "classify" in failed:
        # Classifier down but the LLM answered: use the LLM's fixed-list answers, and
        # name the LLM so the stored model is truthful.
        classified, extracted = None, results["extract"]
        names["fixed"] = config.llm_model()
    else:
        classified, extracted = results.get("classify"), results["extract"]

    # 3. Apply the rules and return the contract shape.
    details = decide.decide(classified, extracted, page_text, names)
    # Checked against the masked pages, as the models read them; returned in real words.
    for detail in details.values():
        if isinstance(detail.get("value"), str):
            detail["value"] = protection.unmask(detail["value"])
        if detail.get("evidence"):
            detail["evidence"]["quote"] = protection.unmask(detail["evidence"]["quote"])
    # A standard's date is when the admin makes it current, not a printed date. A report
    # keeps its grounded date. Without this default, a dateless upload would need review.
    is_standard = details["source_type"]["value"] in config.STANDARDS
    if is_standard or details["effective_date"]["value"] is None:
        details["effective_date"] = {"value": _today(), "confidence": 1.0, "evidence": None,
                                     "model": "default"}  # fmt: skip
    return {"details": details, "unconfirmed": decide.unconfirmed(details), "usage": usage}

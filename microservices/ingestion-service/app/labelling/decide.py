"""Turns raw model answers into confident values or Unconfirmed (IN-05).

Called by app/labelling/__init__.py. Pure functions: no network, no files.
"""

import re
from datetime import date

from app.labelling import config

_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
           "september", "october", "november", "december"]  # fmt: skip


def normalise(text: str) -> str:
    """Return text casefolded, punctuation dropped and whitespace collapsed."""
    return " ".join(re.sub(r"[\W_]+", " ", text.casefold()).split())


def _found(value: str, haystack: str) -> bool:
    return f" {normalise(value)} " in f" {haystack} "


def _date_forms(iso: str) -> list[str] | None:
    """Return the written forms of an ISO date, or None if it is not a real date."""
    try:
        y, m, d = (int(p) for p in iso.split("-"))
        date(y, m, d)
    except ValueError:
        return None
    month = _MONTHS[m - 1]
    names = {month, month[:3], "sept" if m == 9 else month[:3]}
    ordinal = "th" if 10 <= d % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(d % 10, "th")
    forms = [iso, f"{d:02}/{m:02}/{y}", f"{d}/{m}/{y}", f"{d:02}.{m:02}.{y}"]
    for name in names:
        for day in (str(d), f"{d:02}", f"{d}{ordinal}"):
            forms += [f"{day} {name} {y}", f"{name} {day} {y}", f"{name} {day}, {y}"]
        if d == 1:  # "April 2026" only stands for the first of the month
            forms.append(f"{name} {y}")
    return forms


def _nfpa_page(number: str, raw: str) -> bool:
    """Return whether NFPA's page numbering ("13-33": standard 13, page 33) names the number."""
    # Not followed by another dash group, so a date like "13-05-2022" doesn't count.
    return bool(re.search(rf"(?<![\w-]){re.escape(number)}[-–]\d{{1,3}}\b(?![-–]\d)", raw))


def _grounded(
    detail: str, value: str | None, text: str, source_type: str | None = None, raw: str = ""
) -> bool:
    """Return True if a free-text value is valid and its text appears in the pages."""
    if not value:
        return False
    if detail == "standard_number":
        # NFPA numbers are bare ("13", "13R") so the body's name must precede them, or
        # NFPA's page numbers must carry them (an excerpt without its cover); FM's "2-81"
        # is distinctive enough alone. A report has none.
        if source_type == "nfpa_standard":
            return bool(
                re.fullmatch(r"\d+[A-Z]?", value)
                and (_found(f"nfpa {value}", text) or _nfpa_page(value, raw))
            )
        if source_type == "fm_standard":
            return bool(re.fullmatch(r"\d{1,2}-\d{1,3}", value) and _found(value, text))
        return False
    if detail == "edition":
        return bool(
            re.fullmatch(r"\d{4}", value)
            and 1900 <= int(value) <= date.today().year + 1
            and _found(value, text)
        )
    if detail == "effective_date":
        forms = _date_forms(value) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else None
        return bool(forms) and any(_found(f, text) for f in forms)
    return _found(value, text)


def _evidence(answer: dict) -> dict | None:
    if not answer.get("page") or not answer.get("quote"):
        return None
    return {"page": answer["page"], "quote": answer["quote"]}


def decide(classified: dict | None, extracted: dict, page_text: str, models: dict) -> dict:
    """Return {detail: {value, confidence, evidence, model}} after all the rules.

    `classified` is None when LABEL_CLASSIFIER=none (fixed-list comes from `extracted`).
    `models` names the model behind each group: {"fixed": ..., "free": ...}.
    """
    text = normalise(page_text)
    out = {}
    # a. Fixed-list: confident and on the allowed list, else null.
    for d in config.FIXED_LIST:
        answer = (classified or extracted).get(d) or {}
        value, conf = answer.get("value"), float(answer.get("confidence") or 0.0)
        ok = value in config.ALLOWED[d] and conf >= config.min_confidence()
        out[d] = {
            "value": value if ok else None,
            "confidence": conf,
            "evidence": _evidence(answer) if ok and classified is None else None,
            "model": models["fixed"],
        }
    # b. Free-text: only if grounded in the page text. Self-confidence is ignored.
    for d in ("title", "edition", "standard_number", "effective_date"):
        answer = extracted.get(d) or {}
        ok = _grounded(d, answer.get("value"), text, out["source_type"]["value"], page_text)
        out[d] = {
            "value": answer["value"] if ok else None,
            "confidence": 1.0 if ok else 0.0,
            "evidence": _evidence(answer) if ok else None,
            "model": models["free"],
        }
    # c. Cross-detail rules.
    standard = out["source_type"]["value"] in config.STANDARDS
    if not standard:
        out["edition"].update(value=None, confidence=0.0, evidence=None)
    for d in ("jurisdiction", "facility_type"):
        if out[d]["value"] == "all" and not standard:
            out[d].update(value=None, evidence=None)
        elif out[d]["value"] is None and standard:
            out[d].update(value="all", confidence=1.0, evidence=None, model="default")
    return out


def unconfirmed(details: dict) -> list[str]:
    """Return the details with no value, except a report's edition and standard number."""
    is_report = details["source_type"]["value"] == "marsh_report"
    return [
        d for d in config.DETAILS
        if details[d]["value"] is None and not (d in ("edition", "standard_number") and is_report)
    ]  # fmt: skip

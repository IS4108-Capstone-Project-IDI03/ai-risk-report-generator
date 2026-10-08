"""Tests for POST /label (IN-05): rules over faked model answers, and adapter mapping.

Model calls are faked (no network). Real models run only in the evaluation script.
"""

import httpx
import pymupdf
import pytest
from starlette.testclient import TestClient

import app.labelling as labelling
from app.labelling import config, models, pages
from app.main import app

client = TestClient(app)


def pdf_of(*page_texts: str) -> bytes:
    """Build a PDF with one page per string; an empty string is a page with no text layer."""
    doc = pymupdf.open()
    for text in page_texts:
        page = doc.new_page()
        if text:
            page.insert_text((50, 100), text)
    return doc.tobytes()


def ans(value, confidence=0.95, page=1, quote="q"):
    return {"value": value, "confidence": confidence, "page": page, "quote": quote}


STANDARD = {
    "source_type": ans("fm_standard"),
    "title": ans("Water Mist Systems"),
    "edition": ans("2024"),
    "standard_number": ans("2-81"),
    "effective_date": ans("2026-03-05"),
    "jurisdiction": ans("all"),
    "facility_type": ans("all"),
}
TEXT = "Water Mist Systems edition 2024 effective 5 March 2026 Data Sheet 2-81"


TODAY = "2026-10-07"


@pytest.fixture(autouse=True)
def frozen_today(monkeypatch):
    """Freeze the upload date that labelling uses as the default effective date."""
    monkeypatch.setattr(labelling, "_today", lambda: TODAY)


@pytest.fixture
def fake(monkeypatch):
    """Install fake model adapters; returns a dict the test fills in and inspects."""
    state = {"answers": dict(STANDARD), "classified": None, "sent": []}
    monkeypatch.setenv("LABEL_CLASSIFIER", "jev")

    def classify(text):
        state["sent"].append(text)
        fixed = state["classified"] or {
            d: {
                "value": state["answers"][d]["value"],
                "confidence": state["answers"][d]["confidence"],
            }
            for d in ("source_type", "jurisdiction", "facility_type")
        }
        return fixed, {
            "model": "jev",
            "input_tokens": 1,
            "output_tokens": 0,
            "cost_usd": 0,
            "seconds": 0,
        }

    def extract(text):
        state["sent"].append(text)
        return state["answers"], {
            "model": "m",
            "input_tokens": 1,
            "output_tokens": 1,
            "cost_usd": 0,
            "seconds": 0,
        }

    monkeypatch.setattr(models, "classify_details", classify)
    monkeypatch.setattr(models, "extract_details", extract)
    return state


def label(*texts):
    response = client.post("/label", content=pdf_of(*texts))
    assert response.status_code == 200
    return response.json()


def test_confident_vs_unconfirmed_by_cutoff(fake, monkeypatch):
    fake["answers"]["source_type"] = ans("fm_standard", confidence=0.85)
    monkeypatch.setenv("LABEL_MIN_CONFIDENCE", "0.8")
    assert label(TEXT)["details"]["source_type"]["value"] == "fm_standard"
    monkeypatch.setenv("LABEL_MIN_CONFIDENCE", "0.9")
    body = label(TEXT)
    assert body["details"]["source_type"]["value"] is None
    assert "source_type" in body["unconfirmed"]


def test_free_text_not_in_text_is_unconfirmed(fake):
    fake["answers"]["title"] = ans("Something Invented")
    fake["answers"]["edition"] = ans("2019")
    fake["answers"]["effective_date"] = ans("2026-04-01")
    body = label(TEXT)
    assert set(body["unconfirmed"]) == {"title", "edition"}


def test_standard_effective_date_is_upload_date_even_if_model_found_one(fake):
    assert label(TEXT)["details"]["effective_date"] == {
        "value": TODAY,
        "confidence": 1.0,
        "evidence": None,
        "model": "default",
    }


def test_report_keeps_a_grounded_date(fake):
    fake["answers"]["source_type"] = ans("marsh_report")
    assert label(TEXT)["details"]["effective_date"] == {
        "value": "2026-03-05",
        "confidence": 1.0,
        "evidence": {"page": 1, "quote": "q"},
        "model": "gpt-6-luna",
    }


def test_report_without_a_date_uses_upload_date(fake):
    fake["answers"]["source_type"] = ans("marsh_report")
    fake["answers"]["effective_date"] = ans("2026-04-15")  # not written in the text
    body = label(TEXT)
    date = body["details"]["effective_date"]
    assert (date["value"], date["model"], date["confidence"]) == (TODAY, "default", 1.0)
    assert "effective_date" not in body["unconfirmed"]


def test_unconfirmed_source_type_still_gets_a_date(fake):
    fake["answers"]["source_type"] = ans(None)
    body = label(TEXT)
    assert body["details"]["effective_date"]["value"] == "2026-03-05"  # grounded, kept
    assert "effective_date" not in body["unconfirmed"]


def test_month_year_grounds_only_the_first(fake):
    fake["answers"]["source_type"] = ans("marsh_report")
    text = "Water Mist Systems 2024 April 2026"
    fake["answers"]["effective_date"] = ans("2026-04-01")
    assert label(text)["details"]["effective_date"]["value"] == "2026-04-01"
    fake["answers"]["effective_date"] = ans("2026-04-15")
    assert label(text)["details"]["effective_date"]["value"] == TODAY  # not grounded


def test_out_of_list_and_invalid_all_are_unconfirmed(fake):
    fake["answers"]["source_type"] = ans("marsh_report")
    fake["answers"]["jurisdiction"] = ans("all")
    fake["answers"]["facility_type"] = ans("Warehouse")
    body = label(TEXT)
    assert body["details"]["jurisdiction"]["value"] is None
    assert body["details"]["facility_type"]["value"] is None
    assert {"jurisdiction", "facility_type"} <= set(body["unconfirmed"])


def test_standard_with_null_detail_defaults_to_all(fake):
    fake["answers"]["facility_type"] = ans(None)
    facility = label(TEXT)["details"]["facility_type"]
    assert (facility["value"], facility["model"], facility["confidence"]) == ("all", "default", 1.0)
    assert facility["evidence"] is None


def test_report_has_no_edition_and_it_is_not_unconfirmed(fake):
    fake["answers"]["source_type"] = ans("marsh_report")
    fake["answers"]["jurisdiction"] = ans("SG")
    fake["answers"]["facility_type"] = ans("Office")
    body = label(TEXT)
    assert body["details"]["edition"]["value"] is None
    assert body["unconfirmed"] == []


def test_report_has_no_standard_number_and_it_is_not_unconfirmed(fake):
    fake["answers"]["source_type"] = ans("marsh_report")
    fake["answers"]["standard_number"] = ans("2-81")  # a report never has one
    fake["answers"]["jurisdiction"] = ans("SG")
    fake["answers"]["facility_type"] = ans("Office")
    body = label(TEXT)
    assert body["details"]["standard_number"]["value"] is None
    assert body["unconfirmed"] == []


def test_standard_number_is_kept_when_it_has_the_right_shape_and_is_in_the_text(fake):
    body = label(TEXT)
    assert body["details"]["standard_number"]["value"] == "2-81"
    assert "standard_number" not in body["unconfirmed"]


@pytest.mark.parametrize(
    ("source", "value", "text", "kept"),
    [
        ("nfpa_standard", "13", "NFPA 13 Standard", True),
        ("nfpa_standard", "13R", "NFPA 13R Standard", True),
        ("nfpa_standard", "13", "Standard 13 for sprinklers", False),  # no "nfpa" before it
        ("nfpa_standard", "2-81", "NFPA 2-81", False),  # wrong shape for NFPA
        # An excerpt without its cover: NFPA numbers pages "13-33" (standard 13, page 33).
        ("nfpa_standard", "13", "sprinkler protection 13-33 shall be", True),
        ("nfpa_standard", "13", "sprinkler protection 113-33 shall be", False),
        ("nfpa_standard", "13", "Figure 13 33 shows", False),  # no page-number dash
        ("nfpa_standard", "13", "issued 13-05-2022 in Boston", False),  # a date, not a page
        ("fm_standard", "2-81", "Data Sheet 2-81", True),
        ("fm_standard", "2-81", "Data Sheet 2-80", False),  # not in the text
        ("fm_standard", "281", "Data Sheet 281", False),  # wrong shape for FM
    ],
)
def test_standard_number_grounding(fake, source, value, text, kept):
    fake["answers"]["source_type"] = ans(source)
    fake["answers"]["standard_number"] = ans(value)
    # Neutral words keep the page above the OCR cut-off (MIN_TEXT_CHARS in
    # app/labelling/pages.py); a near-empty page would be read by OCR instead,
    # which differs between machines.
    body = label(f"{text}. General requirements apply to every building.")
    assert (body["details"]["standard_number"]["value"] == value) is kept
    assert ("standard_number" in body["unconfirmed"]) is not kept


@pytest.mark.parametrize("error", [httpx.TimeoutException("slow"), RuntimeError("bad json")])
def test_model_error_makes_everything_unconfirmed(fake, monkeypatch, error):
    def boom(text):
        raise error

    monkeypatch.setattr(models, "extract_details", boom)
    body = label(TEXT)
    assert len(body["unconfirmed"]) == 6  # effective_date falls back to the upload date
    assert "effective_date" not in body["unconfirmed"]
    assert all(d["value"] is None for d in body["details"].values() if d["model"] != "default")


def test_classifier_failure_falls_back_to_llm_fixed_list(fake, monkeypatch):
    def boom(text):
        raise httpx.TimeoutException("slow")

    monkeypatch.setattr(models, "classify_details", boom)
    body = label(TEXT)
    assert body["details"]["source_type"]["value"] == "fm_standard"
    assert body["details"]["source_type"]["model"] == config.llm_model()
    assert body["unconfirmed"] == []


def test_only_first_label_pages_are_sent(fake, monkeypatch):
    monkeypatch.setenv("LABEL_PAGES", "2")
    # Each page needs MIN_TEXT_CHARS of text; shorter pages count as scans and go
    # to real OCR, which made this test depend on the OCR engine's output.
    monkeypatch.setattr(pages, "ocr_page", lambda pdf, n: pytest.fail("OCR should not run"))
    label(
        *[f"page {n} text, long enough for a text layer" for n in ("one", "two", "three", "four")]
    )
    sent = fake["sent"][0]
    assert 'n="2"' in sent and "page two" in sent
    assert 'n="3"' not in sent and "page three" not in sent


def test_page_without_text_layer_is_ocrd(fake, monkeypatch):
    monkeypatch.setattr(pages, "ocr_page", lambda pdf, n: "Scanned Title Here")
    fake["answers"]["title"] = ans("Scanned Title Here")
    body = label("")
    assert "Scanned Title Here" in fake["sent"][0]
    assert body["details"]["title"]["value"] == "Scanned Title Here"


def test_ocr_only_in_first_five_pages(fake, monkeypatch):
    called = []
    monkeypatch.setattr(pages, "ocr_page", lambda pdf, n: called.append(n) or "x")
    label(*[""] * 7)
    assert called == [1, 2, 3, 4, 5]


def test_unconfirmed_source_type_flags_edition_too(fake):
    fake["answers"]["source_type"] = ans(None)
    body = label(TEXT)
    assert {"source_type", "edition"} <= set(body["unconfirmed"])
    assert body["details"]["jurisdiction"]["value"] is None  # no standard default


def test_classifier_none_uses_llm_for_fixed_list(fake, monkeypatch):
    monkeypatch.setenv("LABEL_CLASSIFIER", "none")
    fake["answers"]["jurisdiction"] = ans("SG", confidence=0.9, quote="Currency: SGD")
    body = label(TEXT)
    assert len(fake["sent"]) == 1  # classifier never called
    assert body["details"]["jurisdiction"]["value"] == "SG"
    assert body["details"]["jurisdiction"]["evidence"]["quote"] == "Currency: SGD"


def test_invalid_pdf_is_422():
    assert client.post("/label", content=b"not a pdf").status_code == 422


# ---- adapters: request/response mapping with httpx.post faked ----


class Reply:
    is_error = False

    def __init__(self, data):
        self.data = data

    def raise_for_status(self):
        pass

    def json(self):
        return self.data


def capture(monkeypatch, data):
    seen = {}

    def post(url, headers, json, timeout):
        seen.update(url=url, headers=headers, body=json, timeout=timeout)
        return Reply(data)

    monkeypatch.setattr(httpx, "post", post)
    return seen


def test_jev_adapter(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "tk")
    data = {
        "answers": {
            "source_type": {
                "choice": "fm_standard",
                "confidence": 1.0,
                "probabilities": {"fm_standard": 0.9},
            },
            "jurisdiction": {
                "choice": "unknown",
                "confidence": 0.7,
                "probabilities": {"unknown": 0.7},
            },
            "facility_type": {
                "choice": "data_centre",
                "confidence": 0.8,
                "probabilities": {"data_centre": 0.8},
            },
        },
        "usage": {"input_tokens": 1_000_000, "output_tokens": 0},
    }
    seen = capture(monkeypatch, data)
    answers, usage = models.jev_classify("<document/>")
    assert seen["url"] == "https://api.typesafe.ai/v1/systemone"
    assert seen["headers"]["Authorization"] == "Bearer tk"
    assert seen["body"]["state"] == "<document/>"
    assert answers["source_type"] == {"value": "fm_standard", "confidence": 0.9}
    assert answers["jurisdiction"]["value"] is None
    assert answers["facility_type"]["value"] == "Data centre"
    assert usage["cost_usd"] == pytest.approx(0.042)


def test_openai_decisions_adapter_ignores_groq_base_url(monkeypatch):
    monkeypatch.setenv("OPENAI_LABEL_API_KEY", "ok")
    monkeypatch.setenv("OPENAI_API_KEY", "groq")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
    data = {
        "answers": [
            {
                "name": d,
                "choice": "all",
                "confidence": 0.5,
                "probabilities": [{"value": "all", "probability": 0.93}],
            }
            for d in ("jurisdiction", "facility_type")
        ]
        + [
            {
                "name": "source_type",
                "choice": "nfpa_standard",
                "confidence": 0.5,
                "probabilities": [{"value": "nfpa_standard", "probability": 0.6}],
            }
        ],
        "usage": {"input_tokens": 1_000_000, "output_tokens": 0},
    }
    seen = capture(monkeypatch, data)
    answers, usage = models.openai_decisions_classify("t")
    assert seen["url"] == "https://api.openai.com/v1/decisions"
    assert seen["headers"]["Authorization"] == "Bearer ok"
    assert answers["jurisdiction"] == {"value": "all", "confidence": 0.93}
    assert answers["source_type"]["value"] == "nfpa_standard"
    assert usage["cost_usd"] == pytest.approx(0.10)


def test_anthropic_adapter(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "ak")
    monkeypatch.setenv("LABEL_LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("LABEL_LLM_MODEL", raising=False)
    data = {
        "stop_reason": "end_turn",
        "content": [{"text": '{"title": {"value": "T"}}'}],
        "usage": {"input_tokens": 1_000_000, "output_tokens": 1_000_000},
    }
    seen = capture(monkeypatch, data)
    answers, usage = models.anthropic_extract("t")
    assert seen["url"] == "https://api.anthropic.com/v1/messages"
    assert seen["headers"]["x-api-key"] == "ak"
    assert answers["title"]["value"] == "T"
    assert usage["cost_usd"] == pytest.approx(6.0)
    assert seen["body"]["thinking"] == {"type": "disabled"}
    # Haiku 5.5 is priced by its own row, not Haiku 4.5's.
    monkeypatch.setenv("LABEL_LLM_MODEL", "claude-haiku-5-5")
    assert models.anthropic_extract("t")[1]["cost_usd"] == pytest.approx(0.60)
    data["stop_reason"] = "refusal"
    with pytest.raises(RuntimeError):
        models.anthropic_extract("t")


def test_openai_responses_adapter(monkeypatch):
    monkeypatch.setenv("OPENAI_LABEL_API_KEY", "ok")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://api.groq.com/openai/v1")
    monkeypatch.setenv("LABEL_LLM_PROVIDER", "openai")
    data = {
        "output": [
            {"type": "reasoning"},
            {"type": "message", "content": [{"text": '{"title": {"value": "T"}}'}]},
        ],
        "usage": {"input_tokens": 1_000_000, "output_tokens": 1_000_000},
    }
    seen = capture(monkeypatch, data)
    answers, usage = models.extract_details("t")
    assert seen["url"] == "https://api.openai.com/v1/responses"
    assert seen["body"]["model"] == "gpt-6-luna"
    assert answers["title"]["value"] == "T"
    assert usage["cost_usd"] == pytest.approx(0.60)


def test_blank_settings_mean_the_defaults(monkeypatch):
    from app.labelling import config

    for name in ("LABEL_LLM_PROVIDER", "LABEL_LLM_MODEL", "LABEL_PAGES", "LABEL_MIN_CONFIDENCE"):
        monkeypatch.setenv(name, "")
    assert (config.llm_provider(), config.llm_model()) == ("openai", "gpt-6-luna")
    assert (config.pages(), config.min_confidence()) == (20, 0.70)

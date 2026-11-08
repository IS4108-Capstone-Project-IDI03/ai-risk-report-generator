"""PV-05 leak test (the epic's Rule 10): with protection on, no seeded client detail in a past
report reaches any external API at ingestion. Cohere's embed and Chroma's upsert are replaced by
recorders, and the labelling models by adapters that keep what they were sent; the redactor and
the indexer run for real. privacy-service's /mask is faked in-process (conftest `fake_privacy`).

With protection off, the same run sends every seeded detail: that shows the recorders see them.

PV-06 adds a scanned report, with real Docling: its scanned page, its photo crops and what the
OCR model read off a photo all reach the outside world masked or blurred.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pymupdf
import pytest
from rapidocr import RapidOCR
from starlette.testclient import TestClient

from app import pipeline
from app.labelling import models
from app.main import app
from app.pipeline import embedder, indexer
from app.pipeline import sections as report
from app.pipeline.chunking_helper import picture_parser
from app.pipeline.parser import ParsedDocument

SEEDED = ["Acme Pte Ltd", "John Tan", "+65 9123 4567", "S1234567D"]
PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "CLIENT", "names": ["Acme Pte Ltd"]},
        {"type": "PERSON", "names": ["John Tan"]},
    ],
}
LINES = [
    "Acme Pte Ltd Fire Survey",
    "The pump room was shown by John Tan (Tel: +65 9123 4567).",
    "The owner's IC S1234567D is on file. Sprinklers follow NFPA 13.",
]
LABELS = {
    "source_type": "marsh_report",
    "jurisdiction": "SG",
    "facility_type": "Office",
    "effective_date": "2026-03-05",
    "status": "needs_review",
}


def report_pdf(tmp_path) -> Path:
    doc = pymupdf.open()
    page = doc.new_page()
    for n, line in enumerate(LINES):
        page.insert_text((50, 100 + 30 * n), line)
    path = tmp_path / "Survey.pdf"
    doc.save(path)
    return path


@pytest.fixture
def external(monkeypatch):
    """Records what would reach Cohere (embed) and Chroma (upsert)."""
    sent: list[str] = []

    def embed(texts, **_):
        sent.extend(texts)
        return SimpleNamespace(embeddings=SimpleNamespace(float_=[[0.1] for _ in texts]))

    def upsert(ids, documents, embeddings, metadatas):
        sent.extend(documents)
        sent.extend(str(m) for m in metadatas)

    collection = SimpleNamespace(upsert=upsert)
    monkeypatch.setattr(embedder, "cohere_client", lambda: SimpleNamespace(embed=embed))
    monkeypatch.setattr(
        indexer,
        "chroma_client",
        lambda: SimpleNamespace(get_or_create_collection=lambda **_: collection),
    )
    return sent


@pytest.fixture
def read_with_pymupdf(monkeypatch):
    """Parsing and chunking stand-ins that read the PDF they are given, a passage per page, its
    first line as the heading: what Docling would read, without its models."""

    def parse(path, page_range=None, reporter=None):
        return ParsedDocument(doc_name=Path(path).name, page_count=1)

    def chunk(_parsed, doc_path=None, doc_id=None, reporter=None, **_):
        with pymupdf.open(doc_path) as doc:
            pages = [" ".join(page.get_text(sort=True).split()) for page in doc]
        return [
            {
                "id": f"{doc_id}:{n}",
                "text": text,
                "metadata": {
                    "doc_id": doc_id,
                    "page_start": n + 1,
                    "page_end": n + 1,
                    "headings": [text.split(" Fire Survey")[0]],
                },
            }
            for n, text in enumerate(pages)
        ]

    monkeypatch.setattr(pipeline, "parse", parse)
    monkeypatch.setattr(pipeline, "chunk", chunk)
    monkeypatch.setattr(report, "report_sections", lambda _path: [])


def leaked(payloads: list[str]) -> list[str]:
    return [s for s in SEEDED if any(s in p for p in payloads)]


@pytest.mark.parametrize("privacy", [PRIVACY, None], ids=["protected", "control"])
def test_ingesting_a_past_report_sends_no_seeded_detail(
    tmp_path, external, read_with_pymupdf, fake_privacy, privacy
):
    summary = pipeline.run(str(report_pdf(tmp_path)), doc_id="d1", labels=LABELS, privacy=privacy)

    assert summary["chunks_indexed"] == 1
    if privacy:
        assert leaked(external) == [], [p for p in external if leaked([p])]
        assert any("[PERSON_1]" in p for p in external)
    else:  # the control: unprotected, every seeded detail is sent
        assert leaked(external) == SEEDED


def test_labelling_a_past_report_sends_no_seeded_detail(tmp_path, monkeypatch, fake_privacy):
    sent: list[str] = []

    def record(text):
        sent.append(text)
        raise RuntimeError("recorded")  # as a model outage: every detail Unconfirmed

    monkeypatch.setattr(models, "extract_details", record)
    monkeypatch.setattr(models, "classify_details", record)
    monkeypatch.setenv("LABEL_CLASSIFIER", "jev")

    response = TestClient(app).post(
        "/label",
        files={"file": ("Survey.pdf", report_pdf(tmp_path).read_bytes(), "application/pdf")},
        data={"privacy": json.dumps(PRIVACY)},
    )

    assert response.status_code == 200
    assert len(sent) == 2  # the classifier and the extractor
    assert leaked(sent) == [], sent


@pytest.mark.e2e
@pytest.mark.model
def test_docling_reads_the_tags_where_the_details_were(tmp_path, external, fake_privacy):
    # The redactor writes each tag after the page's other text; Docling must place it by
    # position, as PyMuPDF's sorted reading does (redactor.py).
    try:
        pipeline.run(str(report_pdf(tmp_path)), doc_id="d1", labels=LABELS, privacy=PRIVACY)
    except Exception as exc:  # noqa: BLE001
        if exc.__class__.__name__ == "UnparsableDocumentError":
            raise
        pytest.skip(f"Docling models unavailable in this environment: {exc}")

    assert leaked(external) == [], [p for p in external if leaked([p])]
    text = " ".join(external)
    assert "shown by [PERSON_1] (Tel: [PHONE_1])" in text


# --- PV-06: a scanned page, a photo, and a number the OCR model read off the photo.

SIGN = "+65 6123 4567"


def scanned_report_pdf(tmp_path) -> Path:
    """A scanned page (an image of the seeded lines, no text layer), then a typed page with a
    photo, as a site survey's appendix has."""
    doc = pymupdf.open()
    with pymupdf.open() as source:
        typed = source.new_page()
        for n, line in enumerate(LINES):
            typed.insert_text((50, 100 + 40 * n), line, fontsize=12)
        scan = typed.get_pixmap(dpi=150)
    doc.new_page().insert_image(pymupdf.Rect(0, 0, 595, 842), pixmap=scan)
    page = doc.new_page()
    page.insert_text((50, 80), "Appendix A Site photos", fontsize=16)
    photo = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 400, 300), False)
    photo.clear_with(180)
    photo.set_rect(pymupdf.IRect(120, 60, 280, 240), (200, 150, 120))  # a figure in the frame
    page.insert_image(pymupdf.Rect(50, 120, 450, 420), pixmap=photo)
    page.insert_text((50, 440), "Photo 1 Pump room entrance", fontsize=11)
    path = tmp_path / "Scanned survey.pdf"
    doc.save(path)
    return path


@pytest.mark.e2e
@pytest.mark.model
def test_no_seeded_detail_leaves_a_scanned_report(tmp_path, monkeypatch, external, fake_privacy):
    # A guard, passing when first run: PV-06's three parts, with real Docling. The OCR model is
    # faked: it records each crop and describes it with a number read off a sign.
    crops: list[bytes] = []

    def recognise(image_png, task, context=""):
        crops.append(image_png)
        return f"Image description (generated, photograph): A sign reading Call {SIGN}."

    monkeypatch.setattr(picture_parser, "recognise", recognise)
    try:
        pipeline.run(str(scanned_report_pdf(tmp_path)), doc_id="d1", labels=LABELS, privacy=PRIVACY)
    except Exception as exc:  # noqa: BLE001
        if exc.__class__.__name__ in ("UnparsableDocumentError", "PrivacyUnavailable"):
            raise
        pytest.skip(f"Docling models unavailable in this environment: {exc}")

    assert leaked(external) == [], [p for p in external if leaked([p])]
    assert not any(SIGN in p for p in external)  # the safety net caught the sign
    assert any("[PERSON_1]" in p for p in external)  # read off the scanned page's tags
    # Every crop the OCR model saw went through /redact-image first.
    blurred = [i for r in fake_privacy.requests for i in r.get("images", [])]
    assert crops and len(blurred) == len(crops)
    assert not any(leaked([ocr_of(crop)]) for crop in crops)


def ocr_of(image_png: bytes) -> str:
    """What RapidOCR reads in a crop."""
    pixmap = pymupdf.Pixmap(image_png)
    pixels = np.frombuffer(pixmap.samples, np.uint8).reshape(pixmap.height, pixmap.width, pixmap.n)
    return " ".join(RapidOCR()(pixels).txts or ())

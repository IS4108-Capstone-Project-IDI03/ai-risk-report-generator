"""PV-05 leak test (the epic's Rule 10): with protection on, no seeded client detail in a past
report reaches any external API at ingestion. Cohere's embed and Chroma's upsert are replaced by
recorders, and the labelling models by adapters that keep what they were sent; the redactor and
the indexer run for real. privacy-service's /mask is faked in-process (conftest `fake_privacy`).

With protection off, the same run sends every seeded detail: that shows the recorders see them.
"""

import json
from pathlib import Path
from types import SimpleNamespace

import pymupdf
import pytest
from starlette.testclient import TestClient

from app import pipeline
from app.labelling import models
from app.main import app
from app.pipeline import embedder, indexer
from app.pipeline import sections as report
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

"""GET /passages/{id} (CB-02): one passage's text and page boxes, for the citation panel.

Chroma is faked, so no database or paid call is involved.
"""

from unittest.mock import Mock

from chromadb.errors import NotFoundError
from fastapi.testclient import TestClient

from app.chat import passages
from app.main import app

client = TestClient(app)


def fake_chroma(monkeypatch, ids=None, documents=None, metadatas=None):
    """Points the lookup at a fake Chroma that holds at most one record."""
    chroma = Mock()
    chroma.get_collection.return_value.get.return_value = {
        "ids": ids or [],
        "documents": documents or [],
        "metadatas": metadatas or [],
    }
    monkeypatch.setattr(passages, "chroma_client", lambda: chroma)
    return chroma


def test_returns_text_headings_pages_and_boxes(monkeypatch):
    meta = {
        "doc_id": "d1",
        "headings": ["Chapter 8", "Sprinklers"],
        "page_start": 4,
        "page_end": 5,
        "bbox": [1.0, 700.0, 300.0, 650.0, 10.0, 90.0, 200.0, 40.0],
        "bbox_pages": [4, 5],
    }
    fake_chroma(monkeypatch, ["p1"], ["Sprinklers shall be fitted."], [meta])
    response = client.get("/passages/p1")
    assert response.status_code == 200
    assert response.json() == {
        "id": "p1",
        "documentId": "d1",
        "text": "Sprinklers shall be fitted.",
        "headings": ["Chapter 8", "Sprinklers"],
        "pageStart": 4,
        "pageEnd": 5,
        "boxes": [
            {"page": 4, "l": 1.0, "t": 700.0, "r": 300.0, "b": 650.0},
            {"page": 5, "l": 10.0, "t": 90.0, "r": 200.0, "b": 40.0},
        ],
        # A plain passage has no region to crop (KB-02).
        "region": None,
        "generated": False,
    }


def test_missing_metadata_gives_empty_headings_boxes_and_null_pages(monkeypatch):
    fake_chroma(monkeypatch, ["p1"], ["text"], [{"doc_id": "d1"}])
    body = client.get("/passages/p1").json()
    assert (body["headings"], body["boxes"]) == ([], [])
    assert (body["pageStart"], body["pageEnd"]) == (None, None)


def test_boxes_without_bbox_pages_use_the_first_page(monkeypatch):
    meta = {"doc_id": "d1", "page_start": 7, "page_end": 7, "bbox": [1.0, 2.0, 3.0, 4.0]}
    fake_chroma(monkeypatch, ["p1"], ["text"], [meta])
    assert client.get("/passages/p1").json()["boxes"] == [
        {"page": 7, "l": 1.0, "t": 2.0, "r": 3.0, "b": 4.0}
    ]


def test_unknown_id_is_404(monkeypatch):
    fake_chroma(monkeypatch)
    assert client.get("/passages/nope").status_code == 404


def test_missing_collection_is_404(monkeypatch):
    chroma = fake_chroma(monkeypatch)
    chroma.get_collection.side_effect = NotFoundError("missing")
    assert client.get("/passages/p1").status_code == 404


def test_withdrawn_passage_still_opens(monkeypatch):
    chroma = fake_chroma(monkeypatch, ["p1"], ["old"], [{"doc_id": "d1", "status": "withdrawn"}])
    assert client.get("/passages/p1").status_code == 200
    # No status filter: a withdrawn edition's citation (CB-01 AC14) must still open.
    assert "where" not in chroma.get_collection.return_value.get.call_args.kwargs


def test_a_past_report_passage_opens_in_real_words(monkeypatch, stored_mappings):
    # PV-05: past reports are stored with tags; the panel shows what the answer quoted.
    report = "6abb28ae16068a0793e9962a"
    stored_mappings[report] = {"[PERSON_1]": "John Tan", "[CLIENT_1]": "Acme Pte Ltd"}
    meta = {"doc_id": report, "headings": ["[CLIENT_1] survey"]}
    fake_chroma(monkeypatch, ["p1"], ["[PERSON_1] inspected the pump."], [meta])
    body = client.get("/passages/p1").json()
    assert (body["text"], body["headings"]) == (
        "John Tan inspected the pump.",
        ["Acme Pte Ltd survey"],
    )


# KB-02: the region a citation's source crops. Only `region_*` keys name a table or formula
# region, since a table passage's `bbox` also holds the prose and captions beside it.
def test_a_marked_table_region_gives_its_own_boxes_not_the_passage_boxes(monkeypatch):
    meta = {
        "doc_id": "d1",
        "page_start": 4,
        "table_id": "d1:table:3",
        "bbox": [1.0, 700.0, 300.0, 650.0, 1.0, 640.0, 300.0, 400.0],
        "bbox_pages": [4, 4],
        "region_kind": "table",
        "region_bbox": [1.0, 640.0, 300.0, 400.0],
        "region_pages": [4],
    }
    fake_chroma(monkeypatch, ["d1:table:3"], ["Inside Hose > gpm: 250"], [meta])
    assert client.get("/passages/d1:table:3").json()["region"] == {
        "kind": "table",
        "boxes": [{"page": 4, "l": 1.0, "t": 640.0, "r": 300.0, "b": 400.0}],
    }


def test_a_table_passage_without_a_region_marker_has_no_region(monkeypatch):
    # Ingested before region keys: its boxes mix the table with the prose, so no crop is guessed.
    meta = {"doc_id": "d1", "table_id": "d1:table:3", "bbox": [1.0, 700.0, 300.0, 400.0]}
    fake_chroma(monkeypatch, ["d1:table:3"], ["Inside Hose > gpm: 250"], [meta])
    assert client.get("/passages/d1:table:3").json()["region"] is None


def test_a_described_picture_crops_its_own_boxes_and_is_marked_generated(monkeypatch):
    # A picture passage's `bbox` is the picture alone (IN-13), so it crops before region keys exist.
    meta = {
        "doc_id": "d1",
        "bbox": [50.0, 350.0, 250.0, 200.0],
        "bbox_pages": [2],
        "generated_text": "picture_description",
    }
    text = "Figure 3\nImage description (generated, photograph): Two cylinders on a rack."
    fake_chroma(monkeypatch, ["d1:picture:5"], [text], [meta])
    body = client.get("/passages/d1:picture:5").json()
    assert body["region"] == {
        "kind": "picture",
        "boxes": [{"page": 2, "l": 50.0, "t": 350.0, "r": 250.0, "b": 200.0}],
    }
    assert body["generated"] is True


def test_a_marked_formula_region_keeps_each_box_on_its_own_page(monkeypatch):
    meta = {
        "doc_id": "d1",
        "page_start": 8,
        "region_kind": "formula",
        "region_bbox": [40.0, 120.0, 160.0, 60.0, 40.0, 780.0, 160.0, 740.0],
        "region_pages": [8, 9],
    }
    fake_chroma(monkeypatch, ["d1:12"], [r"W = \frac{V}{S}"], [meta])
    assert client.get("/passages/d1:12").json()["region"] == {
        "kind": "formula",
        "boxes": [
            {"page": 8, "l": 40.0, "t": 120.0, "r": 160.0, "b": 60.0},
            {"page": 9, "l": 40.0, "t": 780.0, "r": 160.0, "b": 740.0},
        ],
    }

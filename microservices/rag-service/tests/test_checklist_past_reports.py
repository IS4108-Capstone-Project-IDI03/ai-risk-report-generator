"""Past Marsh reports in the pre-survey checklist (CP-37). Search, rerank, LLM mocked."""

from app.generation.checklist import Citation, PastItem
from tests.test_checklist import generate, item

REPORT = {
    "id": "rep1:7",
    "text": "Racks were loaded above the sprinkler deflectors with no clearance maintained.",
    "metadata": {
        "doc_id": "rep1",
        "source_type": "marsh_report",
        "headings": ["Fire Protection"],
        "page_start": 12,
    },
    "distance": 0.3,
}


def past_item(quote="loaded above the sprinkler deflectors", label="C1"):
    return PastItem(
        area="7",
        subsection=None,
        text="Check that stock is kept clear of the sprinkler deflectors.",
        citation=Citation(label=label, quote=quote),
    )


def past_label(prompts):
    # The label the prompt gave the report passage (R1), found from its block.
    return "R1" if "[R1]" in prompts[0][1] else None


def test_a_site_type_with_past_reports_gets_cited_past_report_items(monkeypatch):
    response, searches, prompts = generate(
        monkeypatch, [], past=[REPORT], past_items=[past_item(label="R1")]
    )
    body = response.json()
    assert body["no_past_reports"] is False
    [found] = [i for i in body["items"] if i["origin"] == "past_report"]
    assert found["citations"][0]["ref"] == "C:rep1:7"
    assert found["citations"][0]["quote_found"] is True
    source = body["sources"]["C:rep1:7"]
    assert (source["title"], source["doc_id"]) == ("Report rep1", "rep1")
    assert "Racks were loaded" in prompts[0][1] and past_label(prompts) == "R1"


def test_past_reports_are_searched_by_facility_type_country_and_source(monkeypatch):
    _, searches, _ = generate(monkeypatch, [], past=[REPORT], facility_type="Office")
    filters = [f for _, f, _ in searches if f.get("source_type") == "marsh_report"]
    assert filters
    assert all(
        f == {"facility_type": "Office", "jurisdiction": "SG", "source_type": "marsh_report"}
        for f in filters
    )


def test_no_past_report_hits_flags_it_and_keeps_the_standards_items(monkeypatch):
    response, _, _ = generate(monkeypatch, [item()])
    body = response.json()
    assert body["no_past_reports"] is True
    assert not [i for i in body["items"] if i["origin"] == "past_report"]
    assert [i for i in body["items"] if i["origin"] == "hazard"]


def test_a_past_report_item_whose_quote_is_not_in_its_passage_is_dropped(monkeypatch):
    response, _, _ = generate(
        monkeypatch, [], past=[REPORT], past_items=[past_item(quote="invented words", label="R1")]
    )
    assert not [i for i in response.json()["items"] if i["origin"] == "past_report"]


def test_the_prompt_version_is_reported(monkeypatch):
    response, _, _ = generate(monkeypatch, [], past=[REPORT])
    assert response.json()["provenance"]["prompt_version"] == "cp37-v1"

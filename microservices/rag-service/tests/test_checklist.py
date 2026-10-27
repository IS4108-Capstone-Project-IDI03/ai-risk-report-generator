"""Pre-survey checklist (CP-30). Search, rerank and the LLM are mocked."""

import pytest
from fastapi.testclient import TestClient

from app.generation.checklist import (
    CHECKLIST,
    ChecklistDraft,
    Citation,
    Item,
    hazards_for,
    named_standard,
    template_items,
)
from app.generation.generator import TEMPLATE
from app.generation.llm import GenerationFailed
from app.main import app

client = TestClient(app)

NFPA13 = {"id": "nfpa13", "source_type": "nfpa_standard", "standard_number": "13"}
FM157 = {"id": "fm157", "source_type": "fm_standard", "standard_number": "1-57"}
SS575 = {"id": "ss575", "source_type": "local_standard", "standard_number": "575"}
RACKS = {
    "id": "nfpa13:118",
    "text": "In-rack sprinklers shall be provided for rack storage over 7.6 m in height.",
    "metadata": {"doc_id": "nfpa13", "headings": ["Rack Storage"], "page_start": 118},
    "distance": 0.4,
}
ROOF = {
    "id": "fm157:4",
    "text": "Insulated panels with expanded polystyrene cores are combustible.",
    "metadata": {"doc_id": "fm157", "headings": ["Insulated Panels"], "page_start": 4},
    "distance": 0.45,
}


@pytest.fixture(autouse=True)
def keep_vector_order(monkeypatch):
    # Rerank is a paid Cohere call: every test keeps the vector order unless it replaces this.
    monkeypatch.setattr(
        "app.orchestrator.orchestrator.rerank", lambda query, passages, top_n=None: passages
    )


def item(area="hazards", hazard="rack_storage", subsection=None, text=None, citations=None):
    return Item(
        area=area,
        subsection=subsection,
        hazard=hazard,
        text=text or "Check in-rack sprinklers are fitted for racks over 7.6 m.",
        citations=citations
        if citations is not None
        else [Citation(label="C1", quote="rack storage over 7.6 m in height")],
    )


def generate(monkeypatch, items, facility_type="Distribution warehouse", standards=(NFPA13,)):
    searches, prompts = [], []

    def search(requests):
        searches.extend(requests)
        return [[RACKS, ROOF] for _ in requests]

    def complete(system, user, schema, effort):
        prompts.append((system, user, effort))
        return ChecklistDraft(items=items), "claude-opus-5-5"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.generation.checklist.complete", complete)
    response = client.post(
        "/checklist/draft",
        json={
            "facility_type": facility_type,
            "jurisdiction": "SG",
            "standards": list(standards),
        },
    )
    return response, searches, prompts


def test_every_template_subsection_but_comments_is_an_item():
    # AC3: one item per subsection of Sections 6-12, in report order, written in code.
    expected = [
        (section_id, sub["heading"])
        for section_id in CHECKLIST["template_sections"]
        for sub in TEMPLATE["sections"][section_id]["subsections"]
        if not sub["heading"].endswith("Comments")
    ]
    made = template_items()
    assert [(i["area"], i["subsection"]) for i in made] == expected
    assert all(i["origin"] == "template" and not i["citations"] for i in made)
    # Construction covers walls, roof and frame.
    narrative = next(i for i in made if i["subsection"] == "Construction Narrative")
    assert all(word in narrative["text"] for word in ("Walls", "roof", "frame"))
    # A subsection with fields lists them.
    power = next(i for i in made if i["subsection"] == "Power")
    assert "Site Feed" in power["fields"]
    # Every item says what to check: fields, or a description, never a bare heading.
    assert all(i["fields"] or i["text"] != i["subsection"] for i in made)


def test_every_configured_hazard_names_standards_the_knowledge_base_can_match():
    for facility_type, hazards in CHECKLIST["hazards"].items():
        assert 3 <= len(hazards) <= 5, facility_type
        assert len({h["id"] for h in hazards}) == len(hazards)
        for h in hazards:
            assert h["standards"] and h["item"] and h["search"]
            for name in h["standards"]:
                named_standard(name)  # raises for an issuer the knowledge base doesn't label


def test_a_warehouse_checklist_covers_its_hazards_with_cited_items(monkeypatch):
    response, searches, prompts = generate(monkeypatch, [item()])
    assert response.status_code == 200
    body = response.json()
    hazard_items = [i for i in body["items"] if i["area"] == "hazards"]
    # AC4: every warehouse hazard has an item; the one the model wrote comes first.
    assert [i["hazard"] for i in hazard_items] == [
        h["id"] for h in hazards_for("Distribution warehouse")
    ]
    [racks, *config_items] = hazard_items
    assert racks["origin"] == "hazard"
    # AC6: the label maps back to the passage, its quote is found in it, and the source
    # carries its page for the citation panel.
    assert racks["citations"] == [
        {"ref": "C:nfpa13:118", "quote": "rack storage over 7.6 m in height", "quote_found": True}
    ]
    assert body["sources"]["C:nfpa13:118"]["page_start"] == 118
    # A hazard the model left out still gets the config's item: written by the team, not the
    # model (AC8), so it has its own origin, and marked uncited.
    assert all(
        i["origin"] == "hazard_list" and i["flags"] == ["uncited"] and not i["citations"]
        for i in config_items
    )
    # AC9: provenance names the model, prompt and hazard list.
    provenance = body["provenance"]
    assert provenance["model"] == "claude-opus-5-5"
    assert provenance["prompt_version"].startswith("cp30")
    assert provenance["checklist_version"] == CHECKLIST["version"]
    assert provenance["effort"] == prompts[0][2] == "medium"
    assert isinstance(body["usage"], list)


def test_warehouse_and_office_checklists_cover_only_their_own_hazards(monkeypatch):
    # AC5: the facility type decides the hazards.
    warehouse, _, _ = generate(monkeypatch, [])
    office, _, office_prompts = generate(monkeypatch, [], facility_type="Office")
    hazards = {
        name: {i["hazard"] for i in r.json()["items"] if i["area"] == "hazards"}
        for name, r in (("warehouse", warehouse), ("office", office))
    }
    assert "rack_storage" in hazards["warehouse"] and "rack_storage" not in hazards["office"]
    assert "server_rooms" in hazards["office"] and "server_rooms" not in hazards["warehouse"]
    assert "Rack and high-piled storage" not in office_prompts[0][1]


def test_only_the_standards_in_scope_are_searched(monkeypatch):
    # AC2: an unticked standard is never searched, so no item can cite it.
    _, searches, _ = generate(monkeypatch, [], standards=(NFPA13, SS575))
    assert all(set(filters["doc_id"]) <= {"nfpa13", "ss575"} for _, filters, _ in searches)


def test_a_hazard_is_searched_within_its_own_standards_when_they_are_in_scope(monkeypatch):
    # AC7: racks are checked against NFPA 13, so only NFPA 13 is searched for them; the
    # roof's FM 1-57 is not in scope, so it is searched across every standard in scope.
    response, searches, _ = generate(monkeypatch, [], standards=(NFPA13, SS575))
    by_query = {query: filters["doc_id"] for query, filters, _ in searches}
    assert by_query[
        "Distribution warehouse: " + hazards_for("Distribution warehouse")[0]["search"]
    ] == ["nfpa13"]
    assert by_query[
        "Distribution warehouse: " + hazards_for("Distribution warehouse")[1]["search"]
    ] == ["nfpa13", "ss575"]
    in_scope = {h["id"]: h["in_scope"] for h in response.json()["hazards"]}
    assert in_scope["rack_storage"] == ["NFPA 13"]
    assert in_scope["roofing"] == []


def test_a_citation_of_a_passage_not_given_is_dropped_and_the_item_marked_uncited(monkeypatch):
    response, _, _ = generate(
        monkeypatch,
        [
            item(citations=[Citation(label="C9", quote="made up")]),
            item(
                area="7",
                hazard=None,
                subsection="Details on Combustible Construction",
                text="Check insulated panels for expanded polystyrene cores.",
                citations=[Citation(label="C2", quote="not in the passage")],
            ),
        ],
        standards=(NFPA13, FM157),
    )
    items = response.json()["items"]
    racks = next(i for i in items if i["hazard"] == "rack_storage")
    assert racks["citations"] == [] and racks["flags"] == ["uncited"]
    # A quote that isn't in the passage is kept, marked as not found.
    panels = next(i for i in items if i["origin"] == "standard")
    assert panels["citations"][0]["quote_found"] is False
    # It sits right after its subsection's template item.
    position = items.index(panels)
    assert items[position - 1]["subsection"] == "Details on Combustible Construction"
    assert items[position - 1]["origin"] == "template"


def test_an_item_for_an_unknown_area_or_hazard_is_dropped(monkeypatch):
    response, _, _ = generate(
        monkeypatch, [item(area="3", hazard=None), item(hazard="forklift_racing")]
    )
    written = [i for i in response.json()["items"] if i["origin"] != "template"]
    assert {i["origin"] for i in written} == {"hazard_list"}  # only the config's hazard items


def test_with_no_standards_in_scope_nothing_is_searched_or_generated(monkeypatch):
    # AC10: template and hazard items only, with no paid call.
    response, searches, prompts = generate(monkeypatch, [item()], standards=())
    body = response.json()
    assert not searches and not prompts
    assert body["provenance"]["model"] is None
    assert {i["origin"] for i in body["items"]} == {"template", "hazard_list"}
    assert body["sources"] == {}


def test_the_prompt_names_only_the_kind_of_site(monkeypatch):
    # No client detail is sent: the request has no field for one, so nothing needs masking.
    response = client.post(
        "/checklist/draft",
        json={"facility_type": "Office", "jurisdiction": "SG", "client": "Northgate"},
    )
    assert response.status_code == 422


def test_a_rerank_failure_keeps_the_vector_order(monkeypatch):
    def fail(query, passages, top_n=None):
        raise RuntimeError("trial key limit")

    monkeypatch.setattr("app.orchestrator.orchestrator.rerank", fail)
    response, _, prompts = generate(monkeypatch, [item()])
    assert response.status_code == 200
    assert "In-rack sprinklers" in prompts[0][1]


def test_a_model_failure_is_a_502_with_its_reason(monkeypatch):
    def complete(system, user, schema, effort):
        raise GenerationFailed("The language model could not be reached.")

    monkeypatch.setattr("app.orchestrator.orchestrator.search", lambda r: [[RACKS] for _ in r])
    monkeypatch.setattr("app.generation.checklist.complete", complete)
    response = client.post(
        "/checklist/draft",
        json={"facility_type": "Office", "jurisdiction": "SG", "standards": [NFPA13]},
    )
    assert response.status_code == 502
    assert response.json()["detail"] == "The language model could not be reached."


def test_the_eval_scores_coverage_and_citations_in_code(monkeypatch):
    # AC12: every template area and hazard covered, every citation resolving to a standard
    # in scope; counted without a judge.
    from app.api.routes import ScopeStandard
    from eval.score_checklist import score

    response, _, _ = generate(monkeypatch, [item()])
    scored = score(response.json(), [ScopeStandard(**NFPA13)])
    hazards = len(hazards_for("Distribution warehouse"))
    assert scored["template_items"] == f"{len(template_items())}/{len(template_items())}"
    assert scored["hazards_covered"] == f"{hazards}/{hazards}"
    assert scored["hazards_cited"] == f"1/{hazards}"
    # Racks cites NFPA 13, the standard it is checked against (AC7), known by its number.
    assert scored["hazards_cited_by_own_standard"] == f"1/{hazards}"
    assert scored["citations"] == scored["citations_resolving"] == scored["quotes_found"] == 1
    # A citation of a standard out of scope does not resolve.
    assert score(response.json(), [ScopeStandard(**FM157)])["citations_resolving"] == 0


def test_each_area_and_hazard_keeps_its_own_passages_and_the_model_is_told_which(monkeypatch):
    # A reranker that ranks the roof passage first and the racks passage out of the cap still
    # leaves each search its own nearest passages, so no area goes without (cp30-v2).
    monkeypatch.setattr("app.orchestrator.orchestrator.MAX_CHECKLIST_PASSAGES", 1)
    monkeypatch.setattr(
        "app.orchestrator.orchestrator.rerank",
        lambda query, passages, top_n=None: sorted(passages, key=lambda p: p["id"] != ROOF["id"]),
    )
    response, _, prompts = generate(monkeypatch, [item()], standards=(NFPA13, FM157))
    assert response.status_code == 200
    _, user, _ = prompts[0]
    assert "In-rack sprinklers" in user and "expanded polystyrene" in user
    found = user.split("<found_for>")[1].split("</found_for>")[0]
    # Every report area and hazard is listed, each with what was found for it.
    for key in [
        *CHECKLIST["template_sections"],
        *(h["id"] for h in hazards_for("Distribution warehouse")),
    ]:
        assert f'- "{key}": ' in found


def test_a_passage_found_by_several_searches_is_offered_under_the_nearest_only(monkeypatch):
    # Offered under two areas, the model wrote the same requirement in both (cp30-v3).
    def search(requests):
        # Racks is nearest to the Fire Protection (9) search, further from every other area's;
        # no hazard's search finds it.
        hazard_queries = {f"Office: {h['search']}" for h in hazards_for("Office")}
        return [
            []
            if query in hazard_queries
            else [{**RACKS, "distance": 0.2 if ": Fire Protection:" in query else 0.5}]
            for query, _, _ in requests
        ]

    prompts = []

    def complete(system, user, schema, effort):
        prompts.append(user)
        return ChecklistDraft(items=[]), "claude-opus-5-5"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.generation.checklist.complete", complete)
    client.post(
        "/checklist/draft",
        json={"facility_type": "Office", "jurisdiction": "SG", "standards": [NFPA13]},
    )
    found = prompts[0].split("<found_for>")[1].split("</found_for>")[0].splitlines()
    assert [line for line in found if "C1" in line] == ['- "9": C1']


def test_the_hazard_list_covers_exactly_the_facility_types_the_forms_offer():
    # Keep in step with FACILITY_TYPES in client/src/features/assessments/demo-data.ts and
    # server/src/services/knowledge-document.service.ts: a type missing here gets no hazards.
    assert set(CHECKLIST["hazards"]) == {
        "Distribution warehouse",
        "Cold store",
        "Chemical plant",
        "Paper mill",
        "Port terminal",
        "Data centre",
        "Office",
        "Shopping mall",
        "Mixed-use development",
    }


def test_the_eval_reads_the_standards_and_their_numbers_from_the_gateways_cases(tmp_path):
    from eval.score_checklist import load_cases

    path = tmp_path / "checklist_cases.json"
    path.write_text(
        '{"country": "SG", "standards": {"Office": [{"id": "nfpa13", "title": "NFPA 13", '
        '"source_type": "nfpa_standard", "standard_number": "13"}]}}'
    )
    country, cases = load_cases(path)
    assert country == "SG"
    assert cases["Office"][0].standard_number == "13"
    with pytest.raises(SystemExit):
        load_cases(tmp_path / "missing.json")


def test_a_hazard_keeps_a_passage_its_search_found_even_if_an_area_found_it_nearer(monkeypatch):
    # AC7: the hazard is checked against its own standards first, so it wins the passage.
    racks_query = "Distribution warehouse: " + hazards_for("Distribution warehouse")[0]["search"]

    def search(requests):
        return [
            [{**RACKS, "distance": 0.4}]
            if query == racks_query
            else [{**RACKS, "distance": 0.2}]
            if ": Fire Protection:" in query
            else []
            for query, _, _ in requests
        ]

    prompts = []

    def complete(system, user, schema, effort):
        prompts.append(user)
        return ChecklistDraft(items=[]), "claude-opus-5-5"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.generation.checklist.complete", complete)
    client.post(
        "/checklist/draft",
        json={
            "facility_type": "Distribution warehouse",
            "jurisdiction": "SG",
            "standards": [NFPA13],
        },
    )
    found = prompts[0].split("<found_for>")[1].split("</found_for>")[0].splitlines()
    assert [line for line in found if "C1" in line] == ['- "rack_storage": C1']


def test_each_area_is_searched_and_described_by_what_it_covers_not_its_title(monkeypatch):
    # Searched by title alone, Management Programs drew passages no other search claimed,
    # and the model filed items like idle pallet storage there (cp30-v4).
    searches = []

    def search(requests):
        searches.extend(requests)
        return [[RACKS] for _ in requests]

    prompts = []

    def complete(system, user, schema, effort):
        prompts.append((system, user))
        return ChecklistDraft(items=[]), "claude-opus-5-5"

    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.generation.checklist.complete", complete)
    client.post(
        "/checklist/draft",
        json={"facility_type": "Office", "jurisdiction": "SG", "standards": [NFPA13]},
    )
    programs = next(query for query, _, _ in searches if ": Management Programs:" in query)
    assert "Hot Work Permit System" in programs and "Housekeeping" in programs
    system, user = prompts[0]
    assert "Hot Work Permit System" in user.split("<report_areas>")[1]
    assert "not where an item goes" in system


def test_an_item_in_a_section_of_one_subsection_is_put_under_it(monkeypatch):
    # The model leaves Management Programs' only subsection null; the tab shows "Under ...".
    programs = item(area="6", hazard=None, text="Check control valve keys are controlled.")
    response, _, _ = generate(monkeypatch, [programs])
    [written] = [i for i in response.json()["items"] if i["origin"] == "standard"]
    assert written["subsection"] == "Management Programs"


def test_a_heading_too_long_to_be_one_is_not_shown_to_the_model(monkeypatch):
    # FM 2-0's loss examples were ingested as a heading; the model quoted them, though the
    # passage's text did not hold them, and every such quote was unverified.
    story = "3.2.2 Loss Examples. " + "The plant's hot work permit system was not followed. " * 5
    monkeypatch.setattr(
        "app.orchestrator.orchestrator.search",
        lambda requests: [
            [{**RACKS, "metadata": {**RACKS["metadata"], "headings": ["Rack Storage", story]}}]
            for _ in requests
        ],
    )
    prompts = []

    def complete(system, user, schema, effort):
        prompts.append((system, user))
        return ChecklistDraft(items=[]), "claude-opus-5-5"

    monkeypatch.setattr("app.generation.checklist.complete", complete)
    client.post(
        "/checklist/draft",
        json={"facility_type": "Office", "jurisdiction": "SG", "standards": [NFPA13]},
    )
    system, user = prompts[0]
    assert "(Rack Storage, p. 118)" in user
    assert "hot work permit" not in user
    # Nor is a story of a past fire a requirement to check (cp30-v5).
    assert "Never base an item on one." in system

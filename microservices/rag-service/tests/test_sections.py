"""Section drafting (GN-01). Retrieval and the LLM are mocked."""

from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient

from app.generation.generator import SectionDraft, Statement, Subsection
from app.generation.llm import GenerationFailed
from app.main import app
from app.retrieval import retriever
from app.retrieval.retriever import label_filter

client = TestClient(app)

REQUEST = {
    "section_id": "7",
    "assessment": {
        "reference": "RPT-2026-0001",
        "jurisdiction": "Singapore",
        "facility_type": "Office",
        "standards": ["FM Global 2-0"],
    },
    "observations": [
        {
            "id": "obs1",
            "COPE_dimension": "Construction",
            "note": "Riser shafts on L3 are not fire-stopped.",
            "transcripts": ["Curtain wall gaps filled with rock wool."],
            "severity": "high",
            "location": "Level 3 riser",
        }
    ],
}

STANDARD = {
    "id": "fm:4",
    "text": "Fire-stop penetrations in rated walls.",
    "metadata": {"doc_id": "fm", "headings": ["Fire Stopping"], "page_start": 4, "page_end": 5},
}
PRECEDENT = {
    "id": "rep:9",
    "text": "The building is of fire-resistive construction.",
    "metadata": {"doc_id": "rep", "headings": ["Property Risk Evaluation Report", "Construction"]},
}
OFF_SECTION_PRECEDENT = {
    "id": "rep:1",
    "text": "Executive summary text.",
    "metadata": {"doc_id": "rep", "headings": ["Executive Summary"]},
}


def fake_search(calls):
    def search(requests):
        calls.extend(requests)
        return [
            [PRECEDENT, OFF_SECTION_PRECEDENT]
            if filters["source_type"] == "marsh_report"
            else [STANDARD]
            for _, filters, _ in requests
        ]

    return search


def nothing_found(requests):
    return [[] for _ in requests]


def fake_complete(prompts, subsections, questions=()):
    def complete(system, user, schema, effort):
        prompts.append((system, user, effort))
        return SectionDraft(subsections=subsections, questions=list(questions)), "claude-opus-5-5"

    return complete


def draft(monkeypatch, subsections, search=None):
    calls, prompts = [], []
    # Pinned, so the tests don't depend on the effort set in .env.
    monkeypatch.setattr("app.config.LLM_EFFORT", "high")
    monkeypatch.setattr("app.orchestrator.orchestrator.search", search or fake_search(calls))
    monkeypatch.setattr("app.generation.generator.complete", fake_complete(prompts, subsections))
    return client.post("/sections/draft", json=REQUEST), calls, prompts


def test_draft_follows_the_template_order_and_records_provenance(monkeypatch):
    # The model answers out of order, with an unknown heading. The template decides.
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Compartmentalization and Fire Divisions",
                statements=[Statement(text="Risers were not fire-stopped.", citations=["O:obs1"])],
            ),
            Subsection(heading="Invented heading", statements=[]),
            Subsection(
                heading="Construction Narrative",
                statements=[Statement(text="Rock wool fills the gaps.", citations=["O:obs1"])],
            ),
        ],
    )
    assert response.status_code == 200
    body = response.json()
    assert [s["heading"] for s in body["subsections"]] == [
        "Construction Narrative",
        "Construction Table",
        "Compartmentalization and Fire Divisions",
        "Details on Combustible Construction",
    ]
    assert body["subsections"][1] == {
        "heading": "Construction Table",
        "kind": "table",
        "statements": [],
    }
    assert body["guardrail"] == {"passed": True, "unsupported_count": 0}
    provenance = body["provenance"]
    assert provenance["model"] == "claude-opus-5-5"
    assert provenance["prompt_version"] == "gn01-v2.3"
    assert provenance["template_version"] == "global-pre-v2.0-2026-02"
    assert provenance["effort"] == "high"
    assert provenance["generated_at"]


def test_unresolvable_and_past_report_citations_are_unsupported(monkeypatch):
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Construction Narrative",
                statements=[
                    Statement(text="Backed by a standard.", citations=["O:obs1", "C:fm:4"]),
                    Statement(text="Made-up source.", citations=["C:nope"]),
                    Statement(text="Only a past report.", citations=["P:rep:9"]),
                    Statement(text="No citation.", citations=[]),
                ],
            )
        ],
    )
    body = response.json()
    supported = [s["supported"] for s in body["subsections"][0]["statements"]]
    assert supported == [True, False, False, False]
    assert body["guardrail"] == {"passed": False, "unsupported_count": 3}
    # A cited standard resolves to its chunk, with page and heading (AC4).
    assert body["sources"]["C:fm:4"]["page_start"] == 4
    assert body["sources"]["C:fm:4"]["headings"] == ["Fire Stopping"]


def test_retrieval_filters_and_prompt_evidence(monkeypatch):
    _, calls, prompts = draft(monkeypatch, [])
    *standard_calls, past_reports = calls
    # One batched search: two standard passages for each of the section's observations,
    # searched by its own words, from both standard types and filtered to the site;
    # past reports for the section, by country only.
    assert [query for query, _, _ in standard_calls] == [
        "Construction: Riser shafts on L3 are not fire-stopped. "
        "Curtain wall gaps filled with rock wool."
    ]
    assert standard_calls[0][1:] == (
        {
            "jurisdiction": "Singapore",
            "facility_type": "Office",
            "source_type": ["fm_standard", "nfpa_standard"],
        },
        4,
    )
    assert past_reports[1] == {"jurisdiction": "Singapore", "source_type": "marsh_report"}
    system, user, effort = prompts[0]
    assert '"Construction Narrative"' in system and "Construction Table" not in system
    # Evidence is labelled with short labels, not its long IDs.
    assert "[O1]" in user and "Voice transcript: Curtain wall gaps" in user
    assert "[C1]" in user and "p. 4-5" in user and "fm:4" not in user
    # Only past-report passages under the same section heading are given as precedent.
    assert "[P1]" in user and "fire-resistive" in user and "Executive summary text" not in user
    assert effort == "high"


def test_drafts_from_observations_when_the_knowledge_base_is_empty(monkeypatch):
    response, _, prompts = draft(
        monkeypatch,
        [
            Subsection(
                heading="Construction Narrative",
                statements=[Statement(text="From the site visit.", citations=["O:obs1"])],
            )
        ],
        search=nothing_found,
    )
    assert response.status_code == 200
    assert response.json()["guardrail"]["passed"]
    assert "<standards>\nnone" in prompts[0][1]


def test_unknown_section_is_404_and_empty_evidence_is_422():
    assert client.post("/sections/draft", json={**REQUEST, "section_id": "3"}).status_code == 404
    assert client.post("/sections/draft", json={**REQUEST, "observations": []}).status_code == 422


def test_failed_generation_is_502(monkeypatch):
    def refuse(*args):
        raise GenerationFailed("The model declined to draft this section.")

    monkeypatch.setattr("app.orchestrator.orchestrator.search", nothing_found)
    monkeypatch.setattr("app.generation.generator.complete", refuse)
    response = client.post("/sections/draft", json=REQUEST)
    assert response.status_code == 502
    assert response.json()["detail"] == "The model declined to draft this section."


def test_lists_the_technical_sections_7_to_12():
    body = client.get("/sections").json()
    assert [s["id"] for s in body["sections"]] == ["7", "8", "9", "10", "11", "12"]
    assert body["sections"][0] == {
        "id": "7",
        "title": "Construction",
        "cope_dimensions": ["Construction"],
        "min_observations": 1,
    }


def test_a_list_of_source_types_matches_any_of_them():
    assert label_filter({"source_type": ["fm_standard", "nfpa_standard"]}) == {
        "$and": [
            {"source_type": {"$in": ["fm_standard", "nfpa_standard"]}},
            {"status": {"$ne": "withdrawn"}},
        ]
    }


def test_other_categories_are_backup_evidence(monkeypatch):
    # A Protection finding can still support the Construction section.
    sprinklers = {
        "id": "obs2",
        "COPE_dimension": "Protection",
        "note": "Sprinkler heads obstructed by new mezzanine.",
    }
    queries, prompts = [], []
    monkeypatch.setattr(
        "app.orchestrator.orchestrator.search",
        lambda requests: queries.extend(q for q, _, _ in requests) or nothing_found(requests),
    )
    monkeypatch.setattr(
        "app.generation.generator.complete",
        fake_complete(
            prompts,
            [
                Subsection(
                    heading="Construction Narrative",
                    statements=[Statement(text="A mezzanine was added.", citations=["O:obs2"])],
                )
            ],
        ),
    )
    body = {**REQUEST, "observations": [*REQUEST["observations"], sprinklers]}
    response = client.post("/sections/draft", json=body)

    user = prompts[0][1]
    own, others = user.split("<other_observations>")
    assert "Riser shafts" in own and "mezzanine" not in own
    assert "[O2]" in others and "mezzanine" in others
    # Only the section's own observations steer the standards search.
    assert all("mezzanine" not in q for q in queries)
    assert response.json()["guardrail"]["passed"]


def test_standards_are_capped_keeping_each_observations_nearest(monkeypatch):
    # 14 observations at 2 passages each would be 28, more than the cap.
    def search(requests):
        return [
            [
                {"id": f"s{i}:{rank}", "text": f"passage s{i}:{rank}", "metadata": {}}
                for rank in range(2)
            ]
            for i, _ in enumerate(requests)
        ]

    many = [
        {"id": f"obs{n}", "COPE_dimension": "Construction", "note": f"Finding {n}."}
        for n in range(14)
    ]
    prompts = []
    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.generation.generator.complete", fake_complete(prompts, []))
    client.post("/sections/draft", json={**REQUEST, "observations": many})

    standards = prompts[0][1].split("<standards>")[1].split("</standards>")[0]
    sent = [line.split()[1] for line in standards.splitlines() if line.startswith("passage ")]
    assert len(sent) == 12
    # Every observation's nearest passage goes before any second-nearest one.
    assert sent == [f"s{i}:0" for i in range(12)]


def test_standard_queries_use_each_own_observations_words():
    from app.api.routes import Observation
    from app.generation.generator import TEMPLATE
    from app.orchestrator.orchestrator import standard_queries

    section = TEMPLATE["sections"]["9"]
    observations = [
        Observation(
            id="a",
            COPE_dimension="Protection",
            note="No  door fan test\nreport.",
            transcripts=["FM200 in the server room."],
        ),
        Observation(id="b", COPE_dimension="Protection", note="x" * 900),
        # Filed under another category: backup evidence, not a search.
        Observation(id="c", COPE_dimension="Occupancy", note="UPS batteries next door."),
    ]
    queries = standard_queries(section, observations)
    assert queries[0] == "Fire Protection: No door fan test report. FM200 in the server room."
    assert len(queries) == 2
    # A long note is trimmed, so one observation cannot crowd the embedding.
    assert queries[1] == "Fire Protection: " + "x" * 500
    assert standard_queries(section, [observations[2]] * 3) == []


def test_search_embeds_once_and_groups_queries_by_filter(monkeypatch):
    chroma, cohere = Mock(), Mock()
    collection = chroma.get_collection.return_value
    collection.count.return_value = 5

    def query(query_embeddings, n_results, where, include):
        rows = range(len(query_embeddings))
        return {
            "ids": [[f"{where}-{r}"] for r in rows],
            "documents": [["text"] for _ in rows],
            "metadatas": [[{}] for _ in rows],
            "distances": [[0.1] for _ in rows],
        }

    collection.query.side_effect = query
    cohere.embed.return_value = SimpleNamespace(
        embeddings=SimpleNamespace(float_=[[1.0], [2.0], [3.0]])
    )
    monkeypatch.setattr(retriever, "chroma_client", lambda: chroma)
    monkeypatch.setattr(retriever, "cohere_client", lambda: cohere)

    standards = {"source_type": ["fm_standard", "nfpa_standard"]}
    reports = {"source_type": "marsh_report"}
    results = retriever.search([("a", standards, 2), ("b", reports, 20), ("c", standards, 2)])

    assert cohere.embed.call_count == 1
    assert cohere.embed.call_args.kwargs["texts"] == ["a", "b", "c"]
    # Two Chroma queries: the standards ones together, in request order.
    assert collection.query.call_count == 2
    first = collection.query.call_args_list[0].kwargs
    assert first["query_embeddings"] == [[1.0], [3.0]] and first["n_results"] == 2
    assert [len(r) for r in results] == [1, 1, 1]
    assert results[1][0]["id"].startswith(str(label_filter(reports)))
    assert retriever.search([]) == []


def test_short_labels_map_back_to_full_ids(monkeypatch):
    # The model cites short labels; the saved draft holds the full IDs.
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Construction Narrative",
                statements=[
                    Statement(text="Backed by both.", citations=["O1", "C1"]),
                    Statement(text="Precedent only.", citations=["P1"]),
                    Statement(text="No such label.", citations=["O9"]),
                ],
            )
        ],
    )
    statements = response.json()["subsections"][0]["statements"]
    assert [s["citations"] for s in statements] == [["O:obs1", "C:fm:4"], ["P:rep:9"], ["O9"]]
    assert [s["supported"] for s in statements] == [True, False, False]


def test_off_topic_standard_passages_are_not_sent(monkeypatch):
    def search(requests):
        near = {"id": "fm:near", "text": "Enclosure integrity.", "metadata": {}, "distance": 0.55}
        far = {"id": "fm:far", "text": "Liquid level charts.", "metadata": {}, "distance": 0.63}
        return [[near, far] for _ in requests]

    prompts = []
    monkeypatch.setattr("app.orchestrator.orchestrator.search", search)
    monkeypatch.setattr("app.generation.generator.complete", fake_complete(prompts, []))
    client.post("/sections/draft", json=REQUEST)

    user = prompts[0][1]
    assert "Enclosure integrity." in user and "Liquid level charts." not in user


def test_the_drafting_guide_is_the_prompts_writing_conventions(monkeypatch):
    _, _, prompts = draft(monkeypatch, [])
    system = prompts[0][0]
    # The guide's own rules reach the model...
    assert "Singapore English" in system
    assert 'Never write\n  "information provided" for something the engineer saw.' in system
    assert "Do not invent gaps either." in system
    # Findings only in sections 7-12, as in Marsh's own reports.
    assert "Findings, not implications." in system
    # Standards that cover a finding are cited alongside the observation.
    assert "Where a standards passage explains or supports a statement, cite it" in system
    # No invented gaps in field subsections.
    assert 'Never write that a field was "not recorded"' in system
    # ...without the header meant for people, and with no second list of conventions.
    assert "name: pre-section-drafting" not in system and not system.count("---\nname")
    assert "Writing conventions:" not in system


def test_questions_for_the_engineer_come_back_with_the_draft(monkeypatch):
    asked = [f"Question {n}?" for n in range(1, 5)]
    monkeypatch.setattr("app.orchestrator.orchestrator.search", nothing_found)
    monkeypatch.setattr("app.generation.generator.complete", fake_complete([], [], asked))
    body = client.post("/sections/draft", json=REQUEST).json()
    # At most three, as the drafting guide asks.
    assert body["questions"] == asked[:3]


def test_site_note_abbreviations_are_spelt_out_in_standard_queries():
    from app.api.routes import Observation
    from app.generation.generator import TEMPLATE
    from app.orchestrator.orchestrator import spell_out, standard_queries

    # Whole words only, any case, longest match first ("srv rm" before "rm").
    assert spell_out("B1 spk CV found SHUT, pens thru srv rm") == (
        "B1 sprinkler control valve found SHUT, penetrations through server room"
    )
    assert spell_out("Fire command centre, CVS, rmx") == "Fire command centre, CVS, rmx"
    note = Observation(id="a", COPE_dimension="Protection", note="FCC - addressable FA panel")
    assert standard_queries(TEMPLATE["sections"]["9"], [note]) == [
        "Fire Protection: fire command centre - addressable fire alarm panel"
    ]

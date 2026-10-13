"""Section 6 Management Programs (GN-11). Retrieval and the LLM are mocked."""

from app.generation.generator import TEMPLATE, Statement, Subsection
from tests.test_sections import REQUEST, client, draft

PROGRAMS = [
    "Building Maintenance",
    "Electrical Maintenance",
    "Equipment Maintenance",
    "Fire Protection Impairment Management",
    "Fire Protection System Maintenance & Testing",
    "Hazardous Materials Handling",
    "Housekeeping",
    "Hot Work Permit System",
    "Management of Change",
    "Emergency Response Planning",
    "Self-Inspections",
    "Smoking Controls",
    "Contractor Management",
    "Business Continuity Planning",
    "Environmental, Social & Governance (ESG)",
]
SECTION_6 = {**REQUEST, "section_id": "6"}


def test_section_6_is_marshs_programs_table_and_comes_first():
    section = TEMPLATE["sections"]["6"]
    assert list(TEMPLATE["sections"])[0] == "6"
    assert section["title"] == "Management Programs"
    table, comments = section["subsections"]
    assert table == {"heading": "Management Programs", "kind": "fields", "fields": PROGRAMS}
    assert comments == {"heading": "Management Program Comments", "kind": "narrative"}
    # Management evidence is spread across all four categories.
    assert sorted(section["cope_dimensions"]) == [
        "Construction",
        "Exposure",
        "Occupancy",
        "Protection",
    ]


def test_the_prompt_gives_the_maturity_scale_and_its_rules(monkeypatch):
    _, _, prompts = draft(monkeypatch, [], request=SECTION_6)
    system = prompts[0][0]
    assert 'You draft Section 6, "Management Programs"' in system
    for rank in ("Undeveloped", "Formalized", "Established", "Embedded", "Optimized"):
        assert rank in system
    assert "the lower one" in system
    # Other sections' prompts carry none of Section 6's rules.
    _, _, others = draft(monkeypatch, [])
    assert "Optimized" not in others[0][0]


def test_a_rank_outside_the_five_is_unsupported(monkeypatch):
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Management Programs",
                statements=[
                    Statement(
                        text="Building Maintenance: Embedded. Structural checks every 5 years.",
                        citations=["O:obs1"],
                    ),
                    Statement(
                        text="Housekeeping: Excellent. Areas were tidy.", citations=["O:obs1"]
                    ),
                    Statement(
                        text="Smoking Controls Formalized, signs posted.", citations=["O:obs1"]
                    ),
                ],
            )
        ],
        request=SECTION_6,
    )

    rows = response.json()["subsections"][0]["statements"]
    assert [r["supported"] for r in rows] == [True, False, False]
    assert response.json()["guardrail"] == {"passed": False, "unsupported_count": 2}


def test_the_sections_list_starts_with_section_6():
    sections = client.get("/sections").json()["sections"]
    assert [s["id"] for s in sections] == ["6", "7", "8", "9", "10", "11", "12"]

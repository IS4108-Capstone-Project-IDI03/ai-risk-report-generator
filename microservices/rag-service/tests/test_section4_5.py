"""Sections 4 and 5's wording (GN-03): the model drafts only words around the engineer's
figures, and a number or rating it did not take from its sources is unsupported.
Retrieval and the LLM are mocked."""

from app.generation.generator import TEMPLATE, Statement, Subsection
from tests.test_sections import REQUEST, client, draft

FACTS_4 = (
    "Current Location Risk Quality Rating: B\n"
    "Potential Location Risk Quality Rating: A\n"
    "External Exposure: current 9, potential 10"
)
FACTS_5 = "Values in SGD. Level II items: Hotel 28.4% damage; Hotel (Gross Profit) 12 months"
SECTION_4 = {**REQUEST, "section_id": "4", "facts": FACTS_4}
SECTION_5 = {**REQUEST, "section_id": "5", "facts": FACTS_5}


def test_sections_4_and_5_are_marshs_wording_parts_and_come_first():
    sections = TEMPLATE["sections"]
    assert list(sections)[:3] == ["4", "5", "6"]
    assert sections["4"]["title"] == "Risk Quality Ratings and Comments"
    assert [s["heading"] for s in sections["4"]["subsections"]] == [
        "Risk Quality Rating Comments",
        "Positive Points",
    ]
    assert sections["5"]["title"] == "Loss Estimates"
    assert [s["heading"] for s in sections["5"]["subsections"]] == [
        f"Level {level} {part}"
        for level in ("I", "II", "III")
        for part in ("Scenario", "Assumptions")
    ]
    assert all(s["kind"] == "narrative" for n in ("4", "5") for s in sections[n]["subsections"])
    assert [s["id"] for s in client.get("/sections").json()["sections"]][:3] == ["4", "5", "6"]


def test_the_prompt_carries_the_engineers_facts_and_the_no_figures_rule(monkeypatch):
    _, _, prompts = draft(monkeypatch, [], request=SECTION_5)
    system, user, _ = prompts[0]
    assert "Facts from the engineer" in user
    assert FACTS_5 in user
    assert "no figure" in system.lower()
    # A section drafted without facts has no facts block.
    _, _, others = draft(monkeypatch, [])
    assert "Facts from the engineer" not in others[0][1]


def statements(*texts, citations=("O:obs1",)):
    return [Statement(text=t, citations=list(citations)) for t in texts]


def test_a_number_not_in_its_sources_or_the_facts_is_unsupported(monkeypatch):
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Level II Scenario",
                statements=statements(
                    # "L3" is in obs1's note: grounded.
                    "A fire starts in the riser on Level 3 and spreads upward.",
                    # 28.4 is in the facts: grounded.
                    "The hotel suffers 28.4% damage.",
                    # 40 is in neither: made up.
                    "Damage reaches 40% of the building.",
                ),
            )
        ],
        request=SECTION_5,
    )

    level_2 = next(s for s in response.json()["subsections"] if s["heading"] == "Level II Scenario")
    assert [r["supported"] for r in level_2["statements"]] == [True, True, False]
    assert response.json()["guardrail"] == {"passed": False, "unsupported_count": 1}


def test_a_rating_other_than_the_computed_one_is_unsupported(monkeypatch):
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Risk Quality Rating Comments",
                statements=statements(
                    "The site is rated B, above average for its class.",
                    "The site merits a rating of A.",
                    "Buildings were constructed of fire resistive materials.",
                ),
            )
        ],
        request=SECTION_4,
    )

    rows = response.json()["subsections"][0]["statements"]
    # A is the potential rating, not the current one; the site is rated on its current.
    assert [r["supported"] for r in rows] == [True, False, True]


def test_sections_without_facts_keep_their_numbers_unchecked(monkeypatch):
    # Sections 6-12 report what observations and standards say; only 4 and 5 hold figures.
    response, _, _ = draft(
        monkeypatch,
        [Subsection(heading="Construction Narrative", statements=statements("Built in 1998."))],
    )
    assert response.json()["subsections"][0]["statements"][0]["supported"] is True


def test_a_number_written_another_way_or_from_the_location_is_grounded(monkeypatch):
    request = {
        **SECTION_4,
        "facts": "Current Location Risk Quality Score: 80\nCurrent Location Risk Quality Rating: B",
        "observations": [{**SECTION_4["observations"][0], "location": "Block 2, Level 7"}],
    }
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Risk Quality Rating Comments",
                statements=statements(
                    # 80.0 is the facts' 80; Level 7 is the observation's location.
                    "The site scores 80.0 overall.",
                    "Fire stopping on Level 7 was incomplete.",
                ),
            )
        ],
        request=request,
    )
    rows = response.json()["subsections"][0]["statements"]
    assert [r["supported"] for r in rows] == [True, True]


def test_a_date_or_number_the_notes_abbreviate_or_spell_out_is_grounded(monkeypatch):
    # Site notes write "Apr 26" and voice transcripts "thirty"; the report writes them out.
    note = "FM200 svc tag - last svc Apr 26. Discharge delay set to thirty seconds."
    request = {**SECTION_4, "observations": [{**SECTION_4["observations"][0], "note": note}]}
    response, _, _ = draft(
        monkeypatch,
        [
            Subsection(
                heading="Positive Points",
                statements=statements(
                    "The FM-200 system was last serviced in April 2026.",
                    "The discharge delay is set to 30 seconds.",
                    # Neither written nor abbreviated in the note: still made up.
                    "The system was installed in 2019.",
                ),
            )
        ],
        request=request,
    )
    rows = next(s for s in response.json()["subsections"] if s["heading"] == "Positive Points")
    assert [r["supported"] for r in rows["statements"]] == [True, True, False]

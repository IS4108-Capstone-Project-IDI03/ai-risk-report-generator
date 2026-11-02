"""Site walk eval scoring (CP-22): counted in code against golden.json, checked here with
fake proposals. No model is called."""

import json
from pathlib import Path

from app.api.routes import ProposeSiteWalkRequest
from eval.site_walk.scoring import score_case, summarise

CASE = {
    "id": "c1",
    "expected": {
        "locations": [
            {"id": "A", "existing_id": "e1"},
            {"id": "W", "building": "Block B", "floor": "ground floor", "names": ["Warehouse"]},
        ],
        "observations": [
            {"keywords": ["pallet"], "location": "A", "category": "Occupancy", "severity": "high"},
            {"keywords": ["in-rack"], "location": "W", "category": "Protection",
             "severity": "high"},
            {"keywords": ["smoking"], "location": None, "category": "Occupancy", "severity": "low"},
        ],
    },
}  # fmt: skip


def loc(ref, existing_id=None, building=None, floor=None, name="x"):
    return {"ref": ref, "existing_id": existing_id, "building": building, "floor": floor,
            "name": name}  # fmt: skip


def ob(note, location_ref, category="Occupancy", severity="high"):
    return {"note": note, "location_ref": location_ref, "cope_dimension": category,
            "severity": severity}  # fmt: skip


def test_a_case_is_scored_on_locations_recall_and_agreement():
    proposal = {
        "locations": [
            loc("loc-1", existing_id="e1"),
            loc("loc-2", building="block b", floor="Ground", name="warehouse"),
            loc("loc-3", building="Block H", floor="Ground", name="Warehouse"),  # a duplicate
        ],
        "observations": [
            ob("Pallets in the fire lane.", "loc-1"),
            ob("In-rack sprinklers missing.", "loc-3", category="Protection", severity="critical"),
            ob("Smoking by the gate.", None, severity="high"),
            ob("Something the golden set does not list.", "loc-1"),
        ],
    }

    assert score_case(CASE, proposal) == {
        "case": "c1",
        "locations_expected": 2,
        "locations_found": 2,
        "locations_extra": 1,
        "observations_expected": 3,
        "observations_found": 3,
        "observations_proposed": 4,
        "location_agree": 2,  # the in-rack finding went to the duplicate
        "category_agree": 3,
        "severity_agree": 1,
    }


def test_a_missed_observation_lowers_recall_only():
    proposal = {
        "locations": [loc("loc-1", existing_id="e1")],
        "observations": [ob("pallet", "loc-1")],
    }
    summary = summarise([score_case(CASE, proposal)])

    assert summary["observation_recall"] == 1 / 3
    assert summary["location_matching"] == 1 / 2
    assert summary["location_agreement"] == summary["severity_agreement"] == 1.0


def test_every_golden_walk_is_a_valid_request():
    golden = Path(__file__).parents[1] / "eval" / "site_walk" / "golden.json"
    for case in json.loads(golden.read_text())["cases"]:
        ProposeSiteWalkRequest(
            report_id="x",
            transcript=case["transcript"],
            existing_locations=case["existing_locations"],
        )
        ids = {e["id"] for e in case["expected"]["locations"]} | {None}
        assert all(o["location"] in ids for o in case["expected"]["observations"]), case["id"]

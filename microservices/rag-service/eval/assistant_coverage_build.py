"""Builds the AS-06 coverage eval cases in eval/coverage_cases/ (no AI, fully deterministic).

Run from microservices/rag-service: `uv run python -m eval.assistant_coverage_build`.
Rewrites every case file, which drops the hill-climb's `label_fixes` (11 Nov, office5 cases):
copy them into LINKS before you rebuild. Read by assistant_coverage.py; see its docstring
for what the cases are and how they are scored.

How a case is made
- The checklist is real: the template items and the facility type's hazard items that
  app/generation/checklist.py writes (same text the gateway shows).
- The observations are real: field notes from the existing eval cases (eval/cases,
  eval/ofi_cases, eval/rank_cases), each written from one of five Marsh sample reports.
- LINKS below are hand-labelled: which checklist items each observation covers. An
  observation covers an item if it records what the item asks about. The labels are mine
  (a first pass, not Marsh's); a miss in a result file is as likely a wrong link as a wrong
  model, so read the per-case misses before trusting a score.
- A case keeps the checklist items of a few report areas, and removes the observations
  that cover some of them. An item with no observation left is the gold "uncovered" set.
  Items with no link in the whole report are never put on a checklist (their truth is
  unknown).
- Thin cases: real specific notes plus hand-written thin notes (THIN, below) and short
  but specific notes (BRIEF). These notes are written by hand, not from a report.
- Split is by source report, so no note appears in two splits.
"""

import json
import random
from pathlib import Path

from app.generation.checklist import hazards_for, template_items

HERE = Path(__file__).parent
OUT = HERE / "coverage_cases"
SECTIONS_JSON = HERE.parent / "app" / "generation" / "sections.json"

# Source report -> (case files holding its notes, facility type, split, number of cases).
REPORTS = {
    "office5": (
        ["cases/office-5-s4-risk-quality.json", "ofi_cases/office-5-ofis.json"],
        "Office",
        "tune",
        14,
    ),
    "mall2": (
        ["cases/mall-2-s4-risk-quality.json", "ofi_cases/mall-2-ofis.json"],
        "Shopping mall",
        "check",
        14,
    ),
    "mixed1": (
        ["cases/mixed-1-s9-fire-protection.json", "ofi_cases/mixed-1-ofis.json"],
        "Mixed-use development",
        "test",
        9,
    ),
    "mixed6be5": (["rank_cases/mixed-6be5-s6.json"], "Mixed-use development", "test", 2),
    "office-a332": (["rank_cases/office-a332-s6.json"], "Office", "test", 6),
}

# Observation id -> the checklist items it covers. "<area>/<subsection>" is a template
# item; "hazard:<id>" is a hazard item of the report's facility type.
MP = "6/Management Programs"
LINKS = {
    # Shopping Mall Sample 2
    "mall2-1": ["7/Construction Table"],
    "mall2-2": ["7/Construction Narrative"],
    "mall2-3": ["7/Construction Narrative", "7/Details on Combustible Construction"],
    "mall2-4": ["7/Compartmentalization and Fire Divisions"],
    "mall2-5": ["7/Compartmentalization and Fire Divisions"],
    "mall2-6": ["7/Compartmentalization and Fire Divisions"],
    "mall2-7": ["7/Compartmentalization and Fire Divisions"],
    "mall2-ofi-1": [MP],
    "mall2-ofi-2": [MP],
    "mall2-ofi-3": ["9/Automatic Sprinkler Protection"],
    "mall2-ok-2": ["8/Waste and effluent treatment"],
    "mall2-s4-1": ["9/Automatic Sprinkler Protection"],
    "mall2-s4-2": ["9/Fire / Booster Pump Details", "9/Water Supply Details"],
    "mall2-s4-3": ["9/Fire Alarm Monitoring", "9/Fire Alarm Details"],
    "mall2-s4-4": ["hazard:cooking", "9/Special Extinguishing Systems"],
    "mall2-s4-5": [MP],
    "mall2-s4-6": ["8/Transformer details"],
    "mall2-s4-7": ["8/Back-up Power", "8/Fuels and energy supplies"],
    "mall2-s4-8": ["8/Refrigeration / Chillers / Cooling towers"],
    "mall2-s4-9": [MP],
    "mall2-s4-10": ["10/Boundary Exposures", "10/Natural Catastrophe Exposures"],
    "mall2-s4-11": ["11/CCTV", "11/Security Staff / Guards", "11/Access Monitored"],
    "mall2-s4-12": [MP],
    # Office Sample 5
    "off5-1": ["7/Construction Narrative", "7/Construction Table"],
    "off5-2": ["7/Construction Narrative", "7/Details on Combustible Construction"],
    "off5-3": ["7/Construction Narrative"],
    "off5-4": ["7/Compartmentalization and Fire Divisions"],
    "off5-5": ["7/Compartmentalization and Fire Divisions"],
    "off5-6": ["7/Compartmentalization and Fire Divisions"],
    "off5-7": ["7/Compartmentalization and Fire Divisions"],
    "off5-8": ["8/Overview"],
    "off5-9": ["hazard:server_rooms", "8/Back-up Power", "8/Fuels and energy supplies"],
    "off5-10": [
        "8/Refrigeration / Chillers / Cooling towers",
        "8/Transformer details",
        "8/Boilers",
        "8/Fuels and energy supplies",
    ],
    "off5-11": [
        "9/Automatic Sprinkler Protection",
        "9/Water Supply Details",
        "9/Fire / Booster Pump Details",
    ],
    "off5-12": ["9/Automatic Sprinkler Protection"],
    "off5-13": ["9/Special Extinguishing Systems", "hazard:server_rooms"],
    "off5-14": [
        "9/Fire Alarm Monitoring",
        "9/Fire Alarm Details",
        "9/Manual Firefighting Features",
    ],
    "off5-15": ["9/Pump Flow Test Data", "9/Fire / Booster Pump Details"],
    "off5-16": ["10/Boundary Exposures"],
    "off5-17": ["10/Natural Catastrophe Exposures"],
    "off5-18": ["11/CCTV", "11/Security Staff / Guards", "11/Access Monitored"],
    "off5-19": ["11/Intruder Detection", "11/Site Perimeter"],
    "off5-20": [MP, "12/Business Continuity / Disaster Recovery Planning", "8/Overview"],
    "off5-21": ["10/Location Details"],
    "off5-22": ["10/Boundary Exposures"],
    "off5-23": ["10/Natural Catastrophe Exposures"],
    "off5-24": ["10/Natural Catastrophe Exposures"],
    "off5-25": ["10/Natural Catastrophe Exposures"],
    "off5-ofi-1": ["7/Compartmentalization and Fire Divisions"],
    "off5-ofi-2": ["9/Automatic Sprinkler Protection"],
    "off5-ok-1": ["9/Fire Alarm Monitoring"],
    "off5-ok-2": [MP],
    # Mixed Use Development Sample 1
    "mix1-1": ["9/Automatic Sprinkler Protection", "9/Fire / Booster Pump Details"],
    "mix1-2": ["9/Automatic Sprinkler Protection"],
    "mix1-3": ["9/Special Extinguishing Systems"],
    "mix1-4": ["9/Special Extinguishing Systems"],
    "mix1-5": ["hazard:cooking", "9/Special Extinguishing Systems"],
    "mix1-6": ["9/Special Extinguishing Systems"],
    "mix1-7": ["9/Water Supply Details", "9/Fire / Booster Pump Details"],
    "mix1-ofi-1": [MP],
    "mix1-ofi-2": [MP],
    "mix1-ofi-3": ["8/Back-up Power", "8/Fuels and energy supplies"],
    "mix1-ofi-4": ["9/Manual Firefighting Features"],
    "mix1-ofi-5": [MP],
    "mix1-ok-1": ["9/Pump Flow Test Data", "9/Fire / Booster Pump Details"],
    # Mixed-use report 6be5 (Section 6 notes)
    "6be5-1": [MP],
    "6be5-2": [MP, "8/Back-up Power", "8/Transformer details"],
    "6be5-3": [MP],
    "6be5-4": [MP],
    "6be5-5": [MP],
    "6be5-6": ["8/Back-up Power", "8/Fuels and energy supplies", "8/Waste and effluent treatment"],
    "6be5-7": [MP],
    # Office report a332 (Section 6 notes)
    "a332-1": [MP],
    "a332-2": [MP, "8/Transformer details", "8/Back-up Power"],
    "a332-3": [MP],
    "a332-4": [MP],
    "a332-5": [MP],
    "a332-6": ["8/Fuels and energy supplies", "8/Back-up Power"],
    "a332-7": [MP],
    "a332-8": [MP],
    "a332-9": [MP],
    "a332-10": [MP],
    "a332-11": [MP],
    "a332-12": [MP],
    "a332-13": [MP],
    "a332-14": [MP, "12/Business Continuity / Disaster Recovery Planning"],
}

# Hand-written thin notes: too short or vague to support a statement in their section.
# (category, location, note)
THIN = [
    ("Construction", "Whole building", "walls ok"),
    ("Construction", "Car park ramp", "some cracks seen near the ramp"),
    ("Construction", "Roof", "roof - see photos"),
    ("Construction", "Podium", "construction looks fine"),
    ("Occupancy", "Level 3", "housekeeping not great"),
    ("Occupancy", "Back of house", "storage a bit messy in places"),
    ("Occupancy", "Plant room", "generator ok"),
    ("Occupancy", "Kitchen", "kitchen - tbc"),
    ("Occupancy", "Whole site", "nothing much to report"),
    ("Protection", "Pump room", "pump ok"),
    ("Protection", "Retail area", "sprinklers fine"),
    ("Protection", "Stairwell", "some issues near the stairs"),
    ("Protection", "Fire command centre", "alarm panel - checked"),
    ("Protection", "Office floors", "extinguishers ok mostly"),
    ("Protection", "Basement", "valves - to check"),
    ("Exposure", "Site boundary", "flood - probably fine"),
    ("Exposure", "Site boundary", "neighbour is close"),
    ("Exposure", "Whole site", "no real exposure issues"),
    ("Protection", "Loading bay", "alarm not sure"),
    ("Construction", "Service corridor", "door looked a bit off"),
]

# Short but specific notes: brief, yet each supports a statement. Not thin.
BRIEF = [
    (
        "Protection",
        "B1 fire pump room",
        "duty pump on auto, jockey pump on auto, weekly churn log signed to date",
    ),
    ("Construction", "L2 riser", "riser door 1 hr rated, closed and latched, cable gap sealed"),
    ("Occupancy", "Roof genset", "diesel day tank 1000 L, bunded, 80% full"),
    ("Exposure", "Ramp", "flood barrier at ramp, manual, deployed by security"),
    ("Protection", "Kitchen L1", "wet chemical hood system, last service Mar 2026 tag on panel"),
    ("Occupancy", "LV switch room", "no storage in room, door signed, floor clear"),
]


def _reports() -> dict[str, dict]:
    """Load each source report's notes: {name: {facility_type, assessment, notes}}."""
    out = {}
    for name, (files, facility, _split, _n) in REPORTS.items():
        notes, assessment = {}, None
        for f in files:
            case = json.loads((HERE / f).read_text())
            assessment = assessment or case["assessment"]
            for o in case["observations"]:
                notes[o["id"]] = {
                    k: o[k]
                    for k in ("id", "COPE_dimension", "note", "severity", "location")
                    if k in o
                }
        out[name] = {"facility": facility, "assessment": assessment, "notes": notes}
    return out


def _all_items(facility: str) -> dict[str, dict]:
    """The real checklist items by link key, with the text the model would see."""
    items = {}
    for t in template_items():
        items[f"{t['area']}/{t['subsection']}"] = {"area": t["area"], "text": t["text"]}
    for h in hazards_for(facility):
        items[f"hazard:{h['id']}"] = {"area": "hazards", "text": h["item"]}
    return items


def _sections() -> list[dict]:
    sections = json.loads(SECTIONS_JSON.read_text())["sections"]
    return [
        {
            "section_id": k,
            "title": sections[k]["title"],
            "cope_dimensions": sections[k]["cope_dimensions"],
        }
        for k in ("7", "8", "9", "10", "11", "12")
    ]


def _area(key: str) -> str:
    return "hazards" if key.startswith("hazard:") else key.split("/")[0]


def _order(key: str) -> tuple:
    """Report order: areas by number, hazards last; template order inside an area."""
    area = _area(key)
    return (99 if area == "hazards" else int(area), key)


def _coverage_case(name, report, index, split, items_all, rng_tag) -> dict | None:
    """One coverage case from a report, or None when the draw is unusable."""
    notes = report["notes"]
    links = {i: [k for k in LINKS[i] if k in items_all] for i in notes if i in LINKS}
    present_keys = sorted({k for ks in links.values() for k in ks}, key=_order)
    areas = sorted({_area(k) for k in present_keys}, key=lambda a: 99 if a == "hazards" else int(a))
    for attempt in range(40):
        rng = random.Random(f"{rng_tag}-{index}-{attempt}")
        take = [2, 3, 2, 4, 3][index % 5]
        chosen = set(rng.sample(areas, min(take, len(areas))))
        keys = [k for k in present_keys if _area(k) in chosen or _area(k) == "hazards"]
        # Controls (nothing removed) every 7th case; otherwise remove a share of the items.
        share = [0.15, 0.25, 0.3, 0.4][index % 4]
        n_remove = 0 if index % 7 == 6 else max(1, round(share * len(keys)))
        if not 4 <= len(keys) <= 18 or n_remove >= len(keys):
            continue
        targets = set(rng.sample(keys, n_remove))
        # Notes in the case: those covering a checklist item (distractors not needed).
        in_case = [i for i, ks in links.items() if any(k in keys for k in ks)]
        removed = sorted(i for i in in_case if any(k in targets for k in links[i]))
        kept = [i for i in in_case if i not in removed]
        gold = [k for k in keys if not any(k in links[i] for i in kept)]
        if len(kept) < 2 or (n_remove and not gold) or len(gold) > len(keys) / 2:
            continue
        sig = (tuple(keys), tuple(removed))
        if sig in _seen.setdefault(name, set()):
            continue
        _seen[name].add(sig)
        keys_sorted = sorted(keys, key=_order)
        id_of = {k: f"c{n + 1:02d}" for n, k in enumerate(keys_sorted)}
        return {
            "id": f"{name}-{index + 1:02d}",
            "split": split,
            "kind": "coverage",
            "source": f"{name} report notes, areas {', '.join(sorted(chosen))}",
            "assessment": report["assessment"],
            "sections": _sections(),
            "checklist": [
                {
                    "id": id_of[k],
                    "area": items_all[k]["area"],
                    "text": items_all[k]["text"],
                    "key": k,
                }
                for k in keys_sorted
            ],
            "observations": [notes[i] for i in kept],
            "removed_observations": removed,
            "links": {i: [id_of[k] for k in links[i] if k in id_of] for i in kept + removed},
            "gold": {"uncovered": [id_of[k] for k in gold], "thin": []},
        }
    return None


_seen: dict[str, set] = {}


def _thin_cases(reports, items_by_facility) -> list[dict]:
    """15 cases: real specific notes plus 1-2 hand-written thin notes (and some brief ones)."""
    cases, thin_i, brief_i = [], 0, 0
    plan = [("office5", "tune")] * 5 + [("mall2", "check")] * 5 + [("mixed1", "test")] * 2
    plan += [("office-a332", "test")] * 2 + [("mixed6be5", "test")]
    for n, (name, split) in enumerate(plan):
        report = reports[name]
        rng = random.Random(f"thin-{n}")
        linked = [i for i in report["notes"] if i in LINKS]
        specific = rng.sample(linked, min(5, len(linked)))
        how_many = 2 if n % 3 == 0 else 1
        thin = [THIN[(thin_i + k) % len(THIN)] for k in range(how_many)]
        thin_i += how_many
        notes = [report["notes"][i] for i in specific]
        thin_notes = []
        for k, (cope, where, text) in enumerate(thin):
            thin_notes.append(
                {
                    "id": f"thin-{n + 1}-{k + 1}",
                    "COPE_dimension": [cope],
                    "note": text,
                    "severity": "low",
                    "location": where,
                }
            )
        if n % 2 == 0:
            cope, where, text = BRIEF[brief_i % len(BRIEF)]
            brief_i += 1
            notes.append(
                {
                    "id": f"brief-{n + 1}",
                    "COPE_dimension": [cope],
                    "note": text,
                    "severity": "low",
                    "location": where,
                }
            )
        # Shuffle so thin notes are not always last.
        observations = notes + thin_notes
        rng.shuffle(observations)
        items_all = items_by_facility[report["facility"]]
        keys = sorted({k for i in specific for k in LINKS[i] if k in items_all}, key=_order)
        id_of = {k: f"c{j + 1:02d}" for j, k in enumerate(keys)}
        cases.append(
            {
                "id": f"thin-{n + 1:02d}",
                "split": split,
                "kind": "thin",
                "source": f"{name} report notes + hand-written thin notes",
                "assessment": report["assessment"],
                "sections": _sections(),
                "checklist": [
                    {
                        "id": id_of[k],
                        "area": items_all[k]["area"],
                        "text": items_all[k]["text"],
                        "key": k,
                    }
                    for k in keys
                ],
                "observations": observations,
                "removed_observations": [],
                "links": {},
                "gold": {"uncovered": [], "thin": [o["id"] for o in thin_notes]},
            }
        )
    return cases


def main() -> None:
    reports = _reports()
    items_by_facility = {r["facility"]: _all_items(r["facility"]) for r in reports.values()}
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    cases = []
    for name, (_f, _fac, split, count) in REPORTS.items():
        report = reports[name]
        items_all = items_by_facility[report["facility"]]
        made = 0
        for index in range(count * 3):
            if made == count:
                break
            case = _coverage_case(name, report, made, split, items_all, name)
            if case:
                cases.append(case)
                made += 1
        if made < count:
            print(f"{name}: only {made} of {count} cases could be made")
    cases += _thin_cases(reports, items_by_facility)
    for case in cases:
        (OUT / f"{case['id']}.json").write_text(json.dumps(case, indent=1) + "\n")
    by = {}
    for c in cases:
        by.setdefault((c["kind"], c["split"]), []).append(c)
    for key, group in sorted(by.items()):
        gold = sum(len(c["gold"]["uncovered"]) + len(c["gold"]["thin"]) for c in group)
        print(f"{key[0]:9} {key[1]:6} cases={len(group):3} gold={gold}")


if __name__ == "__main__":
    main()

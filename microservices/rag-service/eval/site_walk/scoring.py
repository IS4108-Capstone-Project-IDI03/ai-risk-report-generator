"""Pure scoring for the site walk evaluation (CP-22): a proposal against golden.json.

Called by run_eval.py and tests/test_site_walk_eval.py. No network, no files, so it can be
checked with fake proposals. Counted in code, no judge.
"""

from app.site_walk.places import location_key, standard_level


def _keys(expected: dict) -> set[str]:
    floor = expected.get("floor") and standard_level(expected["floor"])
    return {location_key(n, floor, expected.get("building")) for n in expected["names"]}


def match_locations(expected: list[dict], proposed: list[dict]) -> dict[str, str]:
    """Return {expected location id: proposed ref} for each expected location found.

    By existing_id when the golden names one, else by name, level and building.
    """
    found = {}
    for exp in expected:
        for loc in proposed:
            if exp.get("existing_id"):
                hit = loc["existing_id"] == exp["existing_id"]
            else:
                key = location_key(loc["name"], loc["floor"], loc["building"])
                hit = not loc["existing_id"] and key in _keys(exp)
            if hit:
                found[exp["id"]] = loc["ref"]
                break
    return found


def match_observations(expected: list[dict], proposed: list[dict]) -> list[tuple[dict, dict]]:
    """Return (expected, proposed) pairs: each expected one takes the first unused proposed
    observation whose note holds all its keywords."""
    used, pairs = set(), []
    for exp in expected:
        for i, o in enumerate(proposed):
            note = o["note"].lower()
            if i not in used and all(k.lower() in note for k in exp["keywords"]):
                used.add(i)
                pairs.append((exp, o))
                break
    return pairs


def score_case(case: dict, proposal: dict) -> dict:
    """Return one case's counts: locations found and extra, observations found, and how
    many found observations agree on location, category and severity."""
    expected = case["expected"]
    found = match_locations(expected["locations"], proposal["locations"])
    pairs = match_observations(expected["observations"], proposal["observations"])
    return {
        "case": case["id"],
        "locations_expected": len(expected["locations"]),
        "locations_found": len(found),
        # A duplicate of a place, or a place nobody named, is extra work for the engineer.
        "locations_extra": len(proposal["locations"]) - len(set(found.values())),
        "observations_expected": len(expected["observations"]),
        "observations_found": len(pairs),
        "observations_proposed": len(proposal["observations"]),
        "location_agree": sum(found.get(e["location"]) == o["location_ref"] for e, o in pairs),
        "category_agree": sum(e["category"] == o["cope_dimension"] for e, o in pairs),
        "severity_agree": sum(e["severity"] == o["severity"] for e, o in pairs),
    }


def summarise(rows: list[dict]) -> dict:
    """Return the run's rates: location matching, observation recall, and agreement on
    location, category and severity among the observations found."""
    total = {k: sum(r[k] for r in rows) for k in rows[0] if k != "case"} if rows else {}

    def rate(part, whole):
        return total[part] / total[whole] if total.get(whole) else None

    return {
        "location_matching": rate("locations_found", "locations_expected"),
        "locations_extra": total.get("locations_extra", 0),
        "observation_recall": rate("observations_found", "observations_expected"),
        "location_agreement": rate("location_agree", "observations_found"),
        "category_agreement": rate("category_agree", "observations_found"),
        "severity_agreement": rate("severity_agree", "observations_found"),
    }

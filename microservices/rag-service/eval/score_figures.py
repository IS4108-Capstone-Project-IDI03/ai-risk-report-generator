"""Score the model's proposed Section 4 and 5 figures against Marsh's (GN-03 addendum AC16).

Each case in eval/cases with section "4" or "5" holds observations and, in `facts`, the
real figures from that Marsh report. The script asks for a proposal from the observations
alone (the cases hold no drafted sections), and counts in code, no LLM judge:
- Section 4: per score, exact and within one point; the mean signed error (below 0 means
  the proposals score low, as Section 6's ranks ran); blanks; and what "every score 8"
  would get within one point. A proposal means something only above that.
- Section 5: per level, the areas matched to Marsh's by name, % damage within 10 points,
  outage months within 3 and % impacted within 10; proposed areas Marsh did not name.

One paid drafting call per case. Ask before running:
    uv run --extra dev python -m eval.score_figures [case ...]
Results are appended to eval/results/<date>-figures.jsonl.
"""

import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from app import config
from app.api.routes import Assessment, Observation
from app.generation.proposals import PROPOSAL_PROMPT_VERSION, propose_figures

HERE = Path(__file__).parent

_SCORE = re.compile(
    r"^(?P<category>[A-Za-z ]+): current (?P<cur>[\d.]+), potential (?P<pot>[\d.]+)$"
)
_DAMAGE = re.compile(r"(?P<item>[^;:]+?) (?P<pct>[\d.]+)% damage")
_TE = re.compile(r"(?P<item>[^;:]+?) (?P<months>[\d.]+) months at (?P<pct>[\d.]+)% impacted")


def expected_scores(facts: str) -> dict[str, tuple[float, float]]:
    """Marsh's (current, potential) per category, from the case's facts lines."""
    found = {}
    for line in facts.splitlines():
        m = _SCORE.match(line.strip())
        if m:
            found[m["category"]] = (float(m["cur"]), float(m["pot"]))
    return found


def score_scores(expected: dict, proposed: list[dict]) -> dict:
    """Counts for one Section 4 case."""
    given = {p["category"]: p for p in proposed}
    pairs = [
        (want, given.get(category, {}).get(side))
        for category, (cur, pot) in expected.items()
        for side, want in (("current", cur), ("potential", pot))
    ]
    errors = [got - want for want, got in pairs if got is not None]
    return {
        "figures": len(pairs),
        "blank": sum(got is None for _, got in pairs),
        "exact": sum(e == 0 for e in errors),
        "within_one": sum(abs(e) <= 1 for e in errors),
        "mean_signed_error": round(sum(errors) / len(errors), 2) if errors else None,
        "baseline_8_within_one": sum(abs(8 - want) <= 1 for want, _ in pairs),
    }


def _key(item: str) -> str:
    return " ".join(item.lower().split())


# An area's floors or room, without the model's description of the damage: "L27 to L29
# (floors linked by internal stair)" matches Marsh's "L27 to L29".
def _area(item: str) -> str:
    return _key(re.sub(r"\(.*?\)", "", item)).strip(" ,;-")


def expected_levels(facts: str) -> dict:
    """Marsh's areas (% damage) and BI items (months, % impacted) per level from the facts.

    Only areas named by floor or zone count: a level that damages the site value rows
    (Office 5's Level I, "Buildings 0.5%") has nothing an area could match.
    """
    levels = {}
    for line in facts.splitlines():
        m = re.match(r"^Level (I{1,3}): (.*)$", line.strip())
        if not m:
            continue
        body = m[2]
        te = {_key(t["item"]): (float(t["months"]), float(t["pct"])) for t in _TE.finditer(body)}
        damage = {
            _key(d["item"]): float(d["pct"])
            for d in _DAMAGE.finditer(body)
            if re.match(r"^(l|b)\d|level|basement", _key(d["item"]))
        }
        if damage or te:
            levels[m[1]] = {"damage": damage, "te": te}
    return levels


def score_levels(expected: dict, proposed: list[dict]) -> dict:
    """Counts for one Section 5 case, matching areas and BI items by name."""
    given = {p["level"]: p for p in proposed}
    counts = dict.fromkeys(
        [
            "areas_expected",
            "areas_matched",
            "damage_within_10",
            "unmatched_proposed",
            "months_within_3",
            "bi_percent_within_10",
        ],
        0,
    )
    for level, want in expected.items():
        got = given.get(level, {"damage": [], "te": []})
        damage = {_area(d["item"]): d["percent"] for d in got["damage"]}
        counts["areas_expected"] += len(want["damage"])
        counts["unmatched_proposed"] += sum(k not in want["damage"] for k in damage)
        for area, pct in want["damage"].items():
            if area in damage:
                counts["areas_matched"] += 1
                counts["damage_within_10"] += (
                    damage[area] is not None and abs(damage[area] - pct) <= 10
                )
        te = {_key(t["item"]): t for t in got["te"]}
        for item, (months, pct) in want["te"].items():
            t = te.get(item, {})
            counts["months_within_3"] += (
                t.get("months") is not None and abs(t["months"] - months) <= 3
            )
            counts["bi_percent_within_10"] += (
                t.get("percent") is not None and abs(t["percent"] - pct) <= 10
            )
    return counts


def run_case(path: Path) -> dict:
    case = json.loads(path.read_text())
    section = case["section_id"]
    te_items = [m["item"].strip() for m in _TE.finditer(case["facts"])] if section == "5" else []
    answer = propose_figures(
        section,
        Assessment(**case["assessment"]),
        [Observation(**o) for o in case["observations"]],
        [],
        sorted(set(te_items)),
    )
    proposal = answer["proposal"]
    counts = (
        score_scores(expected_scores(case["facts"]), proposal["categories"])
        if section == "4"
        else score_levels(expected_levels(case["facts"]), proposal["levels"])
    )
    return {
        "case": path.stem,
        "section": section,
        **counts,
        "proposal": proposal,
        "model": answer["provenance"]["model"],
        "effort": config.LLM_EFFORT,
        "prompt_version": PROPOSAL_PROMPT_VERSION,
        "at": datetime.now(UTC).isoformat(),
    }


def main(names: list[str]) -> None:
    paths = [
        p
        for p in sorted((HERE / "cases").glob("*.json"))
        if json.loads(p.read_text()).get("section_id") in ("4", "5")
        and (not names or p.stem in names)
    ]
    rows = [run_case(p) for p in paths]
    out = HERE / "results" / f"{datetime.now(UTC):%Y-%m-%d}-figures.jsonl"
    out.parent.mkdir(exist_ok=True)
    with out.open("a") as f:
        f.writelines(json.dumps(r) + "\n" for r in rows)
    for r in rows:
        shown = {k: v for k, v in r.items() if k not in ("proposal", "at", "case")}
        print(f"{r['case']:28} {shown}")


if __name__ == "__main__":
    main(sys.argv[1:])

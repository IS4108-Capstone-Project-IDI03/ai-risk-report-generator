"""The category eval's scoring (CP-21 AC10): which proposals pass and which quotes are found."""

import json

from eval.suggest_categories import CASES, quote_found, score

CASE = {
    "texts": [
        {"label": "Note", "kind": "note", "text": "Valve room L43"},
        {"label": "Recording 1", "kind": "recording", "text": "Main valve found  shut, no tag."},
    ],
    "photos": [{"label": "Photo 1"}],
    "expected": ["Protection", "Construction"],
    "also_fine": ["Occupancy"],
}


def proposed(category, *evidence):
    return {"category": category, "reason": "", "evidence": list(evidence)}


def test_a_quote_is_found_whatever_its_case_spacing_or_curly_quotes():
    assert quote_found("valve found shut", "Main valve found  shut, no tag.")
    assert quote_found("“Found shut,”", "Main valve found shut, no tag.")
    assert quote_found("it’s open", "It's open")
    assert not quote_found("valve was shut", "Main valve found shut")
    assert not quote_found("", "anything")
    assert not quote_found(None, "anything")


def test_passes_when_every_expected_category_and_only_fitting_ones_are_proposed():
    quote = {"item": "Recording 1", "quote": "found shut"}
    every = [proposed("Protection", quote), proposed("Construction", quote)]
    assert score(CASE, every).passed
    # One that is also fine doesn't fail it.
    assert score(CASE, [*every, proposed("Occupancy", quote)]).passed
    # A missing expected category, or one that doesn't fit, does.
    assert not score(CASE, every[:1]).passed
    assert not score(CASE, [*every, proposed("Exposure", quote)]).passed


def test_counts_recall_and_precision():
    s = score(CASE, [proposed("Protection"), proposed("Exposure")])
    assert (s.expected, s.found) == (2, 1)
    assert (s.proposed, s.fitting) == (2, 1)


def test_checks_each_quote_in_the_item_it_cites():
    s = score(
        CASE,
        [
            proposed(
                "Protection",
                {"item": "Recording 1", "quote": "found shut"},
                # A photo has no words, so it isn't counted.
                {"item": "Photo 1", "quote": None},
                # Words the item doesn't have, an item the case doesn't have, or no quote at all.
                {"item": "Note", "quote": "found shut"},
                {"item": "Recording 2", "quote": "found shut"},
                {"item": "Recording 1", "quote": None},
            )
        ],
    )
    assert (s.quotes, s.quotes_found) == (4, 1)


def test_every_case_is_well_formed():
    cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
    ids = [c["id"] for c in cases]
    assert len(set(ids)) == len(ids)
    cope = {"Construction", "Occupancy", "Protection", "Exposure"}
    for case in cases:
        assert case["expected"] and set(case["expected"]) <= cope
        assert set(case.get("also_fine", [])) <= cope - set(case["expected"])
        labels = [t["label"] for t in case["texts"]] + [p["label"] for p in case.get("photos", [])]
        assert len(set(labels)) == len(labels)
        assert all(t["kind"] in {"note", "recording", "page"} and t["text"] for t in case["texts"])

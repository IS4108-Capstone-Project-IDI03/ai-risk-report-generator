"""Ranking passages by source tier (RT-04): unit tests of apply_rank and one chat request."""

from app.retrieval.ranking import apply_rank
from tests.test_chat import _ask, fake  # noqa: F401  (fake is a fixture)

ORDER = ["national_code", "manufacturer_rating", "marsh_precedent", "international_standard"]
DOCS = {
    "sg": {"tier": "national_code", "jurisdiction": "SG"},
    "us": {"tier": "national_code", "jurisdiction": "US"},
    "fm": {"tier": "manufacturer_rating", "jurisdiction": None},
    "nfpa": {"tier": "international_standard", "jurisdiction": None},
    "odd": {"tier": "mystery", "jurisdiction": None},
}


def p(doc, score):
    return {"id": f"{doc}:1", "metadata": {"doc_id": doc}, "relevance_score": score}


def ids(passages):
    return [x["metadata"]["doc_id"] for x in passages]


def test_close_scores_sort_by_tier():
    out = apply_rank([p("nfpa", 0.90), p("fm", 0.88)], ORDER, DOCS, None)
    assert ids(out) == ["fm", "nfpa"]


def test_a_far_weaker_higher_tier_passage_is_not_lifted():
    out = apply_rank([p("nfpa", 0.90), p("fm", 0.50)], ORDER, DOCS, None)
    assert ids(out) == ["nfpa", "fm"]


def test_a_foreign_national_code_gets_no_boost():
    out = apply_rank([p("fm", 0.90), p("us", 0.89)], ORDER, DOCS, "SG")
    assert ids(out) == ["fm", "us"]
    # No jurisdiction filter at all: no boost either.
    assert ids(apply_rank([p("fm", 0.90), p("sg", 0.89)], ORDER, DOCS, None)) == ["fm", "sg"]


def test_a_national_code_of_the_questions_jurisdiction_is_boosted():
    out = apply_rank([p("fm", 0.90), p("sg", 0.89)], ORDER, DOCS, "SG")
    assert ids(out) == ["sg", "fm"]


def test_no_tier_order_leaves_passages_unchanged():
    given = [p("nfpa", 0.9), p("fm", 0.89)]
    assert apply_rank(given, [], DOCS, "SG") == given


def test_an_unknown_tier_or_document_ranks_last():
    out = apply_rank([p("odd", 0.90), p("ghost", 0.90), p("nfpa", 0.89)], ORDER, DOCS, None)
    assert ids(out) == ["nfpa", "odd", "ghost"]


def test_chat_works_without_the_new_fields(fake):  # noqa: F811
    assert _ask("What clearance?")  # no tier_order, documents without tier

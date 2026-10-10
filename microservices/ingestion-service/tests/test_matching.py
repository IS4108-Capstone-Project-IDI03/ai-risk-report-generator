"""IN-07: duplicate and newer-edition matching, with Chroma and MongoDB faked."""

import pytest
from fakes import FakeDocuments, FakePassages, stored_doc

from app import matching

# Three vectors at right angles: alike only to themselves (similarity 1 or 0).
A, B, C = [1, 0, 0], [0, 1, 0], [0, 0, 1]


@pytest.fixture
def passages(monkeypatch):
    fake = FakePassages()
    monkeypatch.setattr(matching, "passages_collection", lambda: fake)
    return fake


def test_a_later_year_of_the_same_standard_is_a_newer_edition(passages):
    old = stored_doc(edition="2019")
    new = stored_doc(title="A different title", edition="2022", standardNumber=" 13 ")

    match = matching.find_match(new, FakeDocuments(old, new))

    assert match["kind"] == "newer_edition"
    assert match["documentId"] == old["_id"]


def test_an_earlier_year_is_an_earlier_edition(passages):
    stored, new = stored_doc(edition="2022"), stored_doc(edition="2016")

    assert matching.find_match(new, FakeDocuments(stored, new))["kind"] == "earlier_edition"


def test_the_same_year_is_not_an_edition_match(passages):
    stored, new = stored_doc(edition="2022"), stored_doc(edition="2022")

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_an_edition_is_compared_with_the_non_withdrawn_one_else_the_newest(passages):
    withdrawn_newest = stored_doc(edition="2025", withdrawn={"at": 1})
    live_old = stored_doc(edition="2019")
    new = stored_doc(edition="2022")

    match = matching.find_match(new, FakeDocuments(withdrawn_newest, live_old, new))
    assert (match["kind"], match["documentId"]) == ("newer_edition", live_old["_id"])

    live_old["withdrawn"] = {"at": 1}  # nothing live now: the newest is the reference
    match = matching.find_match(new, FakeDocuments(withdrawn_newest, live_old, new))
    assert (match["kind"], match["documentId"]) == ("earlier_edition", withdrawn_newest["_id"])


def test_between_two_copies_of_one_edition_the_one_sharing_more_passages_is_compared(passages):
    unrelated = stored_doc(edition="2019")
    closer = stored_doc(edition="2019")
    new = stored_doc(edition="2022")
    passages.add(str(unrelated["_id"]), [C])
    passages.add(str(closer["_id"]), [A, B])
    passages.add(str(new["_id"]), [A, B])

    match = matching.find_match(new, FakeDocuments(unrelated, closer, new))

    assert (match["documentId"], match["newMatched"]) == (closer["_id"], 2)


def test_an_unconfirmed_edition_skips_the_edition_check(passages):
    stored = stored_doc(edition="2019")
    new = stored_doc(edition="2022", unconfirmed=["edition"])

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_a_different_issuing_body_or_number_is_not_the_same_standard(passages):
    other_body = stored_doc(edition="2019", issuingBody="FM Global")
    other_number = stored_doc(edition="2019", standardNumber="25")
    new = stored_doc(edition="2022")

    assert matching.find_match(new, FakeDocuments(other_body, other_number, new)) is None


def test_titles_are_never_compared(passages):
    stored = stored_doc(title="Standard for Sprinklers", edition="2019")
    new = stored_doc(title="Something else entirely", edition="2022")

    assert matching.find_match(new, FakeDocuments(stored, new))["kind"] == "newer_edition"


def test_a_report_never_gets_an_edition_match(passages):
    stored = stored_doc(edition="2019", metadata={"source_type": "marsh_report"})
    new = stored_doc(edition="2022", metadata={"source_type": "marsh_report"})

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_same_number_and_edition_with_a_low_share_is_no_match(passages):
    stored, new = stored_doc(edition="2022"), stored_doc(edition="2022")  # different chapters
    passages.add(str(stored["_id"]), [A, B, C, [1, 1, 0]])
    passages.add(str(new["_id"]), [[0, 1, 1], [1, 0, 1], [1, 1, 1], [1, -1, 0]])

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_a_copy_of_the_same_edition_beats_an_edition_match(passages):
    copy, older = stored_doc(edition="2022"), stored_doc(edition="2019")
    new = stored_doc(edition="2022")
    for doc in (copy, older, new):
        passages.add(str(doc["_id"]), [A, B, C])

    match = matching.find_match(new, FakeDocuments(older, copy, new))

    assert (match["kind"], match["documentId"]) == ("possible_copy", copy["_id"])


def test_a_copy_of_a_withdrawn_edition_is_still_a_copy(passages):
    stored = stored_doc(edition="2022", withdrawn={"at": 1})
    new = stored_doc(edition="2022")
    passages.add(str(stored["_id"]), [A, B])
    passages.add(str(new["_id"]), [A, B])

    assert matching.find_match(new, FakeDocuments(stored, new))["kind"] == "possible_copy"


def test_an_edition_by_number_beats_a_content_only_edition(passages):
    by_number = stored_doc(edition="2016", standardNumber="13")
    by_content = stored_doc(edition="2019", standardNumber=None)
    new = stored_doc(edition="2022")
    passages.add(str(by_content["_id"]), [A, B, C])  # shares everything; rule 2 still comes first
    passages.add(str(new["_id"]), [A, B, C])

    match = matching.find_match(new, FakeDocuments(by_content, by_number, new))

    assert (match["kind"], match["documentId"]) == ("newer_edition", by_number["_id"])


def test_without_a_number_a_shared_standard_of_another_edition_is_an_edition(passages):
    stored = stored_doc(edition="2019", standardNumber=None)
    new = stored_doc(edition="2022", standardNumber="13")
    passages.add(str(stored["_id"]), [A, B, C])
    passages.add(str(new["_id"]), [A, B, C])

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert (match["kind"], match["documentId"]) == ("newer_edition", stored["_id"])


def test_without_a_number_and_a_low_share_another_edition_is_no_match(passages):
    stored = stored_doc(edition="2019", standardNumber=None)
    new = stored_doc(edition="2022", standardNumber="13")
    passages.add(str(stored["_id"]), [A])
    passages.add(str(new["_id"]), [B])

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_a_copy_of_another_standard_with_a_different_number_is_a_plain_copy(passages):
    stored = stored_doc(edition="2019", standardNumber="25")
    new = stored_doc(edition="2022", standardNumber="13")
    passages.add(str(stored["_id"]), [A, B, C])
    passages.add(str(new["_id"]), [A, B, C])

    assert matching.find_match(new, FakeDocuments(stored, new))["kind"] == "possible_copy"


def test_a_new_document_whose_passages_mostly_repeat_a_stored_one_is_a_possible_copy(passages):
    stored = stored_doc(title="Survey", metadata={"source_type": "marsh_report"})
    new = stored_doc(title="Survey 2", metadata={"source_type": "marsh_report"})
    passages.add(str(stored["_id"]), [A, B, C, [1, 1, 1]])
    passages.add(str(new["_id"]), [A, B, C, [1, -1, 0]])  # 3 of 4 repeat

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert match == {
        "kind": "possible_copy",
        "documentId": stored["_id"],
        "newMatched": 3,
        "newTotal": 4,
        "storedMatched": 3,
        "storedTotal": 4,
    }


def test_an_excerpt_of_a_stored_document_is_flagged_by_the_new_share(passages):
    stored, new = stored_doc(title="Whole"), stored_doc(title="Excerpt")
    passages.add(str(stored["_id"]), [A, B, C, [1, 1, 0], [0, 1, 1], [1, 0, 1]])
    passages.add(str(new["_id"]), [A, B])  # all of the new one, 2 of 6 of the stored one

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert (match["newMatched"], match["newTotal"]) == (2, 2)
    assert (match["storedMatched"], match["storedTotal"]) == (2, 6)


def test_a_new_document_that_contains_a_stored_one_is_flagged_by_the_stored_share(passages):
    stored, new = stored_doc(title="Short"), stored_doc(title="Long")
    passages.add(str(stored["_id"]), [A, B])
    passages.add(str(new["_id"]), [A, B, C, [1, 1, 0], [0, 1, 1]])

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert (match["newMatched"], match["newTotal"]) == (2, 5)
    assert (match["storedMatched"], match["storedTotal"]) == (2, 2)


def test_below_the_minimum_share_nothing_is_flagged(passages):
    stored, new = stored_doc(title="One"), stored_doc(title="Two")
    passages.add(str(stored["_id"]), [A, B, C, [1, 1, 0]])
    passages.add(str(new["_id"]), [A, [0, 1, 1], [1, 0, 1], [1, 1, 1]])  # 1 of 4 matches

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_passages_just_under_the_similarity_limit_do_not_match(passages):
    stored, new = stored_doc(title="One"), stored_doc(title="Two")
    passages.add(str(stored["_id"]), [A])
    passages.add(str(new["_id"]), [[0.8, 0.6, 0]])  # similarity 0.80 < 0.90

    assert matching.find_match(new, FakeDocuments(stored, new)) is None


def test_the_document_with_the_highest_share_wins(passages):
    weak, strong = stored_doc(title="Weak"), stored_doc(title="Strong")
    new = stored_doc(title="New")
    passages.add(str(weak["_id"]), [A, B, C, [1, 1, 0], [0, 1, 1]])  # 3 of 4 new passages
    passages.add(str(strong["_id"]), [A, B, C, [1, 1, 1]])  # all 4
    passages.add(str(new["_id"]), [A, B, C, [1, 1, 1]])

    match = matching.find_match(new, FakeDocuments(weak, strong, new))

    assert match["documentId"] == strong["_id"]


def test_matching_batches_large_documents_within_chroma_query_quota(passages, monkeypatch):
    stored, new = stored_doc(), stored_doc()
    vectors = [A] * 21
    passages.add(str(stored["_id"]), vectors)
    passages.add(str(new["_id"]), vectors)

    collection = matching.passages_collection()
    query = collection.query
    calls = []

    def batched_query(*args, **kwargs):
        calls.append(len(kwargs["query_embeddings"]))
        return query(*args, **kwargs)

    monkeypatch.setattr(collection, "query", batched_query)

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert match["documentId"] == stored["_id"]
    assert calls == [20, 1]


def test_failed_and_unfinished_documents_are_not_candidates(passages):
    failed, queued = stored_doc(title="F", status="failed"), stored_doc(title="Q", status="queued")
    new = stored_doc(title="New")
    passages.add(str(failed["_id"]), [A, B])
    passages.add(str(queued["_id"]), [A, B])
    passages.add(str(new["_id"]), [A, B])

    assert matching.find_match(new, FakeDocuments(failed, queued, new)) is None


def test_withdrawn_documents_are_candidates(passages):
    stored = stored_doc(title="Gone", withdrawn={"at": 1})
    new = stored_doc(title="New")
    passages.add(str(stored["_id"]), [A, B])
    passages.add(str(new["_id"]), [A, B])

    assert matching.find_match(new, FakeDocuments(stored, new))["kind"] == "possible_copy"


def test_an_edition_match_wins_and_keeps_the_copy_counts(passages):
    stored, new = stored_doc(edition="2019"), stored_doc(edition="2022")
    passages.add(str(stored["_id"]), [A, B, C])
    passages.add(str(new["_id"]), [A, B, C])  # also an identical copy

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert match["kind"] == "newer_edition"
    assert (match["newMatched"], match["storedMatched"], match["storedTotal"]) == (3, 3, 3)


def test_an_edition_match_with_no_shared_passages_has_zero_counts(passages):
    stored, new = stored_doc(edition="2019"), stored_doc(edition="2022")
    passages.add(str(stored["_id"]), [A, B])
    passages.add(str(new["_id"]), [C])

    match = matching.find_match(new, FakeDocuments(stored, new))

    assert (match["newMatched"], match["newTotal"]) == (0, 1)
    assert (match["storedMatched"], match["storedTotal"]) == (0, 2)


def test_comparison_pairs_alike_passages_and_slots_in_the_unmatched_ones(passages):
    passages.add("new", [A, [0, 0, 1], B], ["a", "x", "b"])  # x is new-only
    passages.add("old", [A, [1, 1, 1], B, [0, 1, 1]], ["a", "y", "b", "z"])

    rows = matching.comparison_rows("new", "old")

    texts = [(r["new"] and r["new"]["text"], r["stored"] and r["stored"]["text"]) for r in rows]
    assert texts == [("a", "a"), ("x", None), (None, "y"), ("b", "b"), (None, "z")]
    assert [r["differs"] for r in rows] == [False, True, True, False, True]
    assert rows[0]["new"] == {"id": "new:0", "text": "a", "pageStart": 1, "pageEnd": 1}


def test_comparison_orders_new_passages_numerically(passages):
    passages.add("new", [A] * 11, [str(n) for n in range(11)])
    passages.add("old", [B], ["only"])

    rows = matching.comparison_rows("new", "old")

    assert [r["new"]["text"] for r in rows if r["new"]] == [str(n) for n in range(11)]


def test_a_document_never_matches_its_own_edition_family(passages):
    family = object()
    old = stored_doc(edition="2019", editionFamily=family)
    new = stored_doc(edition="2022", editionFamily=family)

    assert matching.find_match(new, FakeDocuments(old, new)) is None


def test_a_changed_number_in_a_paired_passage_is_highlighted(passages):
    passages.add("new", [A, B], ["spacing 120 ft", "same."])
    passages.add("old", [A, B], ["spacing 100 ft", "Same"])

    rows = matching.comparison_rows("new", "old")

    assert [r["differs"] for r in rows] == [True, False]  # tidying ignores case and punctuation

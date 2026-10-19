"""The handwriting eval's scoring (CP-19 AC16): how written and read words line up and count."""

from eval.transcribe_handwriting import read_words, score, written_words


def scored(written: str, read: str, uncertain=()):
    return score(written_words(written), read_words(read, list(uncertain)))


def test_a_perfect_reading_ignores_case_punctuation_and_line_breaks():
    result = scored("B1 spk CV found shut,\nno tamper sw", "b1 SPK cv found shut no\ntamper sw.")

    assert (result.words, result.correct, result.wrong, result.missed) == (8, 8, 0, 0)
    assert result.changes == []


def test_counts_misread_missed_and_added_words():
    result = scored("FHR pressure 7 bar at L2", "FHR presure 7 bar at the L2")

    assert result.words == 6
    assert result.correct == 5
    assert result.misread == 1
    assert result.added == 1
    assert result.missed == 0
    assert result.changes == ["pressure → presure", "added the"]

    result = scored("spk CV shut", "spk shut")
    assert (result.correct, result.missed, result.changes) == (2, 1, ["missed cv"])


def test_counts_which_wrong_words_were_marked_uncertain():
    # "fond" (characters 4-8) was marked; "valve" (9-14) was marked but is right.
    result = scored("CV found valve", "CV fond valve", uncertain=[[3, 7], [8, 13]])

    assert result.wrong == 1
    assert result.wrong_flagged == 1
    assert result.flagged == 2
    assert result.changes == ["found → fond (marked)"]


def test_a_word_its_writer_cannot_read_is_not_scored():
    result = scored("tamper [?] fitted", "tamper sw fitted", uncertain=[[7, 9]])

    assert (result.words, result.correct, result.wrong) == (2, 2, 0)
    # The model's guess there is neither right nor wrong, so its mark doesn't count either.
    assert result.flagged == 0
    assert scored("tamper [?] fitted", "tamper fitted").missed == 0


def test_marks_are_matched_by_browser_positions():
    # "📷" is two UTF-16 units, so "done" starts at 3, not 2.
    assert read_words("📷 done", [[3, 7]]) == [("📷", False), ("done", True)]


def test_an_empty_page_scores_no_words():
    assert written_words("") == []
    assert scored("", "").words == 0

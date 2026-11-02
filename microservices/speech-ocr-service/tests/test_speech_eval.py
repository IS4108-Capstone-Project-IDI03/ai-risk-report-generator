"""Tests for the voice-to-text eval's scoring (CP-22). No paid calls."""

from eval.transcribe_speech import normalise, segments_ok, term_found, word_errors


def test_normalise_matches_spoken_and_written_forms():
    assert normalise("Um, level one, FM-200 at 2.4 metres.") == [
        "level",
        "1",
        "fm",
        "200",
        "at",
        "2.4",
        "meters",
    ]
    assert normalise("two point four metres, SS546") == ["2.4", "meters", "ss", "546"]
    assert normalise("1,200 sprinklers.") == ["1200", "sprinklers"]


def test_word_errors_counts_substitution_deletion_insertion():
    assert word_errors(["a", "b", "c"], ["a", "b", "c"]) == 0
    assert word_errors(["a", "b", "c"], ["a", "x", "c"]) == 1
    assert word_errors(["a", "b", "c"], ["a", "c"]) == 1
    assert word_errors(["a", "b"], ["a", "b", "c"]) == 1


def test_term_found_needs_the_words_in_order_together():
    heard = normalise("The FM 200 cylinders in Block H, basement 2.")
    assert term_found("FM-200", heard)
    assert term_found("Basement 2", heard)
    assert not term_found("Block A", heard)
    assert not term_found("200 FM", heard)


def test_segments_ok():
    good = [{"start": 0, "end": 2}, {"start": 2, "end": 5}]
    assert segments_ok(good)
    assert not segments_ok([])
    assert not segments_ok([{"start": 3, "end": 3}])
    assert not segments_ok(list(reversed(good)))


def test_normalise_treats_british_and_american_spelling_alike():
    assert normalise("fire command centre, 2.4 metres") == normalise(
        "fire command center, 2.4 meters"
    )

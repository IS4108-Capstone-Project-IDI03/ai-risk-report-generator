"""CP-27: the rule-based tidy of a spoken transcript. It only ever deletes words."""

from app.processors.tidy import rules


def test_fillers_are_removed():
    assert rules("um the sprinkler uh is wet") == "the sprinkler is wet"


def test_fillers_beside_punctuation_or_capitalised_are_removed():
    assert rules("Um, the pump, uhh, runs.") == "The pump runs."


def test_a_word_said_twice_is_kept_once():
    assert rules("the the pump") == "the pump"


def test_a_short_phrase_said_twice_is_kept_once():
    assert rules("I think I think it leaks") == "I think it leaks"
    assert rules("on the roof, on the roof there is a tank") == "on the roof there is a tank"


def test_a_number_said_twice_stays_as_spoken():
    # Room ten-ten, unit 10 10: a repeated number is a value, not a stumble.
    assert rules("room ten ten") == "room ten ten"
    assert rules("room 10 10") == "room 10 10"


def test_grammatical_doubles_stay_as_spoken():
    assert rules("I know that that pump had had issues") == "I know that that pump had had issues"
    assert rules("the problem is is that it leaks") == "the problem is is that it leaks"


def test_a_stutter_becomes_the_whole_word():
    assert rules("the s- sprinkler head") == "the sprinkler head"
    assert rules("the s-s-sprinkler head") == "the sprinkler head"
    assert rules("the spr- sprinkler head") == "the sprinkler head"


def test_a_hyphenated_word_is_not_a_stutter():
    assert rules("re-reading the pre-pressurised gauge") == "re-reading the pre-pressurised gauge"


def test_words_that_can_carry_meaning_stay():
    # "no" negates, "well" can be a water well, "like" compares, "you know"/"I mean" can lead in.
    spoken = "no sprinklers, well water like a pond, you know, I mean the tank, so actually empty"
    assert rules(spoken) == spoken


def test_a_self_correction_is_left_for_the_engineer_or_the_model():
    # Dropping the wrong half would change the fact, so rules never touch it.
    spoken = "the pump is on level 3, sorry, level 4"
    assert rules(spoken) == spoken


def test_rules_only_ever_delete_words():
    # Whatever the input, the tidy words appear in the spoken words, in the same order.
    from app.processors.tidy import bare

    for spoken in [
        "Um, so the the s- sprinkler, uh, I think I think it's, er, blocked.",
        "uh uh um",
        "",
        "Hmm. The pump. The pump runs at 10 10 psi, you know.",
    ]:
        left = iter(bare(w) for w in spoken.split())
        assert all(bare(w) in left for w in rules(spoken).split()), spoken

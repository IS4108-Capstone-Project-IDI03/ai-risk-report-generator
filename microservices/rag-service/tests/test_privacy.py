"""PV-02: the rag privacy client masks text through privacy-service and unmasks the
model's output. privacy-service's /mask is faked in-process (conftest `fake_privacy`)."""

import json

import httpx
import pytest

from app import privacy
from app.generation.llm import GenerationFailed

KNOWN = [
    {"type": "CLIENT", "names": ["Acme Holdings"]},
    {"type": "PERSON", "names": ["John Tan"]},
]
ON = {"enabled": True, "known_entities": KNOWN}


def test_without_protection_texts_pass_through_and_nothing_is_sent(fake_privacy):
    for request in (None, {"enabled": False, "known_entities": KNOWN}):
        assert privacy.session(request).mask(["John Tan called"]) == ["John Tan called"]
    assert fake_privacy.requests == []


def test_with_protection_known_details_are_masked_and_restored(fake_privacy):
    s = privacy.session(ON)

    [masked] = s.mask(["John Tan of Acme Holdings, +65 9123 4567"])

    assert masked == "[PERSON_1] of [CLIENT_1], [PHONE_1]"
    assert fake_privacy.requests[0]["known_entities"] == KNOWN
    assert s.unmask("[PERSON_1] (person_1) works for [CLIENT_1]") == (
        "John Tan (John Tan) works for Acme Holdings",
        [],
    )


def test_a_second_call_keeps_the_first_calls_placeholders(fake_privacy):
    s = privacy.session(ON)
    [first] = s.mask(["Call +65 9123 4567"])

    [second] = s.mask(["Call +65 8888 1111, not +65 9123 4567"])

    assert first == "Call [PHONE_1]"
    assert second == "Call [PHONE_2], not [PHONE_1]"
    assert fake_privacy.requests[1]["mapping"] == {"[PHONE_1]": "+65 9123 4567"}
    assert s.unmask("[PHONE_1] / [PHONE_2]") == ("+65 9123 4567 / +65 8888 1111", [])


def test_a_placeholder_the_mapping_lacks_is_reported_and_left_as_written(fake_privacy):
    s = privacy.session(ON)
    s.mask(["John Tan"])

    assert s.unmask("[PERSON_1] met [PERSON_9]") == ("John Tan met [PERSON_9]", ["[PERSON_9]"])


def test_a_placeholder_already_in_the_input_is_never_restored_as_a_real_value(fake_privacy):
    original = "Note says [PERSON_1] and [LITERAL_1]; John Tan attended"
    s = privacy.session(ON)

    [masked] = s.mask([original])

    assert "John Tan" not in masked
    assert s.unmask(masked) == (original, [])


@pytest.mark.parametrize(
    "failure",
    [httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), 500],
    ids=["down", "timeout", "error"],
)
def test_a_privacy_service_failure_fails_the_draft_without_revealing_text(fake_privacy, failure):
    fake_privacy.failure = failure

    with pytest.raises(privacy.PrivacyUnavailable) as raised:
        privacy.session(ON).mask(["John Tan, +65 9123 4567"])

    # A GenerationFailed, so the routes return it as a readable 502 (fail closed, Rule 3).
    assert isinstance(raised.value, GenerationFailed)
    assert "privacy service" in str(raised.value)
    assert "John Tan" not in str(raised.value) and "9123" not in str(raised.value)


def test_provenance_records_protection_and_how_many_details_were_masked(fake_privacy):
    s = privacy.session(ON)
    s.mask(["John Tan of Acme Holdings", "John Tan again"])

    assert s.provenance() == {"enabled": True, "masked_count": 2}
    assert privacy.session(None).provenance() == {"enabled": False, "masked_count": 0}


def test_without_protection_output_is_left_as_written(fake_privacy):
    # Off means drafting behaves as before PV-02: nothing is restored or flagged.
    assert privacy.session(None).unmask("See [PERSON_1] and LITERAL_2") == (
        "See [PERSON_1] and LITERAL_2",
        [],
    )


def _masked_session() -> privacy.Session:
    """A session that has masked John Tan as [PERSON_1] and Acme Holdings as [CLIENT_1]."""
    s = privacy.session(ON)
    s.mask(["John Tan of Acme Holdings"])
    return s


def test_a_streamed_answer_reaches_the_screen_with_real_names(fake_privacy):
    s = _masked_session()

    out = list(s.unmask_stream(iter(['s1 = Statement("[PER', 'SON_1] of [CLIENT_1] agreed.")'])))

    assert "".join(out) == 's1 = Statement("John Tan of Acme Holdings agreed.")'
    assert not any("PER" in piece or "SON_1" in piece for piece in out), out


def test_text_that_only_starts_like_a_placeholder_streams_through_unchanged(fake_privacy):
    s = _masked_session()
    answer = (
        "root = Answer([s1, s2], meta)\n"
        's1 = Statement("The site client keeps a person on [standby] at each SITE.", [c1])\n'
        's2 = Statement("See [PHONE_BOOK] and CLIENT_X.", [])\n'
        # Cut off mid-word (the engineer pressed stop): the held-back end still arrives.
        's3 = Statement("Ask the client'
    )

    out = list(s.unmask_stream(iter(answer[i : i + 3] for i in range(0, len(answer), 3))))

    assert "".join(out) == answer


def test_text_is_never_held_back_for_more_than_24_characters(fake_privacy):
    s = _masked_session()
    text = "Ref PERSON_" + "7" * 40 + " ends here."
    shown = []

    def chunks():
        for pulled, char in enumerate(text):
            # Before each new character, all but the last 24 pulled are already on screen.
            assert pulled - len("".join(shown)) <= 24, (pulled, "".join(shown))
            yield char

    for piece in s.unmask_stream(chunks()):
        shown.append(piece)

    assert "".join(shown) == text


def test_a_restored_name_keeps_the_answer_program_parseable(fake_privacy):
    awkward = 'Tan "AK" Ah Kow \ Facilities'
    s = privacy.session(
        {"enabled": True, "known_entities": [{"type": "PERSON", "names": [awkward]}]}
    )
    [masked] = s.mask([f"{awkward} agreed."])
    assert masked == "[PERSON_1] agreed."

    line = "".join(s.unmask_stream(iter(['s1 = Statement("[PERSON_1] agreed.", [])'])))

    literal = line[len("s1 = Statement(") : line.index(", [])")]
    assert json.loads(literal) == f"{awkward} agreed."

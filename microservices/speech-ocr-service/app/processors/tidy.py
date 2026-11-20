"""Tidies a spoken transcript (CP-27). It only ever deletes words: what was said is never
reworded, so the tidy text means what the speaker meant. Whisper's own text is kept as evidence.

The lists below are fixed on purpose: a word joins one only with a test beside it. Anything they
miss is left to the model's pass (CP-27), which may also only delete."""

import re
from collections.abc import Callable

# Sounds with no meaning in English speech.
FILLERS = {"um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "hmm", "mm", "mhm"}

# The longest phrase said twice in a row that is taken as a stumble rather than a choice.
LONGEST_REPEAT = 3

# A repeated number is a value ("room ten ten", "10 10"), so it is never collapsed.
NUMBER_WORDS = {
    "zero", "oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
    "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
    "hundred", "thousand", "million", "point", "double", "triple",
}  # fmt: skip

# Words English can say twice on purpose: "I know that that pump", "it had had a leak",
# "the problem is is that".
GRAMMATICAL_DOUBLES = {"that", "had", "is"}

# A cut-off start of the word that follows: "spr- sprinkler", "s-s-sprinkler". Joined to the word
# (no space), only a single letter counts, so prefixes such as "re-reading" stay.
_STUTTER = re.compile(r"\b(?:(\w{1,4})-\s+(?=\1)|(\w)-(?=\2))", re.IGNORECASE)

# A word with whatever punctuation Whisper put around it.
_EDGES = re.compile(r"^(\W*)(.*?)(\W*)$")


def rules(text: str) -> str:
    """The transcript without fillers, stumbled repeats and stutters."""
    words = _STUTTER.sub("", text).split()
    _remove(words, lambda i: 1 if bare(words[i]) in FILLERS else 0)
    _remove(words, lambda i: _repeat_at(words, i))
    return " ".join(words)


def bare(token: str) -> str:
    """A word without its punctuation, in lower case: the form two words are compared in."""
    return _EDGES.match(token).group(2).lower()


def is_number(word: str) -> bool:
    return word in NUMBER_WORDS or any(c.isdigit() for c in word)


def _remove(words: list[str], how_many_at: Callable[[int], int]) -> None:
    """Walks the words, dropping as many at each place as `how_many_at` says."""
    i = 0
    while i < len(words):
        n = how_many_at(i)
        if not n:
            i += 1
        for _ in range(n):
            _drop(words, i)


def _repeat_at(words: list[str], i: int) -> int:
    """How many words starting at i are said again straight after; 0 for none."""
    for n in range(LONGEST_REPEAT, 0, -1):
        first = [bare(w) for w in words[i : i + n]]
        again = [bare(w) for w in words[i + n : i + 2 * n]]
        if (
            len(again) == n
            and first == again
            and not any(map(is_number, first))
            and not (n == 1 and first[0] in GRAMMATICAL_DOUBLES)
        ):
            return n
    return 0


def _drop(words: list[str], index: int) -> None:
    """Removes words[index] the way an editor would: its commas go with it, a full stop moves to
    the word before, and a capital at the start of a sentence passes to the word after."""
    _, core, after = _EDGES.match(words.pop(index)).groups()
    end = after.strip(",;:-")
    if index > 0:
        before = words[index - 1].rstrip(",;:")
        words[index - 1] = before + end
    if core[:1].isupper() and index < len(words):
        lead, rest, tail = _EDGES.match(words[index]).groups()
        words[index] = lead + rest[:1].upper() + rest[1:] + tail

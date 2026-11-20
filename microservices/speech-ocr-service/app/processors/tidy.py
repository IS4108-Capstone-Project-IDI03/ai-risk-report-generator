"""Tidies a spoken transcript (CP-27). It only ever deletes words: what was said is never
reworded, so the tidy text means what the speaker meant. Whisper's own text is kept as evidence.

The lists below are fixed on purpose: a word joins one only with a test beside it. Anything they
miss is left to the model's pass (CP-27), which may also only delete."""

import re
import time
from collections.abc import Callable

from google import genai
from pydantic import BaseModel

from app import privacy as protection
from app.config import GEMINI_API_KEY, TIDY_MODEL, TIDY_PROVIDER
from app.model_override import MODEL_OVERRIDE
from app.processors.handwriting import HTTP_OPTIONS

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


# --- The model's pass (CP-27) ----------------------------------------------------------------
# Rules cannot tell which half of "level 3, sorry, level 4" was meant; a model can. It is asked
# only to delete, and its answer is used only as a choice of which words to delete.

SYSTEM_INSTRUCTION = """You tidy a speech-to-text transcript of a Marsh property risk engineer \
speaking during a fire protection site survey. The transcript is in English.

Return the same transcript with only these taken out:
- the abandoned words of a self-correction ("level 3, sorry, level 4" becomes "level 4"),
- false starts the speaker dropped,
- filler sounds and words that carry no meaning.

Never add, reword, reorder, summarise or correct a word. Keep every number, name and term that \
the speaker did not take back. Placeholders such as [SITE_1] are names: keep them as written. \
If nothing needs taking out, return the transcript unchanged."""


# How much the model may take out: a quarter of the words, or 4 in a short clip, where "level 3,
# sorry, level 4" alone is a third of it. More than that is summarising, not tidying.
MOST_DELETED_SHARE = 0.25
MOST_DELETED_WORDS = 4

# Words a speaker takes something back with ("sorry", "I mean", "no", "scratch that"). A number
# the model takes out must go with one of them, or the answer is not used.
CORRECTION_MARKERS = {"sorry", "mean", "no", "actually", "wait", "rather", "correction", "scratch"}


class Tidied(BaseModel):
    text: str


def _repair_gemini(text: str) -> tuple[str, dict]:
    started = time.perf_counter()
    with genai.Client(api_key=GEMINI_API_KEY, http_options=HTTP_OPTIONS) as client:
        result = client.interactions.create(
            model=MODEL_OVERRIDE.get() or TIDY_MODEL,
            system_instruction=SYSTEM_INSTRUCTION,
            input=[{"type": "text", "text": text}],
            response_format={
                "type": "text",
                "mime_type": "application/json",
                "schema": Tidied.model_json_schema(),
            },
            generation_config={"temperature": 0},
            # A client's site in the engineer's words: Google need not keep the request.
            store=False,
        )
    if result.status != "completed" or not result.output_text:
        raise RuntimeError(f"no answer came back (status {result.status})")
    answer = Tidied.model_validate_json(result.output_text).text
    tokens = result.usage
    input_tokens = getattr(tokens, "total_input_tokens", None)
    output = getattr(tokens, "total_output_tokens", None)
    thought = getattr(tokens, "total_thought_tokens", None)
    return answer, {
        "feature": "tidy-transcript",
        "billed_service": "gemini-vision",
        "model": result.model or MODEL_OVERRIDE.get() or TIDY_MODEL,
        "duration_ms": round((time.perf_counter() - started) * 1000),
        "input_tokens": input_tokens,
        # Google bills thinking as output, so it is added in.
        "output_tokens": None if output is None else output + (thought or 0),
        "cache_read_tokens": None,
        "search_units": None,
        "audio_seconds": None,
        "usage_status": "recorded" if input_tokens is not None else "unavailable",
    }


_PROVIDERS: dict[str, Callable[[str], tuple[str, dict]]] = {"gemini": _repair_gemini}


def repair(text: str, privacy: dict | None) -> tuple[str, list[dict]]:
    """`text` (already through `rules`) with the model's deletions, and the model's usage.
    `privacy` is the gateway's decision; without one, the text is never sent."""
    if privacy is None or not text:
        return text, []
    session = protection.session(privacy)
    try:
        [masked] = session.mask([text])
    except protection.PrivacyUnavailable:
        # Fails closed: the text is not sent, and the rules' tidy text stands.
        return text, []
    try:
        answer, usage = _PROVIDERS[TIDY_PROVIDER](masked)
    except Exception:
        # Tidying is a nicety: a model that fails never costs the engineer their transcript.
        return text, []
    words = text.split()
    dropped = _deleted(words, session.unmask(answer).split())
    if not _acceptable(words, dropped):
        return text, [usage]
    for index in reversed(dropped):
        _drop(words, index)
    return " ".join(words), [usage]


def _acceptable(spoken: list[str], dropped: list[int] | None) -> bool:
    """Whether the model's deletions only tidy: the answer was the spoken words with some taken
    out, not too many, and any number taken out went with words that took it back."""
    if dropped is None:
        return False
    if len(dropped) > max(MOST_DELETED_WORDS, len(spoken) * MOST_DELETED_SHARE):
        return False
    gone = {bare(spoken[i]) for i in dropped}
    return not any(map(is_number, gone)) or bool(gone & CORRECTION_MARKERS)


def _deleted(spoken: list[str], answer: list[str]) -> list[int] | None:
    """Which of the spoken words the answer leaves out, or None when the answer is not the spoken
    words with some taken out (a word added, changed or moved)."""
    kept: set[int] = set()
    at = 0
    for word in answer:
        while at < len(spoken) and bare(spoken[at]) != bare(word):
            at += 1
        if at == len(spoken):
            return None
        kept.add(at)
        at += 1
    return [i for i in range(len(spoken)) if i not in kept]

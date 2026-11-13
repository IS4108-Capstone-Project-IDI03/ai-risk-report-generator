"""MarshBot's wording (AS-06 round 5; the rules pick the format since round 8): MarshBot's new
turns in (each turn's pieces: its words, each marked with the form the rules gave it, and the ids
of its cards), one OpenUI Lang program per turn out. The model only rewords each piece and keeps
its form; the cards themselves are drawn by the client. Nothing is saved.

Called by routes.py's /assistant/wording (asked by server wording.service.ts). Calls privacy.py
(mask, unmask) and llm.complete under LLM_PROVIDER. The client draws the programs with
client/src/features/marshbot/.
"""

import re
from datetime import UTC, datetime
from pathlib import Path

from pydantic import BaseModel, ConfigDict

from app import config, usage
from app import privacy as pii
from app.assistant.prompts import WORDING_PROMPT_VERSION, WORDING_SYSTEM
from app.generation.llm import complete

# Must match AI_FEATURES in server/src/models/ai-call.model.ts.
FEATURE = "assistant-wording"
# The library's components, read from the prompt file the client's library generates, so no
# list here can drift from it. The gateway keeps the one full check (wording.service.ts).
_SIGNATURES = (
    (Path(__file__).parent / "marshbot_components.txt")
    .read_text()
    .split("## Component Signatures")[1]
    .split("\n## ")[0]
)
COMPONENTS = set(re.findall(r"^([A-Z]\w*)\(", _SIGNATURES, re.MULTILINE))
_STRING = r'"(?:[^"\\]|\\.)*"'
_CALL = re.compile(r"\b([A-Z]\w*)\(")
# A masked value that runs across a sentence end ("Alex! Capture"): the detector read half a
# sentence as one name, and the model garbles the turn around it.
_CROSSES_SENTENCE = re.compile(r"[.!?]\s")
# A placeholder the mapping couldn't restore (same shapes as privacy.py's unmask pattern).
_LEFTOVER = re.compile(rf"\b({'|'.join((*pii.TYPES, 'LITERAL'))})_\d+\b", re.IGNORECASE)


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# What the model returns.
class Program(_Model):
    message_id: str
    program: str


class WordingResult(_Model):
    programs: list[Program]


def _part_line(part: dict, text: str | None) -> str:
    """One part of a turn, in words for the model: its words (masked) named by the form the
    rules gave them, or a card id. Must match the tones of `Say` in server types.ts."""
    if part["type"] == "say":
        kind = {
            "lead": "Lead line, Lead(text)",
            "good": 'Words, good news, Say(text, "good")',
            "tick": "Ticked item, one item of Ticks([...])",
            "alert": "Stand-out message, Alert(text)",
        }.get(part.get("tone"), "Words, Say(text)")
        return f"- {kind}: {text}"
    return f'- Card("{part["id"]}"), a {part.get("card", "card")} card'


def _check(program: str) -> str | None:
    """The program with code fences removed, or None if it isn't an OpenUI program of MarshBot's
    library: not rooted at Reply, or calling another component. Only a sanity check, so nothing
    is unmasked for a reply the gateway can't draw; the gateway checks card ids, numbers and
    names (wording.service.ts). Reads no string literal, so a bad escape can't raise here."""
    program = re.sub(r"^```\w*\n|\n```$", "", program.strip()).strip()
    if not program.startswith("root = Reply("):
        return None
    if not set(_CALL.findall(re.sub(_STRING, '""', program))) <= COMPONENTS:
        return None
    return program


def word_messages(request, privacy=None) -> dict:
    """Return `{programs: {turn_id: program}, usage, provenance}`. Each message is one turn:
    its parts are `{type: "say", text, tone}` and `{type: "card", id, card}`. A turn whose
    program fails the checks has no entry, and the turn keeps the gateway's own drawing."""
    paid_calls = usage.start()
    protection = pii.session(privacy)
    provenance = {
        "provider": config.LLM_PROVIDER,
        "model": None,
        "effort": config.ASSISTANT_WORDING_EFFORT,
        "prompt_version": WORDING_PROMPT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    messages = request.messages

    def nothing() -> dict:
        return {
            "programs": {},
            "usage": paid_calls,
            "provenance": {**provenance, "privacy": protection.provenance()},
        }

    if not messages:
        return nothing()

    # a. Mask the name and every bubble in one /mask call; card ids carry no client text.
    says = [
        (m.id, i, p["text"]) for m in messages for i, p in enumerate(m.parts) if p["type"] == "say"
    ]
    masked = iter(protection.mask([request.viewer.first_name] + [text for _, _, text in says]))
    name = next(masked)
    texts = {(mid, i): next(masked) for mid, i, _ in says}
    # A turn holding a mis-read value is not sent: it keeps the gateway's rule words.
    misread = [p for p, value in protection.mapping.items() if _CROSSES_SENTENCE.search(value)]
    messages = [
        m
        for m in messages
        if not any(p in texts.get((m.id, i), "") for p in misread for i in range(len(m.parts)))
    ]
    if not messages:
        return nothing()

    # b. Ask the model, once for all turns.
    blocks = []
    for m in messages:
        parts = "\n".join(_part_line(p, texts.get((m.id, i))) for i, p in enumerate(m.parts))
        blocks.append(f"### Turn {m.id}\n{parts or '(none)'}")
    user = f"Viewer: {name} ({request.viewer.role})\n\nTurns:\n\n" + "\n\n".join(blocks)
    result, model = complete(
        WORDING_SYSTEM,
        user,
        WordingResult,
        config.ASSISTANT_WORDING_EFFORT,
        feature=FEATURE,
        model=config.ASSISTANT_WORDING_MODEL,
    )

    # c. Finish in code: check each program, then put the real values back. The text sits in
    # OpenUI string literals, so unmask_stream JSON-escapes them (a name with a quote stays valid).
    by_id = {m.id: m for m in messages}
    programs: dict[str, str] = {}
    for written in result.programs:
        program = (
            written.message_id in by_id
            and written.message_id not in programs
            and _check(written.program)
        )
        if not program:
            continue
        restored = "".join(protection.unmask_stream([program]))
        if protection.enabled and _LEFTOVER.search(restored):
            continue
        programs[written.message_id] = restored
    return {
        "programs": programs,
        "usage": paid_calls,
        "provenance": {**provenance, "model": model, "privacy": protection.provenance()},
    }

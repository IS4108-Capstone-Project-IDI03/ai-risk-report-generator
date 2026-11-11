"""MarshBot's wording (AS-06): the rules' messages in, each one reworded as an OpenUI Lang
program out. The model only rewords and orders; it points at items by id. Nothing is saved.

Called by routes.py's /assistant/wording. Calls privacy.py (mask, unmask) and llm.complete
under LLM_PROVIDER. The client renders the programs with client/src/features/marshbot/.
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


def link_key(index: int) -> str:
    """The key a message's link part goes by in a program: its position among the parts.
    Must match the client's LinkButton lookup (client/src/features/marshbot/)."""
    return f"link-{index}"


_PLAIN_PARTS = {
    "outline": "ReportOutline",
    "lanes": "StatusLanes",
    "stage-time": "StageTime",
    "file": "ExportFile",
}


def _part_line(index: int, part: dict, label: str | None) -> str:
    """One part the program must include, in words for the model."""
    kind = part["type"]
    if kind == "actions":
        return "- ActionRow, one per item id: " + ", ".join(part["itemIds"])
    if kind == "replies":
        return "- QuickReply, one per reply id: " + ", ".join(r["id"] for r in part["replies"])
    if kind == "health":
        return "- HealthBars for areas: " + (", ".join(part["areas"]) or "all")
    if kind == "link":
        return f'- LinkButton, label "{label}", id "{link_key(index)}"'
    return f"- {_PLAIN_PARTS[kind]}"


def _check(program: str) -> str | None:
    """The program with code fences removed, or None if it isn't an OpenUI program of MarshBot's
    library: not rooted at Reply, or calling another component. Only a sanity check, so nothing
    is unmasked for a reply the gateway can't draw; the gateway checks ids, numbers and the
    controls each message needs. Reads no string literal, so a bad escape can't raise here."""
    program = re.sub(r"^```\w*\n|\n```$", "", program.strip()).strip()
    if not program.startswith("root = Reply("):
        return None
    if not set(_CALL.findall(re.sub(_STRING, '""', program))) <= COMPONENTS:
        return None
    return program


def word_messages(request, privacy=None) -> dict:
    """Return `{programs: {message_id: program}, usage, provenance}`. A message whose program
    fails the checks has no entry, and the client shows its plain text."""
    paid_calls = usage.start()
    protection = pii.session(privacy)
    provenance = {
        "provider": config.LLM_PROVIDER,
        "model": None,
        "effort": config.ASSISTANT_WORDING_EFFORT,
        "prompt_version": WORDING_PROMPT_VERSION,
        "generated_at": datetime.now(UTC).isoformat(),
    }
    messages, items = request.messages, request.items
    if not messages:
        return {
            "programs": {},
            "usage": paid_calls,
            "provenance": {**provenance, "privacy": protection.provenance()},
        }

    # a. Mask the name, the messages, the items and the link labels in one /mask call.
    links = [
        (m.id, i, p["label"])
        for m in messages
        for i, p in enumerate(m.parts)
        if p["type"] == "link"
    ]
    texts = (
        [request.viewer.first_name]
        + [m.text for m in messages]
        + [v or "" for item in items for v in (item.title, item.detail)]
        + [label for _, _, label in links]
    )
    masked = iter(protection.mask(texts))
    name = next(masked)
    message_texts = [next(masked) for _ in messages]
    item_lines = []
    for item in items:
        title, detail = next(masked), next(masked)
        item_lines.append(f"- {item.id} | {item.weight} | {item.kind} | {title} | {detail}")
    labels = {(mid, i): next(masked) for mid, i, _ in links}

    # b. Ask the model, once for all messages.
    blocks = []
    for m, text in zip(messages, message_texts, strict=True):
        parts = "\n".join(_part_line(i, p, labels.get((m.id, i))) for i, p in enumerate(m.parts))
        blocks.append(f"### Message {m.id}\nText: {text}\nParts:\n{parts or '(none)'}")
    user = (
        f"Viewer: {name} ({request.viewer.role})\n\nItems (id | weight | kind | title | detail):\n"
        + ("\n".join(item_lines) or "(none)")
        + "\n\nMessages:\n\n"
        + "\n\n".join(blocks)
    )
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

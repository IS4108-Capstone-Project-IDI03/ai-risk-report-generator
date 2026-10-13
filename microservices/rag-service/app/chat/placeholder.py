"""Placeholder chat answers (CB-01 Step 0), streamed as AG-UI events.

Lets the chat screen and stored conversations be built before real answers
exist. CB-01 replaces this with real cited answers in the same event shape.
Called by POST /chat in app/api/routes.py; the gateway's /api/chat streams it on.
AG-UI is the event format OpenUI's chat screen reads (SSE lines of JSON).
"""

import itertools
import json
import time
import uuid
from collections.abc import Iterator

from app.retrieval.retriever import search

SEARCH_TOOL = "search_knowledge_base"
# A pause between words, so the answer arrives the way a model writes it.
# Without it, the whole answer lands at once and streaming can't be seen.
WORD_DELAY_SECONDS = 0.05
# Counts answers so a retry is visibly a new answer (CB-04 builds retry on this).
_answer_number = itertools.count(1)


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


def _closest_passage(question: str) -> list[dict]:
    """The one nearest passage as a citable source, or none."""
    try:
        hits = search([(question, {}, 1)])[0]
    except Exception:  # noqa: BLE001
        # ponytail: a placeholder must answer without Chroma or Cohere running,
        # so a team member can work on the screen alone. Real answers report it.
        return []
    return [
        {
            "label": "1",
            "id": hit["id"],
            "document_id": hit["metadata"].get("doc_id"),
            "page_start": hit["metadata"].get("page_start"),
            "page_end": hit["metadata"].get("page_end"),
            "headings": hit["metadata"].get("headings", []),
            "text": hit["text"],
        }
        for hit in hits
    ]


def _answer_text(declined: bool, passages: list[dict], context: list[str]) -> str:
    if declined:
        return "The knowledge base cannot answer this question."
    text = f"This is placeholder answer {next(_answer_number)}, not a real answer yet."
    if passages:
        text += f" The closest passage is on page {passages[0]['page_start']} [1]."
    if context:
        text += " Using: " + "; ".join(context) + "."
    return text


def placeholder_events(question: str, context: list[str]) -> Iterator[str]:
    """SSE lines for one placeholder answer: a search step, then the answer text."""
    # 1. The search, as a tool call: the screen shows the step, and its result
    #    holds the citable passages, which are saved with the conversation.
    call_id = str(uuid.uuid4())
    yield _sse({"type": "TOOL_CALL_START", "toolCallId": call_id, "toolCallName": SEARCH_TOOL})
    yield _sse(
        {"type": "TOOL_CALL_ARGS", "toolCallId": call_id, "delta": json.dumps({"query": question})}
    )
    yield _sse({"type": "TOOL_CALL_END", "toolCallId": call_id})
    # "unanswerable" in a question stands in for "no passage supports it".
    declined = "unanswerable" in question.lower()
    passages = [] if declined else _closest_passage(question)
    result = {"passages": passages, "declined": declined}
    yield _sse({"type": "TOOL_CALL_RESULT", "toolCallId": call_id, "content": json.dumps(result)})

    # 2. The answer, word by word, so the screen's streaming can be seen working.
    message_id = str(uuid.uuid4())
    yield _sse({"type": "TEXT_MESSAGE_START", "messageId": message_id, "role": "assistant"})
    for word in _answer_text(declined, passages, context).split(" "):
        time.sleep(WORD_DELAY_SECONDS)
        yield _sse({"type": "TEXT_MESSAGE_CONTENT", "messageId": message_id, "delta": word + " "})
    yield _sse({"type": "TEXT_MESSAGE_END", "messageId": message_id})

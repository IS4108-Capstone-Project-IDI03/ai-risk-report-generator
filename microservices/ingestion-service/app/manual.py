"""A standard entered clause by clause (IN-18): one clause in, its passages out.

The gateway keeps each clause in `manual_sections` (the source of truth) and sends it here
when it is saved. Each save replaces that clause's passages and nothing else, so it is
one small embedding call and runs inside the request.

A clause becomes one passage, or several when its text is over the chunker's token
limit, split at paragraphs as typed. Passage ids are `<doc>:<seq>` and
`<doc>:<seq>:part<n>`: `seq` is the clause's fixed number, so moving a clause in the
list never changes its ids, and reports that cite it still find it. Labels come from
the document (`worker.labels`), so a draft's passages stay out of search.
"""

from functools import lru_cache

from app import matching, worker
from app.pipeline.chunker import CHUNK_TOKENIZER_MODEL, MAX_CHUNK_TOKENS
from app.pipeline.indexer import get_all, index_chunks, storable

# Manual passages have no template section (IN-05): standards never do.
SECTION = "Not applicable"


@lru_cache(maxsize=1)
def _tokenizer():
    """The chunker's tokenizer, so a typed clause splits where a PDF's would."""
    from docling_core.transforms.chunker.tokenizer.huggingface import HuggingFaceTokenizer

    return HuggingFaceTokenizer.from_pretrained(CHUNK_TOKENIZER_MODEL, max_tokens=MAX_CHUNK_TOKENS)


def count_tokens(text: str) -> int:
    return _tokenizer().count_tokens(text)


def _paragraphs(text: str) -> list[str]:
    """The clause's paragraphs: blank-line separated, else one per line."""
    text = text.replace("\r\n", "\n").strip()
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    return (
        blocks if len(blocks) > 1 else [line.strip() for line in text.split("\n") if line.strip()]
    )


def _words(paragraph: str, limit: int) -> list[str]:
    """A paragraph over the limit on its own, cut between words (last resort)."""
    parts, current = [], ""
    for word in paragraph.split():
        candidate = f"{current} {word}" if current else word
        if current and count_tokens(candidate) > limit:
            parts.append(current)
            current = word
        else:
            current = candidate
    return parts + [current] if current else parts


def split(text: str, headings: list[str]) -> list[str]:
    """The clause's text as passages of at most MAX_CHUNK_TOKENS, heading trail included."""
    trail = " > ".join(headings)
    limit = MAX_CHUNK_TOKENS - (count_tokens(trail) if trail else 0)
    if count_tokens(text) <= limit:
        return [text.strip()]
    parts, current = [], ""
    for paragraph in _paragraphs(text):
        pieces = [paragraph] if count_tokens(paragraph) <= limit else _words(paragraph, limit)
        for piece in pieces:
            candidate = f"{current}\n\n{piece}" if current else piece
            if current and count_tokens(candidate) > limit:
                parts.append(current)
                current = piece
            else:
                current = candidate
    return parts + [current] if current else parts


def passages(doc: dict, section: dict) -> list[dict]:
    """The clause's passages, ready for `index_chunks`."""
    doc_id = str(doc["_id"])
    texts = split(section["text"], section["headings"])
    metadata = {
        **worker.labels(doc),
        "section": SECTION,
        "doc_id": doc_id,
        "entry_method": "manual",
        "section_id": section["section_id"],
        "seq": section["seq"],
        "order": section["order"],
        "clause": section["clause"],
    }
    if section["headings"]:
        metadata["headings"] = section["headings"]
    images = section.get("images") or []
    if images:
        metadata["image_keys"] = [image["key"] for image in images]
        # What the passage was read from (IN-17 lists it by type), with no region:
        # a screenshot has no page or box to draw (rag draws one only with region_bbox).
        metadata["region_kind"] = images[0]["kind"]
    base = f"{doc_id}:{section['seq']}"
    if len(texts) == 1:
        return [{"id": base, "text": texts[0], "metadata": metadata}]
    return [
        {"id": f"{base}:part{n}", "text": text, "metadata": metadata}
        for n, text in enumerate(texts, start=1)
    ]


def _section_ids(collection, doc_id: str, section_id: str) -> list[str]:
    where = {"$and": [{"doc_id": doc_id}, {"section_id": section_id}]}
    return get_all(collection, where=where, include=[])["ids"]


def save(doc: dict, section: dict) -> int:
    """Index the clause, then remove any of its old passages it no longer has; returns how many.

    The new passages go in first, so a failed embedding leaves the clause's old passages
    searchable rather than none.
    """
    chunks = passages(doc, section)
    count = index_chunks(chunks)
    # The ids written: index_chunks cuts a passage too big to store into `:partN`.
    written = {chunk["id"] for chunk in storable(chunks)}
    collection = matching.passages_collection()
    stale = set(_section_ids(collection, str(doc["_id"]), section["section_id"])) - written
    if stale:
        collection.delete(ids=sorted(stale))
    return count


def delete(doc_id: str, section_id: str) -> int:
    """Delete the clause's passages; returns how many."""
    collection = matching.passages_collection()
    if collection is None:
        return 0
    ids = _section_ids(collection, doc_id, section_id)
    if ids:
        collection.delete(ids=ids)
    return len(ids)

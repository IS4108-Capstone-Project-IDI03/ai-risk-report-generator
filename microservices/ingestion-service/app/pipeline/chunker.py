"""Stage 2: chunk the parsed document into index-ready dicts.

Runs Docling's `HybridChunker` (token-aware, heading-carrying) over the parsed
`DoclingDocument` and maps each Docling chunk to the dict shape `index_chunks`
expects: ``{"id", "text", "metadata"}``.

Docling chunk metadata is mapped as:
- ``meta.headings``            -> ``section_path`` (heading trail)
- ``meta.doc_items[].prov[].page_no`` -> ``page_start`` / ``page_end``

Chroma metadata values must be scalars (str/int/float/bool), so the list-valued
heading trail is serialised here: ``section_path`` becomes a single
" > "-joined string. ``page_start`` / ``page_end`` are ints (present only when
page provenance is known) so callers can filter/cite by page. ``doc_id`` is the
foreign key back to the source document.

Chunk sizing: the HybridChunker is token-aware and needs a tokenizer + a token
ceiling to decide chunk boundaries. Without configuration it defaults to a
512-token model that is unrelated to our embedder and triggers overflow
warnings on long chunks. We embed with Cohere ``embed-v4.0`` (128k-token limit),
so 512 is far too small. We give the chunker an explicit tokenizer (used only to
*count* tokens) and a deliberate ceiling, ``MAX_CHUNK_TOKENS``. Keep chunks well
under the embedder limit for retrieval precision — a single vector over a huge
span can't point at a specific source location (the IN-02 goal). Adjust
``MAX_CHUNK_TOKENS`` (and ``CHUNK_TOKENIZER_MODEL`` if desired) below.
"""

from functools import lru_cache

from app.pipeline.parser import ParsedDocument

_SECTION_SEPARATOR = " > "

# --- chunk sizing (adjust these) ----------------------------------------------
# Max tokens per chunk. Well within Cohere embed-v4.0's 128k limit; sized for
# focused, citable chunks rather than maximal size. Raise for larger chunks.
MAX_CHUNK_TOKENS = 1024
# Tokenizer used only to COUNT tokens for boundary decisions (not for embedding).
# Uses a long-context tokenizer so its own model max doesn't cap us below
# MAX_CHUNK_TOKENS. Any HF tokenizer works; this does not change the embedder.
CHUNK_TOKENIZER_MODEL = "BAAI/bge-m3"


def _pages_of(meta) -> list[int]:
    """Sorted unique page numbers referenced by a Docling chunk's items."""
    pages: set[int] = set()
    for item in getattr(meta, "doc_items", None) or []:
        for prov in getattr(item, "prov", None) or []:
            page_no = getattr(prov, "page_no", None)
            if page_no is not None:
                pages.add(page_no)
    return sorted(pages)


def _build_metadata(meta, doc_id: str) -> dict:
    headings = list(getattr(meta, "headings", None) or [])
    pages = _pages_of(meta)
    page_start = pages[0] if pages else None
    page_end = pages[-1] if pages else None

    metadata: dict = {
        "doc_id": doc_id,  # foreign key back to the source document
        # Chroma requires scalar values: serialise the list-valued heading trail.
        "section_path": _SECTION_SEPARATOR.join(headings),
    }
    if page_start is not None:
        metadata["page_start"] = page_start
        metadata["page_end"] = page_end
    return metadata


@lru_cache(maxsize=1)
def _chunker():
    """Build (once) a HybridChunker with an explicit tokenizer + token ceiling.

    The tokenizer only counts tokens for boundary decisions; embedding is still
    done by Cohere downstream. Cached so the tokenizer loads a single time per
    process. Imported lazily so importing this module doesn't pull Docling's
    heavy deps until chunking is actually used.
    """
    from docling.chunking import HybridChunker
    from docling_core.transforms.chunker.tokenizer.huggingface import (
        HuggingFaceTokenizer,
    )

    tokenizer = HuggingFaceTokenizer.from_pretrained(
        CHUNK_TOKENIZER_MODEL, max_tokens=MAX_CHUNK_TOKENS
    )
    return HybridChunker(tokenizer=tokenizer)


def chunk(parsed: ParsedDocument, doc_id: str | None = None) -> list[dict]:
    """Chunk a parsed document into index-ready chunk dicts.

    Args:
        parsed: result of `parser.parse`, carrying the `DoclingDocument`.
        doc_id: stable identifier for the source document; defaults to the
            document name. Used to build unique chunk ids (``f"{doc_id}:{n}"``).

    Returns:
        A list of ``{"id", "text", "metadata"}`` dicts ready for `index_chunks`.
        Empty if the document produced no chunks.
    """
    doc = parsed.docling_document
    if doc is None:
        return []

    resolved_doc_id = doc_id or parsed.doc_name

    chunker = _chunker()

    chunks: list[dict] = []
    for n, dl_chunk in enumerate(chunker.chunk(dl_doc=doc)):
        text = (dl_chunk.text or "").strip()
        if not text:
            continue
        chunks.append(
            {
                "id": f"{resolved_doc_id}:{n}",
                "text": text,
                "metadata": _build_metadata(dl_chunk.meta, resolved_doc_id),
            }
        )
    return chunks

"""Redact a past report's client details in its PDF before parsing (PV-05).

Parsing, chunking, the OCR crops (rendered from the PDF's pages), embedding and storage then all
read tags ("[PERSON_1]") instead of the details. The original stays in S3, unchanged.

Each page's words are read with their boxes and sent to privacy-service's /mask in one call for
the whole document, which says where each detail sits. The words a detail covers are removed,
and its tag is written in their place at the text's own size and baseline, squeezed to the gap:
a tag is often wider than the name it replaces, and smaller text would leave the line, so a
reader sorting by position would move it.
"""

import pymupdf

from app.privacy import Session

FONT = "helv"


def redact_pdf(pdf: bytes, protection: Session) -> tuple[bytes, dict[str, str]]:
    """The PDF with each client detail replaced by its tag, and tag -> the detail it replaced."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        pages = [_page_text(page, protection.escape) for page in doc]
        spans = protection.mask_spans([text for text, _ in pages])
        for page, (_, words), found in zip(doc, pages, spans):
            _redact(page, words, found + _rewritten(words, found))
        # A literal goes in the mapping too, so putting the words back restores it as written.
        return doc.tobytes(garbage=3, deflate=True), {**protection.mapping, **protection.literals}


def _page_text(page, escape) -> tuple[str, list[tuple[int, int, tuple, str]]]:
    """The page's text, a space between words and a line break between lines, and each word's
    (start, end, word, written) in it. `word` is PyMuPDF's (x0, y0, x1, y1, text, block, line,
    n); `written` is its text with anything shaped like a tag escaped (Rule 6). Escaped word by
    word, so the offsets /mask returns still match the words."""
    text, words, line = "", [], None
    for word in page.get_text("words"):
        if line is not None:
            text += " " if word[5:7] == line else "\n"
        line = word[5:7]
        written = escape(word[4])
        words.append((len(text), len(text) + len(written), word, written))
        text += written
    return text, words


def _rewritten(words: list[tuple[int, int, tuple, str]], found: list[dict]) -> list[dict]:
    """A span for each escaped word no detail covers, so it is written back as [LITERAL_n]."""
    return [
        {"start": start, "end": end, "placeholder": written}
        for start, end, word, written in words
        if written != word[4] and not any(f["start"] < end and start < f["end"] for f in found)
    ]


def _redact(page, words: list[tuple[int, int, tuple, str]], found: list[dict]) -> None:
    tags = []
    for span in found:
        # One box per line the detail covers: a box around both lines of a name broken across
        # them would take every word between. The tag goes where the detail starts.
        lines: dict[tuple, pymupdf.Rect] = {}
        covered = [w for w in words if w[0] < span["end"] and span["start"] < w[1]]
        for _, _, word, _ in covered:
            lines[word[5:7]] = lines.get(word[5:7], pymupdf.Rect()) | pymupdf.Rect(word[:4])
        boxes = list(lines.values())
        # Whole words are removed, so what the detail doesn't cover is written back with its
        # tag: titles and possessives stay outside it ("Mr [PERSON_1]'s").
        (first, _, _, first_text), (last, _, _, last_text) = covered[0], covered[-1]
        tag = (
            first_text[: max(0, span["start"] - first)]
            + span["placeholder"]
            + last_text[span["end"] - last :]
        )
        tags.append((boxes[0], tag, _font_at(page, boxes[0])))
        for box in boxes:
            page.add_redact_annot(box)
    # Pictures and drawings stay: a picture's faces are PV-06's.
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE
    )
    for rect, tag, (size, baseline) in tags:
        _write(page, rect, tag, size, baseline)


def _font_at(page, rect: pymupdf.Rect) -> tuple[float, float]:
    """The size and baseline of the text in `rect` (made from words there), read before it is
    removed."""
    span = next(
        span
        for block in page.get_text("dict", clip=rect)["blocks"]
        for line in block.get("lines", [])
        for span in line["spans"]
    )
    return span["size"], span["origin"][1]


def _write(page, rect: pymupdf.Rect, tag: str, size: float, baseline: float) -> None:
    """`tag` at the text's own size and baseline, squeezed to fit where the words were."""
    squeeze = min(1.0, 0.95 * rect.width / pymupdf.get_text_length(tag, FONT, size))
    origin = pymupdf.Point(rect.x0, baseline)
    page.insert_text(
        origin, tag, fontname=FONT, fontsize=size, morph=(origin, pymupdf.Matrix(squeeze, 1))
    )

"""Redact a past report's client details in its PDF before parsing (PV-05).

Parsing, chunking, the OCR crops (rendered from the PDF's pages), embedding and storage then all
read tags ("[PERSON_1]") instead of the details. The original stays in S3, unchanged.

Each page's text is read as PyMuPDF's spans (runs of one font), in the order they are drawn, and
the whole document goes to privacy-service's /mask in one call, which says where each detail
sits. On a page with a detail, all text is removed and every span is drawn again, in its order,
at its place and size, with each tag where its detail was. Docling orders a paragraph's text as
it is drawn, so a tag drawn after the rest of the page would be read at the paragraph's end.
The spans are drawn in Liberation Sans (or a CJK font where needed), squeezed to their old width;
pictures and drawings are left as they are. LibreOffice converts Word reports in Liberation Sans,
so a redrawn page looks as it did: redrawn in Helvetica, Docling's layout model read a cover
page's lines as pictures and dropped their text.

A scanned page has no text layer (PV-06). It is read with RapidOCR, the engine Docling reads it
with too, which gives each word and its box; its text joins the same /mask call. Each detail's
words are blanked in the page image itself, not only covered, and its tag is drawn in their
place, so Docling's OCR reads the tag.
"""

from functools import cache
from pathlib import Path

import numpy as np
import pymupdf
from rapidocr import RapidOCR

from app.privacy import Session

# Liberation Sans by weight and slant (SIL OFL 1.1, see fonts/LICENSE), and a CJK font for text it
# cannot draw. Its subset embedded in a report has no character map, so it cannot be reused.
_FONT_DIR = Path(__file__).parent / "fonts"
_FONTS = {
    (False, False): "Regular",
    (True, False): "Bold",
    (False, True): "Italic",
    (True, True): "BoldItalic",
}
_CJK = "china-s"
_BOLD, _ITALIC = 16, 2  # PyMuPDF span flags
# A scanned page is read at this resolution: 72 is too coarse for 10 pt text.
_SCAN_DPI = 200
# A scanned word's blanked box grows by this share of its height on every side.
_SCAN_PADDING = 0.15


def redact_pdf(pdf: bytes, protection: Session) -> tuple[bytes, dict[str, str]]:
    """The PDF with each client detail replaced by its tag, and tag -> the detail it replaced."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        pages = [_page_text(page, protection.escape) for page in doc]
        scanned = [
            not text.strip() and bool(page.get_images()) for page, (text, _) in zip(doc, pages)
        ]
        pages = [
            _scan_text(page, protection.escape) if scan else read
            for page, read, scan in zip(doc, pages, scanned)
        ]
        found = protection.mask_spans([text for text, _ in pages])
        for page, (_, pieces), details, scan in zip(doc, pages, found, scanned):
            written = _with_tags(pieces, details)
            if scan:
                _blank(page, pieces, written)
            elif any(new != piece["span"]["text"] for piece, new in zip(pieces, written)):
                _redraw(page, pieces, written)
        # A literal goes in the mapping too, so putting the words back restores it as written.
        return doc.tobytes(garbage=3, deflate=True), {**protection.mapping, **protection.literals}


def _page_text(page, escape) -> tuple[str, list[dict]]:
    """The page's text as /mask reads it, and its spans in drawing order, each with where its
    text sits in that text (`start`, `end`) and that text (`text`). A span's text is escaped
    (Rule 6), so the offsets /mask returns match what is drawn again."""
    text, pieces = "", []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            if text and not text.endswith("\n"):
                text += "\n"
            before = None
            for span in line["spans"]:
                # A line's spans meet without a space where a word changes font, or is drawn in
                # two runs ("Sprinkl" + "er"). Only a visible gap between them is a space.
                if before and _gap(before, span) and not (text[-1:] + span["text"][:1]).isspace():
                    text += " "
                before = span
                written = escape(span["text"])
                pieces.append({"span": span, "start": len(text), "text": written})
                text += written
                pieces[-1]["end"] = len(text)
    return text, pieces


@cache
def _reader() -> RapidOCR:
    """Built once: loading its models takes seconds."""
    return RapidOCR()


def _scan_text(page, escape) -> tuple[str, list[dict]]:
    """A scanned page's text as RapidOCR reads it, a line per line, and its words, each with
    its box on the page (`rect`), its line (`line`), and where its text sits in that text."""
    image = page.get_pixmap(dpi=_SCAN_DPI)
    pixels = np.frombuffer(image.samples, np.uint8).reshape(image.height, image.width, image.n)
    lines = _reader()(pixels, return_word_box=True).word_results or ()
    scale = 72 / _SCAN_DPI
    text, pieces = "", []
    for number, line in enumerate(lines):
        if text:
            text += "\n"
        for n, (word, _score, corners) in enumerate(line):
            if n:
                text += " "
            xs, ys = [x for x, _ in corners], [y for _, y in corners]
            rect = pymupdf.Rect(min(xs), min(ys), max(xs), max(ys)) * scale
            written = escape(word)
            pieces.append({"rect": rect, "line": number, "start": len(text), "text": written})
            text += written
            pieces[-1]["end"] = len(text)
    return text, pieces


def _blank(page, pieces: list[dict], written: list[str]) -> None:
    """Blank each changed word of a scanned page in its image, and draw its new text (a tag)
    over the words it replaced: a name's words on one line share one box."""
    boxes: list[tuple[int, pymupdf.Rect, list[str]]] = []
    previous = None
    for n, (piece, text) in enumerate(zip(pieces, written)):
        if text == piece["text"]:
            continue
        if boxes and previous == n - 1 and boxes[-1][0] == piece["line"]:
            boxes[-1][1].include_rect(piece["rect"])
            boxes[-1][2].append(text)
        else:
            boxes.append((piece["line"], pymupdf.Rect(piece["rect"]), [text]))
        previous = n
    if not boxes:
        return
    kept = [piece["rect"] for piece, text in zip(pieces, written) if text == piece["text"]]
    for _, box, _ in boxes:
        page.add_redact_annot(_padded(box, kept), fill=(1, 1, 1))
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_PIXELS, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE
    )
    for _, box, texts in boxes:
        text = " ".join(t for t in texts if t)
        if text:
            _draw_in(page, box, text)


def _padded(box: pymupdf.Rect, kept: list[pymupdf.Rect]) -> pymupdf.Rect:
    """`box` grown on every side, but never into a word that stays: OCR boxes sit tight on the
    letters, and left slivers of them, while in small text set tight the padding reached the
    line above ("porch" read as "norch")."""
    pad = box.height * _SCAN_PADDING
    padded = box + (-pad, -pad, pad, pad)
    for word in kept:
        if not padded.intersects(word):
            continue
        if word.y1 <= box.y0 + box.height / 2:  # above the box
            padded.y0 = min(box.y0, max(padded.y0, word.y1))
        elif word.y0 >= box.y1 - box.height / 2:  # below it
            padded.y1 = max(box.y1, min(padded.y1, word.y0))
        elif word.x1 <= box.x0 + 1:  # before it, on its line
            padded.x0 = min(box.x0, max(padded.x0, word.x1))
        elif word.x0 >= box.x1 - 1:  # after it
            padded.x1 = max(box.x1, min(padded.x1, word.x0))
    return padded


def _draw_in(page, box: pymupdf.Rect, text: str) -> None:
    """`text` in black across `box`, as tall as its words, squeezed to its width."""
    size = box.height * 0.8
    width = _font("Regular").text_length(text, fontsize=size)
    squeeze = min(1.0, box.width / width) if width else 1.0
    origin = pymupdf.Point(box.x0, box.y1 - box.height * 0.2)
    page.insert_text(
        origin,
        text,
        fontname="LiberationRegular",
        fontfile=_file("Regular"),
        fontsize=size,
        morph=(origin, pymupdf.Matrix(squeeze, 1)),
    )


def _gap(before: dict, span: dict) -> bool:
    """Whether a visible gap, a fifth of the text's size or more, separates two spans."""
    return span["bbox"][0] - before["bbox"][2] >= 0.2 * span["size"]


def _with_tags(pieces: list[dict], details: list[dict]) -> list[str]:
    """Each span's text with its details replaced: a detail's tag goes in the span it starts in,
    and its text in any later span (the rest of a name broken across lines) is removed. Titles
    and possessives stay outside the tag ("Mr [PERSON_1]'s")."""
    edits: list[list[tuple[int, int, str]]] = [[] for _ in pieces]
    for detail in details:
        tagged = False
        for n, piece in enumerate(pieces):
            start = max(detail["start"], piece["start"])
            end = min(detail["end"], piece["end"])
            if start >= end:
                continue
            tag = "" if tagged else detail["placeholder"]
            edits[n].append((start - piece["start"], end - piece["start"], tag))
            tagged = True
    written = []
    for piece, piece_edits in zip(pieces, edits):
        text = piece["text"]
        for start, end, tag in sorted(piece_edits, reverse=True):
            text = text[:start] + tag + text[end:]
        written.append(text)
    return written


def _redraw(page, pieces: list[dict], written: list[str]) -> None:
    """Remove the page's text and draw every span again, in order, with its new text."""
    # One box over the whole page: all its text goes, and one box is far quicker than one per span.
    page.add_redact_annot(page.rect)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE, graphics=pymupdf.PDF_REDACT_LINE_ART_NONE
    )
    for piece, text in zip(pieces, written):
        if text.strip():
            _draw(page, piece["span"], text)


def _file(style: str) -> str:
    return str(_FONT_DIR / f"LiberationSans-{style}.ttf")


@cache
def _font(style: str) -> pymupdf.Font:
    """Built once: building a Font per span was most of the redaction's time."""
    return pymupdf.Font(_CJK) if style == _CJK else pymupdf.Font(fontfile=_file(style))


@cache
def _draws(style: str) -> frozenset[int]:
    """The characters a Liberation Sans style can draw: curly quotes and dashes included."""
    return frozenset(_font(style).valid_codepoints())


def _draw(page, span: dict, text: str) -> None:
    """`text` at the span's place, size and colour, squeezed to fit its old width."""
    flags = span["flags"]
    style = _FONTS[(bool(flags & _BOLD), bool(flags & _ITALIC))]
    if not {ord(c) for c in text} <= _draws(style):
        style = _CJK
    width = _font(style).text_length(text, fontsize=span["size"])
    box = pymupdf.Rect(span["bbox"])
    squeeze = min(1.0, box.width / width) if width else 1.0
    origin = pymupdf.Point(span["origin"])
    font = (
        {"fontname": _CJK}
        if style == _CJK
        else {"fontname": f"Liberation{style}", "fontfile": _file(style)}
    )
    page.insert_text(
        origin,
        text,
        **font,
        fontsize=span["size"],
        color=pymupdf.sRGB_to_pdf(span["color"]),
        morph=(origin, pymupdf.Matrix(squeeze, 1)),
    )

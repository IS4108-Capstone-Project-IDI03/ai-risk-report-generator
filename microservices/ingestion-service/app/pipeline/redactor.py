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
"""

from functools import cache
from pathlib import Path

import pymupdf

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


def redact_pdf(pdf: bytes, protection: Session) -> tuple[bytes, dict[str, str]]:
    """The PDF with each client detail replaced by its tag, and tag -> the detail it replaced."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        pages = [_page_text(page, protection.escape) for page in doc]
        found = protection.mask_spans([text for text, _ in pages])
        for page, (_, pieces), details in zip(doc, pages, found):
            written = _with_tags(pieces, details)
            if any(new != piece["span"]["text"] for piece, new in zip(pieces, written)):
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

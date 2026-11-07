"""PV-05: a past report's client details are redacted in its PDF before parsing, so parsing,
the OCR crops, embedding and storage all read tags. privacy-service is faked (`fake_privacy`);
PDFs are built with pymupdf and read back as text."""

from functools import cache
from pathlib import Path

import httpx
import numpy as np
import pymupdf
import pytest
from rapidocr import RapidOCR

from app.pipeline import redactor
from app.pipeline.redactor import redact_pdf
from app.privacy import PrivacyUnavailable, session

PRIVACY = {
    "enabled": True,
    "known_entities": [
        {"type": "PERSON", "names": ["John Tan"]},
        {"type": "PERSON", "names": ["Mary Lim"]},
        {"type": "CLIENT", "names": ["Acme Pte Ltd"]},
    ],
}


def pdf_of(*pages: list[str]) -> bytes:
    """A PDF with one page per list, one line of text per string."""
    doc = pymupdf.open()
    for lines in pages:
        page = doc.new_page()
        for n, line in enumerate(lines):
            page.insert_text((50, 100 + 30 * n), line)
    return doc.tobytes()


def text_of(pdf: bytes) -> list[str]:
    """Each page's text in reading position, one space between words."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [" ".join(page.get_text(sort=True).split()) for page in doc]


def test_a_name_on_a_page_is_replaced_by_its_tag(fake_privacy):
    redacted, mapping = redact_pdf(pdf_of(["Inspected by John Tan on 3 May."]), session(PRIVACY))

    assert text_of(redacted) == ["Inspected by [PERSON_1] on 3 May."]
    assert mapping == {"[PERSON_1]": "John Tan"}


def test_one_mask_call_numbers_the_whole_document_in_reading_order(fake_privacy):
    # A guard, passing when first run: the first test's code already sends every page at once.
    pdf = pdf_of(["Mary Lim met us."], ["John Tan showed the riser."], ["John Tan signed off."])

    redacted, mapping = redact_pdf(pdf, session(PRIVACY))

    assert text_of(redacted) == [
        "[PERSON_1] met us.",
        "[PERSON_2] showed the riser.",
        "[PERSON_2] signed off.",
    ]
    assert mapping == {"[PERSON_1]": "Mary Lim", "[PERSON_2]": "John Tan"}
    assert len(fake_privacy.requests) == 1  # one mapping covers the document (Rule 2)


def test_a_name_broken_across_two_lines_is_removed_without_its_neighbours(fake_privacy):
    pdf = pdf_of(["The riser was shown by John", "Tan on 3 May."])

    redacted, mapping = redact_pdf(pdf, session(PRIVACY))

    assert text_of(redacted) == ["The riser was shown by [PERSON_1] on 3 May."]
    assert mapping == {"[PERSON_1]": "John Tan"}


def test_titles_and_possessives_stay_outside_the_tag(fake_privacy):
    # privacy-service matches "Tan" alone as John Tan's surname; the fake needs it listed.
    tan = {"enabled": True, "known_entities": [{"type": "PERSON", "names": ["John Tan", "Tan"]}]}

    redacted, _ = redact_pdf(pdf_of(["Mr Tan's pump was serviced."]), session(tan))

    assert text_of(redacted) == ["Mr [PERSON_1]'s pump was serviced."]


def test_a_long_tag_over_a_short_name_stays_in_its_place(fake_privacy):
    # A guard, passing when first run: the tag is squeezed to the name's width at the line's own
    # size. Written smaller, it left the line and readers sorting by position moved it.
    li = {"enabled": True, "known_entities": [{"type": "PERSON", "names": ["Li"]}]}

    redacted, _ = redact_pdf(pdf_of(["Ask Li about the pump, then Li again."]), session(li))

    assert text_of(redacted) == ["Ask [PERSON_1] about the pump, then [PERSON_1] again."]


def picture_bytes(pdf: bytes) -> list[bytes]:
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [doc.extract_image(image[0])["image"] for image in doc[0].get_images()]


def test_a_picture_under_a_redacted_name_keeps_its_pixels(fake_privacy):
    # A guard, passing when first run: PyMuPDF would blank the part under the name by default.
    # A picture's faces are PV-06's; its pixels must reach the OCR crops as they are.
    doc = pymupdf.open()
    page = doc.new_page()
    pixels = pymupdf.Pixmap(pymupdf.csRGB, pymupdf.IRect(0, 0, 40, 20), False)
    pixels.set_rect(pixels.irect, (200, 120, 40))
    page.insert_image(pymupdf.Rect(40, 80, 240, 120), pixmap=pixels)
    page.insert_text((50, 100), "Photo by John Tan")
    pdf = doc.tobytes()

    redacted, _ = redact_pdf(pdf, session(PRIVACY))

    assert text_of(redacted) == ["Photo by [PERSON_1]"]
    assert picture_bytes(redacted) == picture_bytes(pdf)


def test_text_already_shaped_like_a_tag_is_not_read_as_one(fake_privacy):
    # Rule 6: without this, putting the real words back would turn the literal into John Tan.
    pdf = pdf_of(["Template field [PERSON_1], signed by John Tan."])

    redacted, mapping = redact_pdf(pdf, session(PRIVACY))

    assert text_of(redacted) == ["Template field [LITERAL_1], signed by [PERSON_1]."]
    assert mapping == {"[PERSON_1]": "John Tan", "[LITERAL_1]": "[PERSON_1]"}


@pytest.mark.parametrize(
    "failure", [httpx.ConnectError("refused"), httpx.ReadTimeout("slow"), 500], ids=str
)
def test_when_the_privacy_service_fails_nothing_is_redacted_or_sent(fake_privacy, failure):
    # Fail closed (Rule 3): the document fails rather than going on with its details.
    fake_privacy.failure = failure

    with pytest.raises(PrivacyUnavailable) as raised:
        redact_pdf(pdf_of(["Inspected by John Tan on 3 May."]), session(PRIVACY))

    assert "John Tan" not in str(raised.value)  # no value from the document (Rule 5)


def stream_text_of(pdf: bytes) -> list[str]:
    """Each page's text in drawing order, as Docling reads a paragraph, not by position."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [" ".join(page.get_text().split()) for page in doc]


def test_tags_sit_in_place_in_drawing_order_as_docling_reads(fake_privacy):
    # Docling orders a paragraph's text as it is drawn. A tag drawn after the page's other text
    # was read at the paragraph's end, away from the sentence it belongs in.
    pdf = pdf_of(["Acme Pte Ltd fire survey", "Shown by John Tan (Tel: +65 9123 4567).", "End."])

    redacted, _ = redact_pdf(pdf, session(PRIVACY))

    assert stream_text_of(redacted) == [
        "[CLIENT_1] fire survey Shown by [PERSON_1] (Tel: [PHONE_1]). End."
    ]


def test_a_redrawn_page_keeps_its_headings_bold_and_any_script_readable(fake_privacy):
    # A guard: written with the redraw. Docling finds headings partly by weight, and a report
    # may hold names in Chinese, which Liberation Sans cannot draw.
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 80), "Fire Survey", fontname="hebo", fontsize=14)
    page.insert_text((50, 110), "Shown by John Tan.")
    page.insert_text((50, 140), "业主 陈先生", fontname="china-s")
    redacted, _ = redact_pdf(doc.tobytes(), session(PRIVACY))

    with pymupdf.open(stream=redacted, filetype="pdf") as out:
        spans = [
            s
            for b in out[0].get_text("dict")["blocks"]
            for line in b.get("lines", [])
            for s in line["spans"]
        ]
    heading = next(s for s in spans if s["text"].strip() == "Fire Survey")
    assert heading["flags"] & 16  # bold
    assert stream_text_of(redacted) == ["Fire Survey Shown by [PERSON_1]. 业主 陈先生"]


LIBERATION = Path(redactor.__file__).parent / "fonts" / "LiberationSans-{}.ttf"


def spans_of(pdf: bytes, page: int = 0) -> list[dict]:
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [
            s
            for b in doc[page].get_text("dict")["blocks"]
            for line in b.get("lines", [])
            for s in line["spans"]
            if s["text"].strip()
        ]


def test_a_redrawn_page_keeps_the_report_font_quotes_and_dashes_included(fake_privacy):
    # LibreOffice converts Word reports in Liberation Sans. Redrawn in Helvetica, Docling's
    # layout model read a cover page's lines as pictures and dropped them; and a line with a
    # curly quote or a dash went to the CJK font, which pdfium draws letter-spaced off the page.
    doc = pymupdf.open()
    page = doc.new_page()
    for n, (line, weight) in enumerate(
        [
            ("Fire Survey", "Bold"),
            ("Shown by John Tan.", "Regular"),
            ("Tan’s pump – room 2", "Regular"),
        ]
    ):
        font = f"lib{weight}"
        page.insert_text(
            (50, 80 + 30 * n), line, fontname=font, fontfile=str(LIBERATION).format(weight)
        )
    tan = {"enabled": True, "known_entities": [{"type": "PERSON", "names": ["John Tan", "Tan"]}]}

    redacted, _ = redact_pdf(doc.tobytes(), session(tan))

    assert [(s["text"].strip(), s["font"]) for s in spans_of(redacted)] == [
        ("Fire Survey", "LiberationSans-Bold"),
        ("Shown by [PERSON_1].", "LiberationSans"),
        ("[PERSON_1]’s pump – room 2", "LiberationSans"),
    ]


def test_a_word_drawn_in_two_pieces_reaches_mask_as_one_word(fake_privacy):
    # A PDF may draw one word as two runs with no gap ("Sprinkl" + "er"); reading a space into
    # it made the name model take "Sprinkl" for a person. Words split by a real gap stay apart.
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((50, 100), "Sprinkl", fontname="helv")
    joined = 50 + pymupdf.get_text_length("Sprinkl", "helv", 11)
    page.insert_text((joined, 100), "er", fontname="hebo")
    page.insert_text((150, 100), "Test", fontname="hebo")
    redact_pdf(doc.tobytes(), session(PRIVACY))

    assert fake_privacy.requests[0]["texts"][0].split() == ["Sprinkler", "Test"]


# --- PV-06: a scanned page (no text layer) is read with RapidOCR, and its details blanked.


def scanned_pdf_of(*pages: list[str], size: float = 14, spacing: float = 40) -> bytes:
    """A PDF whose pages are images of text only, as a scanner makes: no text layer. Lines
    are `spacing` points apart, in `size` point text."""
    doc = pymupdf.open()
    for lines in pages:
        with pymupdf.open() as source:
            typed = source.new_page()
            for n, line in enumerate(lines):
                typed.insert_text((50, 100 + spacing * n), line, fontsize=size)
            image = typed.get_pixmap(dpi=150)
        doc.new_page().insert_image(pymupdf.Rect(0, 0, 595, 842), pixmap=image)
    return doc.tobytes()


@cache
def _reader() -> RapidOCR:
    return RapidOCR()


def ocr_of(image: pymupdf.Pixmap) -> str:
    """What RapidOCR reads in `image`, one space between words."""
    pixels = np.frombuffer(image.samples, np.uint8).reshape(image.height, image.width, image.n)
    return " ".join(" ".join(_reader()(pixels).txts or ()).split())


def scanned_text_of(pdf: bytes) -> list[str]:
    """Each page as RapidOCR reads it when rendered."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [ocr_of(page.get_pixmap(dpi=200)) for page in doc]


def test_a_name_on_a_scanned_page_is_replaced_by_its_tag(fake_privacy):
    pdf = scanned_pdf_of(["Inspected by John Tan on 3 May."])

    redacted, mapping = redact_pdf(pdf, session(PRIVACY))

    [page] = scanned_text_of(redacted)
    assert "John" not in page and "Tan" not in page
    assert "PERSON_1" in page and page.startswith("Inspected by")
    assert mapping == {"[PERSON_1]": "John Tan"}


def test_a_name_on_a_scanned_page_is_gone_from_the_image_not_just_covered(fake_privacy):
    # A guard, passing when first run, and seen failing with the image left as it was
    # (PDF_REDACT_IMAGE_NONE): the white box alone hides the name, but its pixels stay.
    pdf = scanned_pdf_of(["Inspected by John Tan on 3 May."])

    redacted, _ = redact_pdf(pdf, session(PRIVACY))

    with pymupdf.open(stream=redacted, filetype="pdf") as doc:
        [(xref, *_)] = doc[0].get_images()
        image = pymupdf.Pixmap(doc, xref)
    assert "Inspected by" in ocr_of(image)
    assert "John" not in ocr_of(image)


def test_typed_and_scanned_pages_share_one_mask_call_and_one_numbering(fake_privacy):
    # A guard, passing when first run: scanned pages' text joins the document's one call.
    typed = pymupdf.open(stream=pdf_of(["Mary Lim met us."]), filetype="pdf")
    typed.insert_pdf(pymupdf.open(stream=scanned_pdf_of(["John Tan and Mary Lim"]), filetype="pdf"))

    redacted, mapping = redact_pdf(typed.tobytes(), session(PRIVACY))

    assert text_of(redacted)[0] == "[PERSON_1] met us."
    assert scanned_text_of(redacted)[1] == "[PERSON_2] and [PERSON_1]"
    assert mapping == {"[PERSON_1]": "Mary Lim", "[PERSON_2]": "John Tan"}
    assert len(fake_privacy.requests) == 1


def image_streams(pdf: bytes) -> list[bytes]:
    """Each page's image, decoded (saving may compress it)."""
    with pymupdf.open(stream=pdf, filetype="pdf") as doc:
        return [doc.xref_stream(xref) for page in doc for xref, *_ in page.get_images()]


def test_a_scanned_page_without_a_detail_keeps_its_image_as_it_was(fake_privacy):
    # A guard, passing when first run: only a page with a detail is blanked.
    pdf = scanned_pdf_of(["The pump room was dry."])

    redacted, mapping = redact_pdf(pdf, session(PRIVACY))

    assert image_streams(redacted) == image_streams(pdf)
    assert text_of(redacted) == [""]  # nothing drawn over it
    assert mapping == {}


def test_blanking_a_detail_in_small_tight_text_leaves_the_line_above_readable(fake_privacy):
    # Found on a real scan (a diagram's notes): the padded box reached into the line above.
    lines = ["Car porch can protrude", "John Tan into the road"]
    pdf = scanned_pdf_of(lines, size=12, spacing=14)
    assert scanned_text_of(pdf) == [" ".join(lines)]  # readable before

    redacted, _ = redact_pdf(pdf, session(PRIVACY))

    [page] = scanned_text_of(redacted)
    assert page.startswith("Car porch can protrude")
    assert "John" not in page and "Tan" not in page

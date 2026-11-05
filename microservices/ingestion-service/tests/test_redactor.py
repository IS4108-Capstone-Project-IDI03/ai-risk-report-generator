"""PV-05: a past report's client details are redacted in its PDF before parsing, so parsing,
the OCR crops, embedding and storage all read tags. privacy-service is faked (`fake_privacy`);
PDFs are built with pymupdf and read back as text."""

import httpx
import pymupdf
import pytest

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

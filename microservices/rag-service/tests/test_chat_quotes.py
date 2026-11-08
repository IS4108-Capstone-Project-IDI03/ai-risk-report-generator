# Tests for app/chat/quotes.py (CB-01 AC2): pulling Cite() calls out of the
# answer model's OpenUI Lang, and checking each quote against its passage.
import pytest

from app.chat.quotes import find_cites, quote_found
from app.generation.generator import quotable_text

PROGRAM = (
    "root = Answer([s1, t1])\n"
    's1 = Statement("Needs 0.20 gpm/ft².", [c1, c2])\n'
    'c1 = Cite("P1", "0.20 gpm/ft2 over 1500 ft2")\n'
    't1 = CitedTable(["Edition", "Density"], [[Cell("2019", [c2]), '
    'Cell("0.20", [Cite("P3", "inline \\"quoted\\" words")])]])\n'
    'c2 = Cite("P2", "another quote")\n'
)


@pytest.mark.parametrize(
    "program, expected",
    [
        ('c1 = Cite("P1", "a quote")', [("P1", "a quote")]),
        ('x = Cell("1", [Cite("P2", "inline")])', [("P2", "inline")]),
        ('c = Cite("P1", "say \\"hi\\"")', [("P1", 'say "hi"')]),
        ('c = Cite("P1", "back\\\\slash")', [("P1", "back\\slash")]),
        (
            'a = Cite("P1", "one")\nb = Cite("P1", "one")\nc = Cite("P2", "two")',
            [("P1", "one"), ("P1", "one"), ("P2", "two")],
        ),
        ('c = Cite("P1", "ok")\nd = Cite("P2", "cut off mid', [("P1", "ok")]),
        ('c = Cite("P1"', []),
        ("", []),
        (
            PROGRAM,
            [
                ("P1", "0.20 gpm/ft2 over 1500 ft2"),
                ("P3", 'inline "quoted" words'),
                ("P2", "another quote"),
            ],
        ),
    ],
)
def test_find_cites(program, expected):
    assert find_cites(program) == expected


@pytest.mark.parametrize(
    "quote, passage, expected",
    [
        ("over 1,500 ft2", "Density over 1,500 ft2 applies", True),  # exact
        ("OVER   1,500\nFT2", "density over 1,500 ft2 applies", True),  # case + whitespace
        ("0.20 gpm/ft2 over 1500 ft2", "0.20 gpm/ft2 over 1,500 ft2.", True),  # punctuation
        ("not in here", "Density over 1,500 ft2 applies", False),
        ("", "anything", False),
        ("   \n ", "anything", False),
    ],
)
def test_quote_found(quote, passage, expected):
    assert quote_found(quote, passage) is expected


def test_only_the_words_a_model_is_shown_are_quotable():
    # Guards, passing when first run: a quote is checked against the headings shown with the
    # passage and its text, never the document's name (the app's label) nor a heading too long
    # to be one, which the model is not shown (MAX_HEADING_CHARS).
    long = "The loss example ran for pages " + "and pages " * 30
    passage = {
        "text": "The pump is tested weekly.",
        "metadata": {"headings": ["Fire Pumps", long], "document_name": "NFPA 25 (2023)"},
    }

    shown = quotable_text(passage)

    assert quote_found("Fire Pumps", shown) and quote_found("tested weekly", shown)
    assert not quote_found("NFPA 25", shown)
    assert not quote_found("The loss example", shown)
    assert quotable_text({"text": "No metadata."}) == "No metadata."

"""Anonymiser contract (IN-02, Task 3) — written first (TDD).

For now the anonymiser is a positioned pass-through: it takes the parser's text
blocks and returns them unchanged. Real PII stripping/masking is future work.
These tests pin the pass-through contract so a later real implementation must
keep the same shape (list[TextBlock] in, equivalent text out) unless it is
deliberately changed.
"""

from app.pipeline.anonymiser import anonymise
from app.pipeline.parser import TextBlock


def _block(text: str, order: int) -> TextBlock:
    return TextBlock(text=text, section_path=["Doc", "Section"], page=order, order=order)


def test_returns_text_unchanged():
    blocks = [_block("hello world", 1), _block("second block", 2)]
    result = anonymise(blocks)
    assert [b.text for b in result] == ["hello world", "second block"]


def test_preserves_provenance_and_order():
    blocks = [_block("a", 1), _block("b", 2), _block("c", 3)]
    result = anonymise(blocks)
    assert [b.order for b in result] == [1, 2, 3]
    assert [b.page for b in result] == [1, 2, 3]
    assert all(b.section_path == ["Doc", "Section"] for b in result)


def test_does_not_mutate_input_blocks():
    original = _block("sensitive text", 1)
    before = original.text
    anonymise([original])
    # The input object's content must be untouched by a pass-through.
    assert original.text == before


def test_empty_input_returns_empty():
    assert anonymise([]) == []


def test_result_is_a_list():
    result = anonymise([_block("x", 1)])
    assert isinstance(result, list)

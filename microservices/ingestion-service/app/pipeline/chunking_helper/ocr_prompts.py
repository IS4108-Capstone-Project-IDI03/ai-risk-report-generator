"""What a table/formula OCR provider asks for, and how its answer becomes chunk text.

Shared by every API provider (`gemini_ocr`, `anthropic_ocr`) so they all send
the same instructions and produce the same "Heading: value; ..." records and
LaTeX that the GLM path produces.
"""

from typing import Literal

from pydantic import BaseModel

from app.pipeline.chunking_helper.ocr_model import table_to_records

TABLE_PROMPT = """This image is one table cropped from a fire-safety standard or \
engineering document. Transcribe it exactly as printed.

- rows: every row, top to bottom; each row lists its cells left to right. Repeat a merged \
cell's text in each cell it spans.
- Copy numbers, units and symbols character for character. Never round, correct, convert or \
infer a value. If a cell cannot be read, leave it as an empty string.
- header: "row" if the first row holds the column headings, "column" if the first column \
holds the row headings, "none" if there are no headings."""


FORMULA_PROMPT = """This image is cropped from a fire-safety standard or engineering \
document and contains one or more formulas, possibly with surrounding text.

- latex: the formulas as LaTeX, in reading order, with any surrounding text kept as plain text.
- Copy every symbol, subscript and constant exactly. Never simplify, rearrange or correct."""


class TableReading(BaseModel):
    rows: list[list[str]]
    header: Literal["row", "column", "none"]


class FormulaReading(BaseModel):
    latex: str


def _table_text(reading: TableReading) -> str:
    return table_to_records(reading.rows, header_hint=reading.header)


def _formula_text(reading: FormulaReading) -> str:
    return reading.latex


# task -> (prompt, answer schema, answer -> chunk text)
TASKS = {
    "table": (TABLE_PROMPT, TableReading, _table_text),
    "formula": (FORMULA_PROMPT, FormulaReading, _formula_text),
}

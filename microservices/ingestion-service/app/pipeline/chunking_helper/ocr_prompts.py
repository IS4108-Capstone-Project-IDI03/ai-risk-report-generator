"""What a table/formula OCR provider asks for, and how its answer becomes chunk text.

Shared by every API provider (`gemini_ocr`, `anthropic_ocr`) so they all send
the same instructions and produce the same "Heading: value; ..." records and
LaTeX that the GLM path produces.
"""

from pydantic import BaseModel

from app.pipeline.chunking_helper.table_text import TableText, flatten_table, render_tables

TABLE_PROMPT = """This image was cropped from a fire-safety standard or engineering \
document. It holds one table, or several tables one above another. Transcribe each table \
exactly as printed.

- tables: one entry per table, top to bottom. Never merge two tables into one.
- title: the table's printed title with its number, as printed (for example "Table 20.15.2.6 \
Hose Stream Allowance and Water Supply Duration"). Empty if the image shows none.
- rows: every row, top to bottom, headings included; each row lists its cells left to right. \
Repeat a merged cell's text in each cell it spans.
- header_rows: how many rows at the top are column headings; several if the headings are \
stacked or grouped (a spanning heading above sub-headings). 0 if there are none.
- header_cols: how many columns at the left are row headings (the label of each row). 0 if \
there are none. A table can have both.
- Copy numbers, units and symbols character for character. Never round, correct, convert or \
infer a value. If a cell cannot be read, leave it as an empty string."""


FORMULA_PROMPT = """This image is cropped from a fire-safety standard or engineering \
document and contains one or more formulas, possibly with surrounding text.

- latex: the formulas as LaTeX, in reading order, with any surrounding text kept as plain text.
- Copy every symbol, subscript and constant exactly. Never simplify, rearrange or correct."""


class TableBlock(BaseModel):
    title: str
    header_rows: int
    header_cols: int
    rows: list[list[str]]


class TableReading(BaseModel):
    tables: list[TableBlock]


class FormulaReading(BaseModel):
    latex: str


def _table_text(reading: TableReading) -> str:
    return render_tables(
        [
            TableText(
                title=table.title,
                records=flatten_table(table.rows, table.header_rows, table.header_cols),
            )
            for table in reading.tables
        ]
    )


def _formula_text(reading: FormulaReading) -> str:
    return reading.latex


# task -> (prompt, answer schema, answer -> chunk text)
TASKS = {
    "table": (TABLE_PROMPT, TableReading, _table_text),
    "formula": (FORMULA_PROMPT, FormulaReading, _formula_text),
}

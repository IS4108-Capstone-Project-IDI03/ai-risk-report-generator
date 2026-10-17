"""What a table/formula/picture OCR provider asks for, and how its answer becomes chunk text.

Shared by every API provider (`gemini_ocr`, `anthropic_ocr`) so they all send
the same instructions and produce the same "Heading: value; ..." records and
LaTeX that the GLM path produces. Pictures have no GLM equivalent: their
description is labelled in the text as generated.
"""

from typing import Literal

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


# Pictures follow speech-ocr-service's photo interpreter (`app/processors/vision.py`,
# CP-05): describe only what is visible, never invent a hazard, and use the context
# only to know where to look. Bump the version whenever the wording changes, so a
# passage names the prompt its description came from.
PICTURE_PROMPT_VERSION = "pic-v1"

PICTURE_PROMPT = """This image was cropped from a fire-safety standard, an engineering \
document or a property risk survey report. Describe it for a risk engineer who cannot see it.

- kind: photograph, diagram, chart, drawing, table or other.
- description: two to four sentences on what the image shows. For a photograph of a site, \
name the details that matter to property risk (damage, hazards, equipment and its condition, \
site conditions) only where they can be seen.
- visible_text: any text printed in the image, exactly as printed. If there is none, leave \
it as an empty string.

Describe only what is visible. If a detail cannot be made out, leave it out rather than guess. \
Say nothing about causes, consequences, compliance or recommendations. If the image shows \
nothing wrong, say what it shows. Never invent a hazard.

The context, if given, names the section the image sits in and its caption. Use it to know \
what to look at, but describe what the image shows, not what the caption claims."""


class TableBlock(BaseModel):
    title: str
    header_rows: int
    header_cols: int
    rows: list[list[str]]


class TableReading(BaseModel):
    tables: list[TableBlock]


class FormulaReading(BaseModel):
    latex: str


class PictureReading(BaseModel):
    kind: Literal["photograph", "diagram", "chart", "drawing", "table", "other"]
    description: str
    visible_text: str


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


def _picture_text(reading: PictureReading) -> str:
    # Labelled as generated: the document never printed these words.
    lines = [f"Image description (generated, {reading.kind}): {reading.description}"]
    if reading.visible_text.strip():
        lines.append(f"Text in image: {reading.visible_text.strip()}")
    return "\n".join(lines)


# task -> (prompt, answer schema, answer -> chunk text)
TASKS = {
    "table": (TABLE_PROMPT, TableReading, _table_text),
    "formula": (FORMULA_PROMPT, FormulaReading, _formula_text),
    "picture": (PICTURE_PROMPT, PictureReading, _picture_text),
}


def task_spec(task: str):
    """(prompt, schema, to_text) for `task`; an unknown task is a programming error."""
    try:
        return TASKS[task]
    except KeyError:
        raise ValueError(f"unknown OCR task {task!r}; expected one of {sorted(TASKS)}") from None

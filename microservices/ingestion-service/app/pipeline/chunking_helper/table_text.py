"""Turn a table reading into labelled records, and back into titled passages.

A provider reads each cropped region as `tables`: per table a title, how many top
rows and left columns are headings, and the grid. Code, not the model, flattens
that grid so numbers stay character for character as printed:

* a column's label is the path of its heading cells ("Inside Hose > gpm"), with
  merged or repeated cells collapsed;
* a row's label is the path of its heading columns ("Extra hazard");
* heading rows are never repeated as data.

`render_tables` writes the tables as text (the contract of `ocr_model.recognise`
is a string): an optional ``### title`` line, then one record per line, with a
blank line between tables. `split_tables` reads that text back, and
`group_records` cuts a long table into passages that each repeat the title.
"""

from dataclasses import dataclass, field

TITLE_MARK = "### "
# Characters of records per passage: about 400 tokens, so one answering row is a
# real share of what the passage means to search.
GROUP_CHARS = 1400
ROW_LABEL_SEPARATOR = " | "
PATH_SEPARATOR = " > "


@dataclass
class TableText:
    """One table read back from text: its printed title and its records."""

    title: str = ""
    records: list[str] = field(default_factory=list)


def _path(cells) -> str:
    """Join non-empty cells, collapsing neighbours that repeat (a merged cell)."""
    parts: list[str] = []
    for cell in cells:
        text = " ".join(str(cell or "").split())
        if text and (not parts or parts[-1] != text):
            parts.append(text)
    return PATH_SEPARATOR.join(parts)


def _column_labels(header: list[list[str]], width: int, header_cols: int) -> list[str]:
    """Label each column by the path of its heading cells, top row first.

    A blank cell in an upper heading row is taken as part of the cell to its
    left (a spanned heading the reader left empty); the corner above the row
    headings and the bottom heading row are left as read.
    """
    filled = [list(row) for row in header]
    for row_index, row in enumerate(filled[:-1]):
        carried = ""
        for column in range(header_cols, width):
            if str(row[column] or "").strip():
                carried = row[column]
            elif carried:
                filled[row_index][column] = carried
    return [_path(row[column] for row in filled) for column in range(width)]


def flatten_table(rows: list[list[str]], header_rows: int = 1, header_cols: int = 0) -> list[str]:
    """One record per body row, every value labelled by its column and row headings.

    ``Extra hazard | Inside Hose > gpm: 0, 50, or 100; Duration (minutes): 90 or 120``
    With no row headings the record is just the labelled values; with no heading
    rows the values are bare. A body row holding only row headings (a sub-section
    title) is kept as its own record.
    """
    grid = [[str(cell or "") for cell in row] for row in rows if row]
    if not grid:
        return []
    width = max(len(row) for row in grid)
    grid = [row + [""] * (width - len(row)) for row in grid]
    header_rows = max(0, min(header_rows, len(grid)))
    header_cols = max(0, min(header_cols, width))

    labels = _column_labels(grid[:header_rows], width, header_cols)
    records = []
    for row in grid[header_rows:]:
        fields = []
        for column in range(header_cols, width):
            value = " ".join(row[column].split())
            if not value:
                continue
            fields.append(f"{labels[column]}: {value}" if labels[column] else value)
        record = "; ".join(fields)
        row_label = _path(row[:header_cols])
        if row_label:
            record = f"{row_label}{ROW_LABEL_SEPARATOR}{record}" if record else row_label
        if record:
            records.append(record)
    return records


def render_tables(tables: list[TableText]) -> str:
    """Text of the tables: ``### title`` (when printed) and the records, blank line between."""
    blocks = []
    for table in tables:
        title = " ".join(table.title.split())
        lines = ([f"{TITLE_MARK}{title}"] if title else []) + table.records
        if lines:
            blocks.append("\n".join(lines))
    return "\n\n".join(blocks)


def split_tables(text: str) -> list[TableText]:
    """Read `render_tables` text back. Joined page readings share one blank-line format.

    A block with no title is the continuation of the table before it (the next
    page of a long table), so its records join that table; a first untitled block
    is a table of its own.
    """
    tables: list[TableText] = []
    for block in text.split("\n\n"):
        lines = [line for line in block.split("\n") if line.strip()]
        if not lines:
            continue
        title = ""
        if lines[0].startswith(TITLE_MARK):
            title = lines[0][len(TITLE_MARK) :].strip()
            lines = lines[1:]
        if title or not tables:
            tables.append(TableText(title=title, records=lines))
        else:
            tables[-1].records.extend(lines)
    return tables


def group_records(records: list[str], limit: int = GROUP_CHARS) -> list[list[str]]:
    """Cut records into runs of at most `limit` characters (a record is never cut).

    Every run holds at least one record, so a single huge row still gets its own.
    """
    groups: list[list[str]] = []
    size = 0
    for record in records:
        if groups and size + len(record) + 1 > limit:
            groups.append([])
            size = 0
        if not groups:
            groups.append([])
        groups[-1].append(record)
        size += len(record) + 1
    return groups

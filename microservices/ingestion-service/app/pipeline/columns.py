"""Read two-column pages column by column (CB-01, issue 02).

Docling can hand back the blocks of a two-column page in an order that jumps
between the columns: clause 29.4.3 says "the following information:" and the
next block is clause 29.2.5 from the other column, with the list itself landing
under an unrelated heading. `reorder_columns` fixes the order on the parsed
document, before headings are ranked and the document is chunked.

The rule is geometric. On a page, blocks much narrower than the page are
column blocks; if they fall in two clusters with a clear gap between, that gap
is the gutter. Blocks as wide as the page (a heading, a full-width table) are
barriers: the page is read in bands, and inside a band the left column comes
first, then the right, each top to bottom. A page without a gutter is left as
Docling ordered it.

`clause_jumps` is the cross-check: clause numbers that run backwards inside a
chapter ("29.4.3" then "29.2.5") are logged after parsing, so a page that is
still out of order shows up in the ingestion log.
"""

import logging
import re
from dataclasses import dataclass

log = logging.getLogger(__name__)

# A block at least this share of the page width is not a column block.
WIDE_SHARE = 0.6
# The gutter must be at least this share of the page width.
MIN_GUTTER_SHARE = 0.02
# Column blocks needed on each side of the gutter.
MIN_BLOCKS_PER_COLUMN = 2


@dataclass(frozen=True)
class Block:
    """A block's place on its page. Coordinates are points, `top` grows downwards."""

    key: int
    left: float
    top: float
    right: float
    bottom: float


def _gutter(blocks: list[Block], page_width: float) -> float | None:
    """The x of the gap between two clusters of column blocks, or None."""
    spans = sorted((b.left, b.right) for b in blocks)
    merged: list[list[float]] = []
    for left, right in spans:
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], right)
        else:
            merged.append([left, right])
    best: tuple[float, float] | None = None
    for before, after in zip(merged, merged[1:]):
        gap = after[0] - before[1]
        if gap >= MIN_GUTTER_SHARE * page_width and (best is None or gap > best[0]):
            best = (gap, (before[1] + after[0]) / 2)
    if best is None:
        return None
    split = best[1]
    left_count = sum(1 for b in blocks if b.right <= split)
    right_count = sum(1 for b in blocks if b.left >= split)
    if min(left_count, right_count) < MIN_BLOCKS_PER_COLUMN:
        return None
    return split


def order_blocks(blocks: list[Block], page_width: float) -> list[int]:
    """Keys of the blocks of one page in reading order; `blocks` come in Docling's order."""
    keys = [b.key for b in blocks]
    if page_width <= 0:
        return keys
    narrow = [b for b in blocks if b.right - b.left < WIDE_SHARE * page_width]
    split = _gutter(narrow, page_width)
    if split is None:
        return keys

    order: list[int] = []
    band: list[Block] = []

    def flush() -> None:
        left = [b for b in band if (b.left + b.right) / 2 < split]
        right = [b for b in band if (b.left + b.right) / 2 >= split]
        for column in (left, right):
            order.extend(b.key for b in sorted(column, key=lambda b: (b.top, b.key)))
        band.clear()

    wide_keys = {b.key for b in blocks} - {b.key for b in narrow}
    for block in sorted(blocks, key=lambda b: (b.top, b.key)):
        if block.key in wide_keys:
            flush()
            order.append(block.key)
        else:
            band.append(block)
    flush()
    return order


def _span(item, doc):
    """(page, left, top, right, bottom) of an item and what hangs under it, top-left origin."""
    boxes = []
    stack = [item]
    while stack:
        current = stack.pop()
        for prov in getattr(current, "prov", None) or []:
            page = doc.pages.get(prov.page_no)
            if page is None or prov.bbox is None:
                continue
            box = prov.bbox.to_top_left_origin(page.size.height)
            boxes.append((prov.page_no, box.l, box.t, box.r, box.b))
        stack.extend(child.resolve(doc) for child in getattr(current, "children", None) or [])
    if not boxes:
        return None
    first = boxes[0][0]
    boxes = [b for b in boxes if b[0] == first]
    return (
        first,
        min(b[1] for b in boxes),
        min(b[2] for b in boxes),
        max(b[3] for b in boxes),
        max(b[4] for b in boxes),
    )


def reorder_columns(doc) -> int:
    """Put the top-level body items of each two-column page in column order.

    Returns how many pages were reordered. Items without page geometry stay where
    they are.
    """
    children = list(doc.body.children)
    by_page: dict[int, list[tuple[int, Block]]] = {}
    for index, ref in enumerate(children):
        span = _span(ref.resolve(doc), doc)
        if span is not None:
            page, left, top, right, bottom = span
            by_page.setdefault(page, []).append((index, Block(index, left, top, right, bottom)))

    reordered = list(children)
    pages = 0
    for page, entries in by_page.items():
        order = order_blocks([block for _, block in entries], doc.pages[page].size.width)
        slots = [index for index, _ in entries]
        if order == [block.key for _, block in entries]:
            continue
        for slot, key in zip(slots, order):
            reordered[slot] = children[key]
        pages += 1
    doc.body.children = reordered
    return pages


# A clause number opening a block: "29.4.3", optionally behind a change mark ("N ", "Δ ").
_CLAUSE = re.compile(r"^\W{0,2}(?:[A-Z]\s+)?(\d+(?:\.\d+){2,})\b")


def clause_jumps(blocks: list[tuple[int, str]]) -> list[tuple[int, str, str]]:
    """Places where a clause number runs backwards inside its chapter.

    `blocks` is (page, text) in reading order. Returns (page, previous clause,
    clause) for each backward step, e.g. 29.4.3 followed by 29.2.5. Clauses of
    different chapters are not compared, so a new chapter is not a jump.
    """
    jumps = []
    previous: tuple[int, ...] | None = None
    previous_text = ""
    for page, text in blocks:
        match = _CLAUSE.match(text.strip())
        if not match:
            continue
        number = tuple(int(part) for part in match.group(1).split("."))
        if previous is not None and number[0] == previous[0] and number < previous:
            jumps.append((page, previous_text, match.group(1)))
        previous, previous_text = number, match.group(1)
    return jumps


def log_clause_jumps(doc) -> int:
    """Warn about each backward clause number in the document's reading order."""
    blocks = []
    for item, _level in doc.iterate_items(with_groups=False):
        text = getattr(item, "text", "")
        prov = getattr(item, "prov", None)
        if text and prov:
            blocks.append((prov[0].page_no, text))
    jumps = clause_jumps(blocks)
    for page, previous, current in jumps:
        log.warning(
            "Page %s: clause %s follows %s; the page may be out of reading order",
            page,
            current,
            previous,
        )
    return len(jumps)

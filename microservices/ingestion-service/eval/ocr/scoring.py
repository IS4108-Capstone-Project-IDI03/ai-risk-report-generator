"""Pure scoring for the table OCR comparison (IN-12). No network, no files.

A digital PDF's text layer is the answer key for a table's numbers, so no
hand-made golden file is needed.
- recall: share of the PDF's numbers the model reproduced, as a multiset, so a
  value printed twice must be read twice.
- precision: share of the distinct numbers read that the PDF contains at all.
  Distinct, because records repeat each heading (and its digits, e.g. "ft3")
  on every row; a misread is a number the PDF never prints.
"""

import re
from collections import Counter

NUMBER = re.compile(r"\d+(?:\.\d+)?")


def number_scores(reading: str, text_layer: str) -> tuple[float, float]:
    """(recall, precision) of the numbers in `reading` against `text_layer`."""
    printed, read = Counter(NUMBER.findall(text_layer)), Counter(NUMBER.findall(reading or ""))
    matched = sum((printed & read).values())
    recall = matched / sum(printed.values()) if printed else 0.0
    precision = len(set(read) & set(printed)) / len(read) if read else 0.0
    return recall, precision

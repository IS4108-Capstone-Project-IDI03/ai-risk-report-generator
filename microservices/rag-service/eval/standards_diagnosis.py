"""Table of each section's standards search (GN-16): what it found, kept and dropped.

Usage: pipe a real /sections/draft response (or a JSON list of them, or of bare
`standards_report` objects), or pass a file path:
    curl -s ... /sections/draft | python eval/standards_diagnosis.py
Stdlib only; no network.
"""

import json
import sys


def verdict(r: dict) -> str:
    """Why a section has few standards: the reading of one standards_report."""
    if r["found"] != r["kept"] + r["dropped"]["distance"] + r["dropped"]["cap"]:
        return "counts do not add up"
    if r["found"] == 0:
        return "no standards found"
    if r["kept"] == 0 and r["dropped"]["distance"] > 0:
        return "all dropped by distance (cut-off too tight?)"
    return "capped" if r["dropped"]["cap"] else "ok"


def reports(data) -> list[dict]:  # a string or number holds no reports
    """The standards_report objects in a report, a list of them, or a /sections response."""
    if isinstance(data, dict):
        if "standards_report" in data:
            return [data["standards_report"]]
        if "sections" in data:
            return reports(data["sections"])
        return [data] if "found" in data else []
    return [r for item in data for r in reports(item)] if isinstance(data, list) else []


def table(rows: list[dict]) -> str:
    """The aligned text table, one line per section."""
    head = [
        "Section",
        "searched",
        "found",
        "kept",
        "dropped(distance)",
        "dropped(cap)",
        "broader",
        "verdict",
    ]
    body = [
        [r["section"], r["searched"], r["found"], r["kept"], r["dropped"]["distance"],
         r["dropped"]["cap"], r["broader"], verdict(r)]
        for r in rows
    ]  # fmt: skip
    cells = [head] + [[str(c) for c in row] for row in body]
    widths = [max(len(row[i]) for row in cells) for i in range(len(head))]
    return "\n".join(
        "  ".join(c.ljust(w) for c, w in zip(row, widths, strict=True)).rstrip() for row in cells
    )


def main(argv: list[str]) -> None:
    """Print the table for the file named in argv (or stdin); on bad input say why and exit 1."""
    try:
        rows = reports(json.load(open(argv[0]) if argv else sys.stdin))
        if not rows:
            raise ValueError("no standards_report found in the input")
        print(table(rows))
    except (OSError, ValueError, KeyError, TypeError) as e:
        print(f"standards_diagnosis: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv[1:])

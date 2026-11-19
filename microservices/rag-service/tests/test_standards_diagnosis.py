"""The standards diagnosis table (GN-16)."""

import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "standards_diagnosis", Path(__file__).parent.parent / "eval" / "standards_diagnosis.py"
)
diagnosis = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnosis)


def report(section, found, kept, distance=0, cap=0, broader=False):
    return {
        "section": section, "searched": 2, "found": found, "kept": kept,
        "dropped": {"distance": distance, "cap": cap}, "broader": broader,
    }  # fmt: skip


def test_verdicts():
    assert diagnosis.verdict(report("a", 0, 0)) == "no standards found"
    assert "cut-off too tight" in diagnosis.verdict(report("a", 3, 0, distance=3))
    assert diagnosis.verdict(report("a", 5, 3, cap=2)) == "capped"
    assert diagnosis.verdict(report("a", 3, 3)) == "ok"


def test_table_reads_sections_response_and_aligns():
    data = {"sections": [{"standards_report": report("Fire", 0, 0)}, report("Roof", 3, 3)]}
    lines = diagnosis.table(diagnosis.reports(data)).splitlines()
    assert lines[0].split()[0] == "Section" and len(lines) == 3
    assert "no standards found" in lines[1] and lines[2].endswith("ok")
    assert len({line.index("2") for line in lines[1:]}) == 1

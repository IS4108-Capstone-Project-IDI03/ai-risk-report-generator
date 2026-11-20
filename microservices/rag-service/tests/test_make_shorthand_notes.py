"""CP-35 AC14: the dev script's prompt and parsing only; no network, no key."""

import importlib.util
import json
from pathlib import Path

path = Path(__file__).parents[3] / "scripts" / "make-shorthand-notes.py"
spec = importlib.util.spec_from_file_location("make_shorthand_notes", path)
script = importlib.util.module_from_spec(spec)
spec.loader.exec_module(script)


def test_prompt_asks_for_the_count_and_the_codes():
    prompt = script.build_prompt(3)
    assert "Invent 3" in prompt and "IR:" in prompt and "no real people" in prompt.lower()


def test_parse_notes_reads_the_model_text():
    notes = [
        {"id": "n1", "note": "F: spk ok", "expected": [{"kind": "fact", "shorthand": "spk ok"}]}
    ]
    reply = {"candidates": [{"content": {"parts": [{"text": json.dumps(notes)}]}}]}
    assert script.parse_notes(reply) == notes


def test_it_refuses_without_a_key(monkeypatch, capsys):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setattr("sys.argv", ["x"])
    assert script.main() == 1
    assert "GEMINI_API_KEY" in capsys.readouterr().err

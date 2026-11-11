"""AS-06: MarshBot's coverage check. The model is mocked; the route keeps only known ids."""

import pytest
from fastapi.testclient import TestClient

from app.assistant.coverage import CoverageResult, ThinFlag
from app.generation.llm import GenerationFailed
from app.main import app

client = TestClient(app)

REQUEST = {
    "assessment": {"reference": "RPT-1", "jurisdiction": "SG", "facility_type": "Warehouse"},
    "checklist": [
        {"id": "c1", "area": "Fire Protection", "text": "Sprinkler valves open and supervised"},
        {"id": "c2", "area": "Housekeeping", "text": "Aisles clear of stored goods"},
    ],
    "observations": [
        {"id": "o1", "COPE_dimension": ["Protection"], "note": "Valve B1 shut", "location": "Pump"},
        {"id": "o2", "COPE_dimension": ["Occupancy"], "note": "ok"},
    ],
    "sections": [
        {"section_id": "6", "title": "Fire Protection", "cope_dimensions": ["Protection"]},
        {"section_id": "7", "title": "Occupancy", "cope_dimensions": ["Occupancy"]},
    ],
}


def run(monkeypatch, result, request=REQUEST):
    sent = []

    def complete(system, user, schema, effort, feature=None, model=None):
        sent.append({"user": user, "feature": feature, "model": model, "effort": effort})
        if isinstance(result, Exception):
            raise result
        return result, "m"

    monkeypatch.setattr("app.assistant.coverage.complete", complete)
    return client.post("/assistant/coverage", json=request), sent


def test_returns_the_uncovered_items_and_thin_observations(monkeypatch):
    result = CoverageResult(
        uncovered=["c2"], thin=[ThinFlag(observation_id="o2", section_id="7", reason="Too vague.")]
    )

    response, sent = run(monkeypatch, result)

    body = response.json()
    assert response.status_code == 200
    assert body["uncovered"] == ["c2"]
    assert body["thin"] == [{"observation_id": "o2", "section_id": "7", "reason": "Too vague."}]
    assert body["provenance"]["prompt_version"] == "as06-cov-v3"
    assert body["provenance"]["privacy"] == {"enabled": False, "masked_count": 0}
    assert sent[0]["feature"] == "assistant-coverage"
    assert "- c1 [Fire Protection] Sprinkler valves" in sent[0]["user"]
    assert "- o2 (sections: 7 Occupancy)" in sent[0]["user"]


def test_ids_the_model_made_up_are_dropped(monkeypatch):
    result = CoverageResult(
        uncovered=["c2", "c2", "nope"],
        thin=[
            ThinFlag(observation_id="ghost", section_id="6", reason="x"),
            # o1 is filed under section 6, not 7.
            ThinFlag(observation_id="o1", section_id="7", reason="x"),
            ThinFlag(observation_id="o1", section_id="6", reason="Short."),
            ThinFlag(observation_id="o1", section_id="6", reason="Again."),
        ],
    )

    body = run(monkeypatch, result)[0].json()

    assert body["uncovered"] == ["c2"]
    assert body["thin"] == [{"observation_id": "o1", "section_id": "6", "reason": "Short."}]


def test_without_observations_every_item_is_uncovered_and_no_call_is_made(monkeypatch):
    response, sent = run(
        monkeypatch, GenerationFailed("never called"), {**REQUEST, "observations": []}
    )

    assert response.json()["uncovered"] == ["c1", "c2"]
    assert sent == []


def test_a_model_failure_is_a_502(monkeypatch):
    response, _ = run(monkeypatch, GenerationFailed("The language model could not be reached."))

    assert response.status_code == 502


@pytest.mark.parametrize("bad", [{"extra": 1}])
def test_unknown_fields_are_refused(monkeypatch, bad):
    response, _ = run(monkeypatch, CoverageResult(uncovered=[], thin=[]), {**REQUEST, **bad})

    assert response.status_code == 422

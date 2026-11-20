"""Standards search and its fallback (GN-16). Retrieval and the LLM are mocked."""

from app.generation.generator import Statement, Subsection
from tests.test_sections import REQUEST, STANDARD, draft

CITING = [
    Subsection(
        heading="Construction Narrative",
        statements=[Statement(text="Fire-stop them.", citations=["C:fm:4"])],
    )
]


def searcher(standards_for, calls):
    """A search whose standards come from `standards_for(filters)`; no past reports."""

    def search(requests, protection=None):
        calls.append(requests)
        return [
            [] if f["source_type"] == "marsh_report" else standards_for(f) for _, f, _ in requests
        ]

    return search


def run(monkeypatch, standards_for, request=REQUEST):
    calls = []
    response, _, _ = draft(monkeypatch, CITING, searcher(standards_for, calls), request)
    return calls, response.json()


def test_local_standard_is_searched(monkeypatch):
    calls, _ = run(monkeypatch, lambda f: [STANDARD])
    assert "local_standard" in calls[0][0][1]["source_type"]


def test_fallback_drops_facility_type_and_marks_sources_broader(monkeypatch):
    calls, body = run(monkeypatch, lambda f: [] if "facility_type" in f else [STANDARD])
    assert len(calls) == 2
    assert "facility_type" not in calls[1][0][1]
    assert calls[1][0][1]["jurisdiction"] == "Singapore"
    assert body["sources"]["C:fm:4"]["broader"] is True
    report = body["standards_report"]
    assert report["broader"] and report["fallback_searched"] == 1 and report["kept"] == 1


def test_no_fallback_when_exact_finds_some(monkeypatch):
    calls, body = run(monkeypatch, lambda f: [STANDARD])
    assert len(calls) == 1
    assert "broader" not in body["sources"]["C:fm:4"]
    assert body["standards_report"]["broader"] is False


def test_report_counts_add_up(monkeypatch):
    far = {**STANDARD, "id": "fm:9", "distance": 0.9}
    _, body = run(monkeypatch, lambda f: [STANDARD, far])
    r = body["standards_report"]
    assert r["found"] == 2 == r["kept"] + r["dropped"]["distance"] + r["dropped"]["cap"]
    assert r["dropped"]["distance"] == 1


def test_no_observations_searches_nothing(monkeypatch):
    calls, _ = run(monkeypatch, lambda f: [STANDARD], {**REQUEST, "observations": []})
    assert all(f["source_type"] == "marsh_report" for r in calls for _, f, _ in r)


def test_fallback_also_runs_when_every_exact_hit_is_too_far(monkeypatch):
    """Found by review: hits beyond the distance cut-off are as good as none."""
    far = {**STANDARD, "distance": 0.99}
    calls, body = run(monkeypatch, lambda f: [far] if "facility_type" in f else [STANDARD])
    assert len(calls) == 2
    assert body["sources"]["C:fm:4"]["broader"] is True


def test_a_none_distance_does_not_crash_and_counts_as_near(monkeypatch):
    """Found by the swarm: a hit with distance None made drafting raise TypeError."""
    unknown = {**STANDARD, "distance": None}
    _, body = run(monkeypatch, lambda f: [unknown])
    assert body["standards_report"]["kept"] == 1

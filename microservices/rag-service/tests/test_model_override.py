"""S-01: the admin's model (X-Model header) is used by `complete`, and only then."""

from fastapi.testclient import TestClient

from app import config
from app.generation import llm
from app.main import app

used = []


# A throwaway route that calls `complete` the way a drafting endpoint does (sync, so it runs in
# a worker thread: proves the header's value still reaches it).
@app.post("/_test/complete")
def _complete_route(explicit: str | None = None) -> dict:
    _, model = llm.complete("s", "u", dict, "high", model=explicit)
    return {"model": model}


def fake_provider(system, user, schema, effort, feature, model):
    used.append(model)
    return {}, model


def post(monkeypatch, headers=None, explicit=None):
    monkeypatch.setitem(llm._PROVIDERS, config.LLM_PROVIDER, fake_provider)
    url = "/_test/complete" + (f"?explicit={explicit}" if explicit else "")
    return TestClient(app).post(url, headers=headers or {}).json()["model"]


def test_the_header_model_is_used_instead_of_the_env_default(monkeypatch):
    assert post(monkeypatch, {"X-Model": "claude-sonnet-5-5"}) == "claude-sonnet-5-5"


def test_without_the_header_the_env_default_is_unchanged(monkeypatch):
    assert post(monkeypatch) == config.LLM_MODEL


def test_a_step_with_its_own_model_ignores_the_header(monkeypatch):
    assert post(monkeypatch, {"X-Model": "claude-sonnet-5-5"}, explicit="own-model") == "own-model"


def test_the_choice_does_not_leak_into_the_next_request(monkeypatch):
    post(monkeypatch, {"X-Model": "claude-sonnet-5-5"})
    assert post(monkeypatch) == config.LLM_MODEL

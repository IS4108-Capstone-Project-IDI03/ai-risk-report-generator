"""Tests for llm.stream_text and llm.complete_json (chat). SDK clients are faked."""

from types import SimpleNamespace as NS

import anthropic
import httpx
import pytest
from pydantic import BaseModel

from app import usage
from app.generation import llm


class Plan(BaseModel):
    topic: str


# ---- fakes ---------------------------------------------------------------------------------


class FakeAnthropicStream:
    def __init__(self, deltas, final, error=None):
        self.text_stream = self._gen(deltas, error)
        self._final = final

    @staticmethod
    def _gen(deltas, error):
        yield from deltas
        if error:
            raise error

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def get_final_message(self):
        return self._final


def anthropic_message(stop="end_turn", parsed=None):
    usage_ = NS(input_tokens=10, output_tokens=5, cache_read_input_tokens=3)
    return NS(model="claude-served", usage=usage_, stop_reason=stop, parsed_output=parsed)


def fake_anthropic(stream=None, parsed=None, error=None):
    calls = {}

    def do_stream(**kw):
        calls["stream"] = kw
        return stream

    def do_parse(**kw):
        calls["parse"] = kw
        if error:
            raise error
        return parsed

    client = NS(beta=NS(messages=NS(stream=do_stream, parse=do_parse)))
    return client, calls


def openai_response(status="completed", reason=None, parsed=None):
    return NS(
        model="gpt-served",
        status=status,
        incomplete_details=NS(reason=reason) if reason else None,
        usage=NS(input_tokens=20, output_tokens=7, input_tokens_details=NS(cached_tokens=4)),
        output_parsed=parsed,
    )


class FakeOpenAIStream:
    def __init__(self, deltas, final):
        self._events = [NS(type="response.created")] + [
            NS(type="response.output_text.delta", delta=d) for d in deltas
        ]
        self._final = final

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def __iter__(self):
        return iter(self._events)

    def get_final_response(self):
        return self._final


def fake_openai(stream=None, parsed=None):
    calls = {}

    def do_stream(**kw):
        calls["stream"] = kw
        return stream

    def do_parse(**kw):
        calls["parse"] = kw
        return parsed

    return NS(responses=NS(stream=do_stream, parse=do_parse)), calls


def stream(provider, items=None):
    kw = dict(provider=provider, model="m", effort="low", feature="chat")
    return list(llm.stream_text("sys", [{"role": "user", "content": "hi"}], **kw))


@pytest.fixture
def items():
    return usage.start()


# ---- stream_text: anthropic ----------------------------------------------------------------


def test_anthropic_stream_yields_deltas_and_records_usage(monkeypatch, items):
    client, calls = fake_anthropic(FakeAnthropicStream(["a", "b"], anthropic_message()))
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client)
    assert stream("anthropic") == ["a", "b"]
    assert calls["stream"]["output_config"] == {"effort": "low"}
    assert calls["stream"]["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert len(items) == 1
    assert items[0]["feature"] == "chat" and items[0]["billed_service"] == "anthropic"
    assert items[0]["model"] == "claude-served"
    assert (items[0]["input_tokens"], items[0]["output_tokens"]) == (10, 5)
    assert items[0]["cache_read_tokens"] == 3


def test_anthropic_refusal_fails_but_still_records_usage(monkeypatch, items):
    client, _ = fake_anthropic(FakeAnthropicStream(["a"], anthropic_message("refusal")))
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client)
    with pytest.raises(llm.GenerationFailed, match="declined"):
        stream("anthropic")
    assert len(items) == 1


def test_anthropic_cut_off_fails(monkeypatch, items):
    client, _ = fake_anthropic(FakeAnthropicStream(["a"], anthropic_message("max_tokens")))
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client)
    with pytest.raises(llm.GenerationFailed, match="cut off"):
        stream("anthropic")
    assert len(items) == 1


def test_anthropic_api_error_fails(monkeypatch, items):
    error = anthropic.APIConnectionError(request=httpx.Request("POST", "http://x"))
    client, _ = fake_anthropic(FakeAnthropicStream([], None, error=error))
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client)
    with pytest.raises(llm.GenerationFailed, match="could not be reached"):
        stream("anthropic")
    assert items == []


# ---- stream_text: openai -------------------------------------------------------------------


def test_openai_stream_yields_deltas_and_records_usage(monkeypatch, items):
    client, calls = fake_openai(FakeOpenAIStream(["x", "y"], openai_response()))
    monkeypatch.setattr(llm, "_openai_client", lambda: client)
    assert stream("openai") == ["x", "y"]
    assert calls["stream"]["instructions"] == "sys"
    assert calls["stream"]["reasoning"] == {"effort": "low"}
    assert items[0]["billed_service"] == "openai" and items[0]["model"] == "gpt-served"
    assert (items[0]["input_tokens"], items[0]["output_tokens"]) == (20, 7)
    assert items[0]["cache_read_tokens"] == 4


def test_openai_cut_off_fails_but_records_usage(monkeypatch, items):
    final = openai_response("incomplete", "max_output_tokens")
    client, _ = fake_openai(FakeOpenAIStream(["x"], final))
    monkeypatch.setattr(llm, "_openai_client", lambda: client)
    with pytest.raises(llm.GenerationFailed, match="cut off"):
        stream("openai")
    assert len(items) == 1


def test_openai_content_filter_is_a_refusal(monkeypatch, items):
    final = openai_response("incomplete", "content_filter")
    client, _ = fake_openai(FakeOpenAIStream([], final))
    monkeypatch.setattr(llm, "_openai_client", lambda: client)
    with pytest.raises(llm.GenerationFailed, match="declined"):
        stream("openai")
    assert len(items) == 1


def test_unknown_provider_raises():
    with pytest.raises(NotImplementedError):
        stream("gemini")
    with pytest.raises(NotImplementedError):
        llm.complete_json("s", "u", Plan, provider="gemini", model="m", effort="low", feature="f")


# ---- complete_json -------------------------------------------------------------------------


def test_complete_json_anthropic(monkeypatch, items):
    client, calls = fake_anthropic(parsed=anthropic_message(parsed=Plan(topic="fire")))
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client)
    got = llm.complete_json(
        "s", "u", Plan, provider="anthropic", model="m", effort="low", feature="plan"
    )
    assert got == Plan(topic="fire")
    assert calls["parse"]["output_format"] is Plan
    assert items[0]["feature"] == "plan"


def test_complete_json_openai(monkeypatch, items):
    client, calls = fake_openai(parsed=openai_response(parsed=Plan(topic="flood")))
    monkeypatch.setattr(llm, "_openai_client", lambda: client)
    got = llm.complete_json("s", "u", Plan, provider="openai", model="m", effort="low", feature="p")
    assert got == Plan(topic="flood")
    assert calls["parse"]["text_format"] is Plan
    assert items[0]["billed_service"] == "openai"


def test_complete_json_unparsed_fails(monkeypatch, items):
    client, _ = fake_anthropic(parsed=anthropic_message(parsed=None))
    monkeypatch.setattr(llm, "_anthropic_client", lambda: client)
    with pytest.raises(llm.GenerationFailed):
        llm.complete_json(
            "s", "u", Plan, provider="anthropic", model="m", effort="low", feature="p"
        )

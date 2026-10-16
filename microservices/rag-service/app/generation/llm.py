"""The one place that calls an LLM. `LLM_PROVIDER` picks the provider."""

import logging
import time
from collections.abc import Iterator
from contextlib import contextmanager
from functools import cache
from typing import TypeVar

from pydantic import BaseModel

from app import config
from app import usage as usage_log

T = TypeVar("T", bound=BaseModel)
# uvicorn's own logger, so the line shows in `docker compose logs rag-service`.
log = logging.getLogger("uvicorn.error")


class GenerationFailed(Exception):
    """The model gave no usable draft (a refusal or a cut-off answer)."""


@cache
def _anthropic_client():
    import anthropic

    return anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)


def _complete_anthropic(system: str, user: str, schema: type[T], effort: str) -> tuple[T, str]:
    import anthropic

    started = time.perf_counter()
    try:
        response = _anthropic_client().beta.messages.parse(
            model=config.LLM_MODEL,
            max_tokens=16000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            # Thinking is always on for this model; effort is the only control.
            output_config={"effort": effort},
            # On a safety decline the API reruns the request on a fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIStatusError as error:
        raise GenerationFailed(
            f"The language model returned an error ({error.status_code})."
        ) from error
    except anthropic.APIConnectionError as error:
        raise GenerationFailed("The language model could not be reached.") from error
    usage = response.usage
    # Recorded before the refusal check below: a refused or cut-off call is still billed.
    usage_log.record(
        "draft-section",
        "anthropic",
        response.model,
        started,
        input_tokens=getattr(usage, "input_tokens", None),
        output_tokens=getattr(usage, "output_tokens", None),
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", None),
    )
    log.info(
        "LLM %s effort=%s: %.0fs, %s input + %s output tokens (cache read %s)",
        response.model,
        effort,
        time.perf_counter() - started,
        getattr(usage, "input_tokens", None),
        getattr(usage, "output_tokens", None),
        getattr(usage, "cache_read_input_tokens", None),
    )
    if response.stop_reason == "refusal":
        raise GenerationFailed("The model declined to draft this section.")
    if response.stop_reason == "max_tokens" or response.parsed_output is None:
        raise GenerationFailed("The model's draft was cut off before it was complete.")
    return response.parsed_output, response.model


_PROVIDERS = {"anthropic": _complete_anthropic}
# ponytail: Gemini is not wired up. Add it to _PROVIDERS when someone needs it.


def complete(system: str, user: str, schema: type[T], effort: str) -> tuple[T, str]:
    """Return the model's answer parsed into `schema`, and the model that wrote it."""
    try:
        provider = _PROVIDERS[config.LLM_PROVIDER]
    except KeyError:
        raise NotImplementedError(
            f"LLM_PROVIDER {config.LLM_PROVIDER!r} is not supported"
        ) from None
    return provider(system, user, schema, effort)


# ---- Chat (streaming answer + JSON plan) ----------------------------------------------------
# Called by the chat flow. Unlike `complete`, the provider and model come from the caller
# (CHAT_* settings), so chat and drafting can use different providers.


@cache
def _openai_client():
    import openai

    # base_url is explicit: OPENAI_BASE_URL in the environment points at Groq for Whisper.
    return openai.OpenAI(api_key=config.OPENAI_CHAT_API_KEY, base_url="https://api.openai.com/v1")


@contextmanager
def _api_errors(sdk):
    """Turn an SDK's status/connection errors into GenerationFailed."""
    try:
        yield
    except sdk.APIStatusError as error:
        raise GenerationFailed(
            f"The language model returned an error ({error.status_code})."
        ) from error
    except sdk.APIConnectionError as error:
        raise GenerationFailed("The language model could not be reached.") from error


def _finish(feature, provider, started, model, usage, stop):
    """Record usage, then raise if the call was refused or cut off. `usage` = (in, out, cached)."""
    input_tokens, output_tokens, cached = usage
    # Recorded before raising: a refused or cut-off call is still billed.
    usage_log.record(
        feature,
        provider,
        model,
        started,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cache_read_tokens=cached,
    )
    if stop == "refusal":
        raise GenerationFailed("The model declined to answer.")
    if stop == "cut_off":
        raise GenerationFailed("The model's answer was cut off before it was complete.")


def _anthropic_usage(message):
    u = message.usage
    return (
        getattr(u, "input_tokens", None),
        getattr(u, "output_tokens", None),
        getattr(u, "cache_read_input_tokens", None),
    )


def _openai_usage(response):
    u = response.usage
    details = getattr(u, "input_tokens_details", None)
    return (
        getattr(u, "input_tokens", None),
        getattr(u, "output_tokens", None),
        getattr(details, "cached_tokens", None),
    )


def _openai_stop(response):
    """Map an OpenAI response's status to None, "cut_off" or "refusal"."""
    if response.status != "incomplete":
        return None
    reason = getattr(response.incomplete_details, "reason", None)
    return "cut_off" if reason == "max_output_tokens" else "refusal"


# On a safety decline the API reruns the request on a fallback model.
ANSWER_BETAS = ["server-side-fallback-2026-07-01"]


def anthropic_answer_params(system: str, messages: list[dict], model: str, effort: str) -> dict:
    """Return the Anthropic request body for a chat answer (the eval's batch reuses it)."""
    return {
        "model": model,
        "max_tokens": 8000,
        # Cached so follow-up turns in one chat don't re-pay for the long system prompt.
        "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        "messages": messages,
        "output_config": {"effort": effort},
        "fallbacks": "default",
    }


def openai_answer_params(system: str, messages: list[dict], model: str, effort: str) -> dict:
    """Return the OpenAI Responses request body for a chat answer (the eval's batch reuses it)."""
    return {
        "model": model,
        "instructions": system,
        "input": messages,
        "reasoning": {"effort": effort},
        "max_output_tokens": 8000,
    }


def _stream_anthropic(system, messages, model, effort, feature) -> Iterator[str]:
    import anthropic

    started = time.perf_counter()
    params = anthropic_answer_params(system, messages, model, effort)
    with _api_errors(anthropic):
        with _anthropic_client().beta.messages.stream(**params, betas=ANSWER_BETAS) as stream:
            yield from stream.text_stream
            final = stream.get_final_message()
    stop = {"refusal": "refusal", "max_tokens": "cut_off"}.get(final.stop_reason)
    _finish(feature, "anthropic", started, final.model, _anthropic_usage(final), stop)


def _stream_openai(system, messages, model, effort, feature) -> Iterator[str]:
    import openai

    started = time.perf_counter()
    with _api_errors(openai):
        with _openai_client().responses.stream(
            **openai_answer_params(system, messages, model, effort)
        ) as stream:
            for event in stream:
                if event.type == "response.output_text.delta":
                    yield event.delta
            final = stream.get_final_response()
    _finish(feature, "openai", started, final.model, _openai_usage(final), _openai_stop(final))


def _parse_anthropic(system, user, schema, model, effort, feature):
    import anthropic

    started = time.perf_counter()
    with _api_errors(anthropic):
        # No fallbacks here: unsure the small plan model supports the fallback beta.
        message = _anthropic_client().beta.messages.parse(
            model=model,
            max_tokens=2000,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
            output_config={"effort": effort},
        )
    stop = {"refusal": "refusal", "max_tokens": "cut_off"}.get(message.stop_reason)
    _finish(feature, "anthropic", started, message.model, _anthropic_usage(message), stop)
    if message.parsed_output is None:
        raise GenerationFailed("The model's answer could not be read.")
    return message.parsed_output


def _parse_openai(system, user, schema, model, effort, feature):
    import openai

    started = time.perf_counter()
    with _api_errors(openai):
        response = _openai_client().responses.parse(
            model=model,
            instructions=system,
            input=user,
            text_format=schema,
            reasoning={"effort": effort},
        )
    _finish(
        feature, "openai", started, response.model, _openai_usage(response), _openai_stop(response)
    )
    if response.output_parsed is None:
        raise GenerationFailed("The model's answer could not be read.")
    return response.output_parsed


_STREAMERS = {"anthropic": _stream_anthropic, "openai": _stream_openai}
_PARSERS = {"anthropic": _parse_anthropic, "openai": _parse_openai}


def _lookup(table: dict, provider: str):
    try:
        return table[provider]
    except KeyError:
        raise NotImplementedError(f"LLM provider {provider!r} is not supported") from None


def stream_text(
    system: str, messages: list[dict], *, provider: str, model: str, effort: str, feature: str
) -> Iterator[str]:
    """Return an iterator of the model's answer text, delta by delta."""
    return _lookup(_STREAMERS, provider)(system, messages, model, effort, feature)


def complete_json(
    system: str,
    user: str,
    schema: type[T],
    *,
    provider: str,
    model: str,
    effort: str,
    feature: str,
) -> T:
    """Return the model's answer parsed into `schema`."""
    return _lookup(_PARSERS, provider)(system, user, schema, model, effort, feature)

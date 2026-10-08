"""The one place that calls an LLM. `LLM_PROVIDER` picks the provider."""

import logging
import time
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

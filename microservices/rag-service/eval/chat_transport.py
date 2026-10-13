"""Provider plumbing for the CB-01 chat eval: retries, served-model check, batch jobs.

Called by eval/chat_runner.py (answer calls) and eval/chat_grade.py (judge calls).
Batch = Anthropic Message Batches or OpenAI Batch on /v1/responses (both 50% off).
Request shapes checked against the installed SDKs (anthropic 1.11, openai 3.24).
"""

import json
import random
import re
import time
from pathlib import Path

from app.generation import llm

# A seam, so tests never wait.
sleep = time.sleep


class AttemptFailed(Exception):
    """A case attempt that produced nothing scorable; lands in errors.jsonl, never results."""

    def __init__(self, message: str, failure_class: str, model=None, usage=None):
        super().__init__(message)
        self.failure_class, self.model, self.usage = failure_class, model, usage


def transient(error: BaseException) -> bool:
    """Return True for a 429 / overloaded / 5xx / connection error worth retrying."""
    import anthropic
    import openai

    cause = error.__cause__ or error
    status = getattr(cause, "status_code", None)
    if status is not None:
        return status in (429, 529) or 500 <= status < 600
    return isinstance(cause, anthropic.APIConnectionError | openai.APIConnectionError)


def with_backoff(fn, retries: dict, deadline: float = float("inf"), tries: int = 5):
    """Return fn(), retrying transient errors with jittered backoff; counts retries in `retries`.

    Without the jitter and cap, a rate limit would turn into a tight loop of paid retries.
    """
    for attempt in range(tries):
        # Checked before every attempt: past the ceiling, no new paid call may start.
        if time.monotonic() >= deadline:
            raise AttemptFailed("wall-clock ceiling exceeded before attempt", "timeout")
        try:
            return fn()
        except Exception as error:
            if not transient(error) or attempt == tries - 1:
                raise
            delay = min(60.0, 2.0**attempt) * (0.5 + random.random())
            if time.monotonic() + delay >= deadline:
                raise
            retries["count"] = retries.get("count", 0) + 1
            sleep(delay)


def served_ok(requested: str, served: str | None) -> bool:
    """Return True if `served` is `requested` or a dated snapshot of it (foo -> foo-20261001)."""
    if not served or served == requested:
        return True
    base = re.sub(r"-latest$|-0$", "", requested)
    rest = served[len(base) :] if served.startswith(base) else None
    return rest is not None and re.fullmatch(r"[-@](\d{8}|\d{4}-\d{2}-\d{2})", rest) is not None


def _get(obj, key, default=None):
    """Read a field from an SDK object or the same thing as a dict."""
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def normalize(provider: str, response) -> dict:
    """Return a final response's text, model, usage, stop_reason and stop (None/cut_off/refusal).

    Usage uses Anthropic's meaning: input_tokens excludes cache reads. OpenAI counts cached
    tokens inside input_tokens, so they are split out here, or cost would count them twice.
    """
    u = _get(response, "usage")
    if provider == "anthropic":
        blocks = _get(response, "content") or []
        text = "".join(_get(b, "text") or "" for b in blocks if _get(b, "type") == "text")
        stop_reason = _get(response, "stop_reason")
        stop = {"refusal": "refusal", "max_tokens": "cut_off"}.get(stop_reason)
        usage = {
            "input_tokens": _get(u, "input_tokens"),
            "output_tokens": _get(u, "output_tokens"),
            "cache_read_input_tokens": _get(u, "cache_read_input_tokens") or 0,
            "cache_creation_input_tokens": _get(u, "cache_creation_input_tokens") or 0,
        }
    else:
        text = "".join(
            _get(c, "text") or ""
            for item in _get(response, "output") or []
            if _get(item, "type") == "message"
            for c in _get(item, "content") or []
            if _get(c, "type") == "output_text"
        )
        stop = None
        if _get(response, "status") == "incomplete":
            reason = _get(_get(response, "incomplete_details"), "reason")
            stop = "cut_off" if reason == "max_output_tokens" else "refusal"
        stop_reason = {None: "end_turn", "cut_off": "max_tokens", "refusal": "refusal"}[stop]
        cached = _get(_get(u, "input_tokens_details"), "cached_tokens") or 0
        usage = {
            "input_tokens": (_get(u, "input_tokens") or 0) - cached,
            "output_tokens": _get(u, "output_tokens"),
            "cache_read_input_tokens": cached,
            "cache_creation_input_tokens": 0,
        }
    return {
        "text": text,
        "model": _get(response, "model"),
        "usage": usage,
        "stop_reason": stop_reason,
        "stop": stop,
    }


# ---- request bodies -------------------------------------------------------------------------


def answer_params(provider: str, system: str, messages: list, model: str, effort: str) -> dict:
    """Return the answer request body production would send (from app/generation/llm.py)."""
    build = {"anthropic": llm.anthropic_answer_params, "openai": llm.openai_answer_params}
    return build[provider](system, messages, model, effort)


def judge_params(provider: str, system: str, user: str, schema, model: str, effort: str) -> dict:
    """Return a structured-output request body matching llm.complete_json's for that provider."""
    if provider == "anthropic":
        from anthropic.lib._parse._transform import transform_schema

        return {
            "model": model,
            "max_tokens": 2000,  # must match llm._parse_anthropic
            "system": system,
            "messages": [{"role": "user", "content": user}],
            "output_config": {
                "effort": effort,
                "format": {"type": "json_schema", "schema": transform_schema(schema)},
            },
        }
    from openai.lib._parsing._responses import type_to_text_format_param

    return {
        "model": model,
        "instructions": system,
        "input": user,
        "text": {"format": type_to_text_format_param(schema)},
        "reasoning": {"effort": effort},
    }


# ---- batch jobs -----------------------------------------------------------------------------


def _client(provider: str):
    """Return the app's own SDK client for the provider (same keys and base URL)."""
    return llm._anthropic_client() if provider == "anthropic" else llm._openai_client()


def _submit(provider: str, requests: dict[str, dict]) -> str:
    """Start one batch of {custom_id: body}; return its id."""
    client = _client(provider)
    if provider == "anthropic":
        batch = client.beta.messages.batches.create(
            requests=[{"custom_id": cid, "params": body} for cid, body in requests.items()],
            betas=llm.ANSWER_BETAS,
        )
        return batch.id
    # OpenAI takes the requests as an uploaded JSONL file, one /v1/responses call per line.
    lines = [
        json.dumps({"custom_id": cid, "method": "POST", "url": "/v1/responses", "body": body})
        for cid, body in requests.items()
    ]
    upload = client.files.create(
        file=("cb01-eval.jsonl", "\n".join(lines).encode()), purpose="batch"
    )
    batch = client.batches.create(
        input_file_id=upload.id, endpoint="/v1/responses", completion_window="24h"
    )
    return batch.id


def _wait(provider: str, batch_id: str, deadline: float, poll_s: float):
    """Return the batch once it has ended; raise a timeout past the deadline."""
    client = _client(provider)
    while True:
        if provider == "anthropic":
            batch = client.beta.messages.batches.retrieve(batch_id)
            if batch.processing_status == "ended":
                return batch
        else:
            batch = client.batches.retrieve(batch_id)
            if batch.status in ("completed", "failed", "expired", "cancelled"):
                return batch
        if time.monotonic() + poll_s >= deadline:
            raise AttemptFailed(f"batch {batch_id} still running at the ceiling", "timeout")
        sleep(poll_s)


def _fetch(provider: str, batch_id: str, batch) -> dict[str, dict]:
    """Return {custom_id: {"ok": response dict} | {"error": text}} for an ended batch."""
    client, out = _client(provider), {}
    if provider == "anthropic":
        for item in client.beta.messages.batches.results(batch_id):
            result = item.result
            if result.type == "succeeded":
                message = result.message
                # The SDK gives a pydantic model; the tests' fake batches give plain dicts.
                dump = getattr(message, "model_dump", None)
                out[item.custom_id] = {"ok": dump(mode="json") if dump else message}
            else:
                detail = getattr(result, "error", None)
                out[item.custom_id] = {"error": f"{result.type}: {detail}"[:500]}
        return out
    # The output and error files hold one JSON line per request (OpenAI Batch guide).
    for file_id in (batch.output_file_id, batch.error_file_id):
        if not file_id:
            continue
        for line in client.files.content(file_id).text.splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            response = record.get("response") or {}
            if record.get("error") or response.get("status_code") != 200:
                detail = record.get("error") or response.get("body")
                out[record["custom_id"]] = {"error": json.dumps(detail)[:500]}
            else:
                out[record["custom_id"]] = {"ok": response["body"]}
    return out


def _save(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, indent=1))
    tmp.replace(path)


def batch_results(
    path: Path,
    provider: str,
    requests: dict[str, dict],
    *,
    prefix: str,
    deadline: float,
    poll_s: float,
    log,
) -> dict[str, dict]:
    """Return {key: {"ok": response} | {"error": text}} for every request, via one batch.

    `path` records each batch id and its results, so a rerun after a crash polls or reuses
    the batch it already paid for instead of submitting it again.
    """
    state = json.loads(path.read_text()) if path.exists() else {"batches": []}
    known = {key for b in state["batches"] for key in b["keys"].values()}
    todo = [key for key in requests if key not in known]
    if todo:
        start = sum(len(b["keys"]) for b in state["batches"])
        # custom_id must match ^[a-zA-Z0-9_-]{1,64}$ (Anthropic); the key itself may not.
        keys = {f"{prefix}{start + n}": key for n, key in enumerate(todo)}
        batch_id = _submit(provider, {cid: requests[key] for cid, key in keys.items()})
        state["batches"].append(
            {"provider": provider, "batch_id": batch_id, "keys": keys, "results": None}
        )
        _save(path, state)  # at once: a crash from here on must not pay for it twice
        log(f"submitted {provider} batch {batch_id} with {len(keys)} request(s)")
    for b in state["batches"]:
        if b["results"] is None and any(key in requests for key in b["keys"].values()):
            log(f"waiting for {b['provider']} batch {b['batch_id']}")
            ended = _wait(b["provider"], b["batch_id"], deadline, poll_s)
            b["results"] = _fetch(b["provider"], b["batch_id"], ended)
            _save(path, state)
    out = {}
    for b in state["batches"]:
        for cid, key in b["keys"].items():
            if key in requests and b["results"] is not None:
                out[key] = b["results"].get(cid, {"error": "the batch returned no result"})
    return out

"""The four model adapters for automatic labelling, plain httpx, no SDKs (IN-05).

Called by app/labelling/__init__.py through `classify_details` and `extract_details`
(tests fake those two). Each call logs model, tokens, cost and seconds and returns the
same as a usage dict. Any failure raises; the caller turns that into "all Unconfirmed".
"""

import json
import logging
import re
import time

import httpx

from app.labelling import config
from app.labelling.prompt import SCHEMA, SYSTEM_PROMPT

logger = logging.getLogger(__name__)
TIMEOUT = 30  # seconds per call

_QUESTIONS = {
    "source_type": "What kind of document is this?",
    "jurisdiction": (
        "Which country does the document apply to? A currency such as SGD indicates the "
        "country. Use 'all' for a standard that applies in every country."
    ),
    "facility_type": (
        "Which facility type does the document cover? Use 'all' for a standard that "
        "covers every facility type."
    ),
}


def _options(detail: str) -> dict[str, tuple[str | None, str]]:
    """Return {short id: (value, description)} for a question, plus 'unknown' -> None."""
    described = {
        "source_type": config.SOURCE_TYPES,
        "jurisdiction": config.JURISDICTIONS,
        "facility_type": config.FACILITY_HINTS,
    }
    out = {}
    for value in config.ALLOWED[detail]:
        text = described.get(detail, {}).get(value, value)
        out[re.sub(r"\W+", "_", value.lower())] = (value, text)
    out["unknown"] = (None, "not stated in the text")
    return out


def _usage(model: str, price_key: str, tokens_in: int, tokens_out: int, started: float) -> dict:
    """Return the usage dict for one call and log it as one line."""
    price_in, price_out = config.PRICES[price_key]
    cost = (tokens_in * price_in + tokens_out * price_out) / 1_000_000
    seconds = round(time.monotonic() - started, 2)
    logger.info(
        "label call model=%s in=%d out=%d cost_usd=%.6f seconds=%.2f",
        model,
        tokens_in,
        tokens_out,
        cost,
        seconds,
    )
    return {
        "model": model,
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "cost_usd": cost,
        "seconds": seconds,
    }


def _post(url: str, headers: dict, body: dict) -> dict:
    response = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
    if response.is_error:
        # The body says why (bad schema, bad key); the default error message does not.
        logger.error("label call %s failed: %s", url, response.text[:300])
    response.raise_for_status()
    return response.json()


def jev_classify(text: str) -> tuple[dict, dict]:
    """Return ({detail: {value, confidence}}, usage) from TypeSafe Jev."""
    started = time.monotonic()
    questions = {
        d: {
            "type": "choice",
            "instructions": _QUESTIONS[d],
            "criteria": {i: desc for i, (_, desc) in _options(d).items()},
        }
        for d in config.FIXED_LIST
    }
    data = _post(
        "https://api.typesafe.ai/v1/systemone",
        {"Authorization": f"Bearer {config.api_key('TYPESAFE_API_KEY')}"},
        {"model": "jev-latest", "state": text, "questions": questions},
    )
    answers = {}
    for d in config.FIXED_LIST:
        answer = data["answers"][d]
        choice = answer["choice"]
        answers[d] = {
            "value": _options(d)[choice][0],
            "confidence": answer["probabilities"].get(choice, answer["confidence"]),
        }
    use = data["usage"]
    return answers, _usage("jev", "jev", use["input_tokens"], use["output_tokens"], started)


def openai_decisions_classify(text: str) -> tuple[dict, dict]:
    """Return ({detail: {value, confidence}}, usage) from OpenAI Decisions."""
    started = time.monotonic()
    questions = [
        {
            "type": "choice",
            "name": d,
            "instructions": _QUESTIONS[d],
            "choices": [{"value": i, "description": desc} for i, (_, desc) in _options(d).items()],
        }
        for d in config.FIXED_LIST
    ]
    data = _post(
        f"{config.OPENAI_BASE}/decisions",
        {"Authorization": f"Bearer {config.api_key('OPENAI_LABEL_API_KEY')}"},
        {"model": "gpt-6-luna", "input": text, "questions": questions},
    )
    answers = {}
    for answer in data["answers"]:
        chosen = answer["choice"]
        odds = {p["value"]: p["probability"] for p in answer["probabilities"]}
        answers[answer["name"]] = {
            "value": _options(answer["name"])[chosen][0],
            "confidence": odds.get(chosen, answer["confidence"]),
        }
    use = data["usage"]
    usage = _usage(
        "openai-decisions", "openai-decisions", use["input_tokens"], use["output_tokens"], started
    )
    return answers, usage


def anthropic_extract(text: str) -> tuple[dict, dict]:
    """Return (answers for all six details, usage) from Claude Haiku."""
    started = time.monotonic()
    model = config.llm_model()
    data = _post(
        "https://api.anthropic.com/v1/messages",
        {"x-api-key": config.api_key("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01"},
        {
            "model": model,
            "max_tokens": 1024,
            # Off, like Luna's reasoning effort "none". Haiku 4.5 already runs without it.
            "thinking": {"type": "disabled"},
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": text}],
            "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}},
        },
    )
    # A refusal or a cut-off answer is not valid JSON for our schema: treat as failure.
    if data.get("stop_reason") in ("refusal", "max_tokens"):
        raise RuntimeError(f"Anthropic stopped with {data['stop_reason']}")
    use = data["usage"]
    # Price row = model name without its date (claude-haiku-4-5-20251001 -> claude-haiku-4-5).
    # An unpriced model is logged at Haiku 4.5's price rather than crashing after a paid call.
    price_key = re.sub(r"-\d{8}$", "", model)
    price_key = price_key if price_key in config.PRICES else "claude-haiku-4-5"
    usage = _usage(model, price_key, use["input_tokens"], use["output_tokens"], started)
    return json.loads(data["content"][0]["text"]), usage


def openai_extract(text: str) -> tuple[dict, dict]:
    """Return (answers for all six details, usage) from the OpenAI Responses API."""
    started = time.monotonic()
    model = config.llm_model()
    data = _post(
        f"{config.OPENAI_BASE}/responses",
        {"Authorization": f"Bearer {config.api_key('OPENAI_LABEL_API_KEY')}"},
        {
            "model": model,
            "reasoning": {"effort": "none"},
            "input": f"{SYSTEM_PROMPT}\n\n{text}",
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "details",
                    "strict": True,
                    "schema": SCHEMA,
                }
            },
        },
    )
    message = next(item for item in data["output"] if item["type"] == "message")
    use = data["usage"]
    usage = _usage(model, "gpt-6-luna", use["input_tokens"], use["output_tokens"], started)
    return json.loads(message["content"][0]["text"]), usage


def classify_details(text: str) -> tuple[dict, dict]:
    """Return the configured classifier's answers and usage (not called when it is none)."""
    adapters = {"jev": jev_classify, "openai-decisions": openai_decisions_classify}
    return adapters[config.classifier()](text)


def extract_details(text: str) -> tuple[dict, dict]:
    """Return the configured LLM's answers for all six details, and usage."""
    return (openai_extract if config.llm_provider() == "openai" else anthropic_extract)(text)

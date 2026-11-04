"""The fixed-choice classifier for the site walk (CP-22) and client intake (CP-23) steps:
TypeSafe Jev, plain httpx.

A small copy of jev_classify in microservices/ingestion-service/app/labelling/models.py.
Called by app/site_walk/propose.py and app/client_intake/read.py through `choose`.
Records each call's usage, priced here.
"""

import logging
import os
import time

import httpx

from app import config, usage
from app.generation.llm import GenerationFailed

log = logging.getLogger("uvicorn.error")
URL = "https://api.typesafe.ai/v1/systemone"
TIMEOUT = 30  # seconds per call
# USD per 1M tokens; must match PRICES["jev"] in ingestion-service/app/labelling/config.py.
PRICE_IN, PRICE_OUT = 0.042, 0.0


def _post(url: str, headers: dict, body: dict) -> dict:
    response = httpx.post(url, headers=headers, json=body, timeout=TIMEOUT)
    if response.is_error:
        # The body says why (bad schema, bad key); the default error message does not.
        log.error("Jev classifier call failed: %s", response.text[:300])
    response.raise_for_status()
    return response.json()


def _jev(state: str, questions: dict[str, tuple[str, dict[str, str]]], feature: str) -> dict:
    """Jev answers every question about one `state` text in a single call."""
    key = os.getenv("TYPESAFE_API_KEY", "").strip()
    if not key or key == "REPLACE_ME":
        raise GenerationFailed("Set TYPESAFE_API_KEY in the root .env to use the Jev classifier.")
    started = time.perf_counter()
    body = {
        "model": "jev-latest",
        "state": state,
        "questions": {
            name: {"type": "choice", "instructions": instructions, "criteria": criteria}
            for name, (instructions, criteria) in questions.items()
        },
    }
    try:
        data = _post(URL, {"Authorization": f"Bearer {key}"}, body)
    except httpx.HTTPError as error:
        raise GenerationFailed("The classifier (Jev) could not be reached.") from error
    use = data.get("usage") or {}
    tokens_in, tokens_out = use.get("input_tokens"), use.get("output_tokens")
    cost = None
    if tokens_in is not None and tokens_out is not None:
        cost = (tokens_in * PRICE_IN + tokens_out * PRICE_OUT) / 1_000_000
    # Recorded before the answers are read: an unreadable answer is still billed.
    usage.record(
        feature,
        "typesafe-jev",
        "jev",
        started,
        priced={
            "cost_usd": cost,
            "input_usd_per_1m": PRICE_IN,
            "output_usd_per_1m": PRICE_OUT,
            "pricing_basis": "rag-service Jev price (app/site_walk/jev.py)",
        },
        input_tokens=tokens_in,
        output_tokens=tokens_out,
    )
    answers = {}
    try:
        for name, (_, criteria) in questions.items():
            answer = data["answers"][name]
            choice = answer["choice"]
            if choice not in criteria:
                raise KeyError(choice)
            answers[name] = (choice, answer["probabilities"].get(choice, answer["confidence"]))
    except (KeyError, TypeError) as error:
        raise GenerationFailed("The classifier's (Jev's) answer could not be read.") from error
    return answers


_CLASSIFIERS = {"jev": _jev}


def choose(
    state: str,
    questions: dict[str, tuple[str, dict[str, str]]],
    classifier: str | None = None,
    feature: str = "site-walk",
) -> dict:
    """Return {question name: (chosen criterion id, its probability)} for each question.

    `questions` maps a name to (instructions, {criterion id: description}). `classifier` is the
    step's setting (SITE_WALK_CLASSIFIER when not given), so no provider is named in the step
    itself. `feature` names the call in the usage record.
    """
    name = classifier or config.SITE_WALK_CLASSIFIER
    try:
        adapter = _CLASSIFIERS[name]
    except KeyError:
        raise NotImplementedError(f"Classifier {name!r} is not supported") from None
    return adapter(state, questions, feature)

"""S-01: the model the gateway chose for this request, if any.

The gateway sends it in the `X-Model` header (server/src/services/model-resolver.service.ts
calls settings.service.ts `resolveModel`). main.py runs `read_model_header` on every request;
the code that picks a model reads `MODEL_OVERRIDE` and falls back to its `.env` default.
Only the model changes: the provider always comes from `.env`.
"""

from contextvars import ContextVar

from fastapi import Header

MODEL_OVERRIDE: ContextVar[str | None] = ContextVar("model_override", default=None)


# Must be async: a sync dependency runs in a worker thread, and the value it set would be
# lost before the endpoint runs. Without this, the header would be silently ignored.
async def read_model_header(x_model: str | None = Header(default=None)) -> None:
    MODEL_OVERRIDE.set((x_model or "").strip() or None)

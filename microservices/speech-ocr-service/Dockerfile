FROM python:3.11-slim

WORKDIR /app

# Packages come from uv.lock, so a rebuild gets the versions that were tested,
# not whatever is newest on PyPI that day. They go into the image's own Python
# (/usr/local), not /app/.venv: docker-compose mounts the source over /app.
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/usr/local \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Manifests first, so a code-only change reuses the installed packages.
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev --no-install-project

COPY . .

EXPOSE 8003

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8003", "--reload"]

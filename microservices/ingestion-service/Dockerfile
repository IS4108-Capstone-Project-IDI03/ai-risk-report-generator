# ── base: system deps, uv, Python ─────────────────────────────────────────────
FROM python:3.12-slim AS base

# opencv-python (required by rapidocr ← docling) links against libGL and
# libglib2.0. On slim images those aren't present, causing an ImportError.
# Install them here rather than switching to the headless build, because
# rapidocr hard-requires `opencv_python` by name and would still pull in
# this build even if we declared the headless variant.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install uv. Using the official method: copy the binary from the uv image so
# the version is pinned and there is no pip/curl dependency.
COPY --from=ghcr.io/astral-sh/uv:0.12.18 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv

WORKDIR /app

# ── deps: install from lockfile before copying source ─────────────────────────
FROM base AS deps

# Copy the dependency manifests only. If only application code changes,
# this layer (the heavy one) is still valid in the cache.
COPY pyproject.toml uv.lock ./


RUN uv sync --frozen --no-install-project --no-dev

# ── test-runner stage ─────────────────────────────────────────────────────────
# Build with: docker build --target test -t ingestion-test .
# Run with:   docker run --rm ingestion-test
#
# Test fixtures (large PDFs) are excluded via .dockerignore so the Docling
# tests that need them are skipped via the `slow` + default marker filter.
# Unit tests (all 129 - 2 deselected = 127 selected) run without any service.
FROM deps AS test

RUN uv sync --frozen --no-install-project

COPY . .
RUN uv sync --frozen

CMD ["uv", "run", "pytest", "-q", "--tb=short", "-m", "not slow and not inspect"]

# ── production ────────────────────────────────────────────────────────────────
FROM deps AS production

# Copy source after deps are cached.
COPY app/ ./app/
COPY config.yml ./

RUN uv sync --frozen --no-dev

EXPOSE 8001

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

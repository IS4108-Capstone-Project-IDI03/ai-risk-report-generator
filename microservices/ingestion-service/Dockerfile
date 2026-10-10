# Which optional extras to install (pyproject.toml [project.optional-dependencies]):
#   "--extra cpu"                     cloud default: CPU-only torch, no GLM-OCR
#   "--extra cpu --extra local-ocr"   docker-compose.local-ocr.yml
#   "--extra gpu --extra local-ocr"   + docker-compose.gpu.yml (CUDA torch, Nemotron)
# Declared before the first FROM; each stage that uses it re-imports it with a
# bare `ARG UV_EXTRAS` (an ARG is otherwise empty outside its own stage).
ARG UV_EXTRAS="--extra cpu"

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

# UV_NO_SYNC: `uv run` must not re-sync at container start. By default it
# syncs to the default dependencies, which would uninstall the extras chosen at
# build time (the cpu torch) and reach the network.
# DOCLING_ARTIFACTS_PATH / HF_HOME: models are downloaded into the image (deps
# stage), never at runtime.
# Every `uv sync` keeps uv's download cache in a BuildKit cache mount, which
# speeds up rebuilds without shipping the cache (~2 GB) in the image.
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_NO_SYNC=1 \
    DOCLING_ARTIFACTS_PATH=/app/models \
    HF_HOME=/app/.hf

WORKDIR /app

# ── deps: install from lockfile before copying source ─────────────────────────
FROM base AS deps
ARG UV_EXTRAS

# Copy the dependency manifests only. If only application code changes,
# this layer (the heavy one) is still valid in the cache.
COPY pyproject.toml uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev ${UV_EXTRAS}

# Docling's layout + RapidOCR models and the chunker's bge-m3 tokenizer (files
# only, no weights), so a container never downloads from Hugging Face.
RUN uv run docling-tools models download layout rapidocr -o "$DOCLING_ARTIFACTS_PATH" \
    && uv run python -c "from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('BAAI/bge-m3')"

# ── test-runner stage ─────────────────────────────────────────────────────────
# Build with: docker build --target test -t ingestion-test .
# Run with:   docker run --rm ingestion-test
#
# Test fixtures (large PDFs) are excluded via .dockerignore so the Docling
# tests that need them are skipped via the `slow` + default marker filter.
# Unit tests run without any service.
FROM deps AS test
ARG UV_EXTRAS

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project ${UV_EXTRAS}

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen ${UV_EXTRAS}

CMD ["uv", "run", "pytest", "-q", "--tb=short", "-m", "not slow and not inspect and not live"]

# ── production ────────────────────────────────────────────────────────────────
FROM deps AS production
ARG UV_EXTRAS

# Copy source after deps are cached.
COPY app/ ./app/
COPY config.yml ./

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev ${UV_EXTRAS}

EXPOSE 8001

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]

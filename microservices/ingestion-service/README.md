# Ingestion service

The ingestion service parses documents, removes sensitive information, creates
chunks, and indexes them in Chroma. It runs on port `8001`.

## Prerequisites

Install:

- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for Chroma,
  Ollama, and the full stack

The commands below use PowerShell. Run Docker Compose commands from the **repository
root**, not from this directory.

## First-time setup

From the repository root:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace any required `REPLACE_ME` values. Set
`COHERE_API_KEY` before running document indexing.

From this directory:

```powershell
uv sync
```

`uv sync` creates the virtual environment and installs the service and development
dependencies. You can run tools without activating the environment by prefixing
commands with `uv run`.

## Run locally with uv

Start the supporting services from the repository root:

```powershell
docker compose up -d chroma ollama
docker compose run --rm ollama-pull
```

Or to build and start all services:

```powershell
docker compose up -d
```

Then start the ingestion API from this directory:

```powershell
uv run uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

The API is available at `http://localhost:8001`. The health endpoint is
`http://localhost:8001/health`.

Uploaded documents reach the pipeline through the worker, not this API (IN-01).
The gateway checks each PDF with `POST /inspect`, stores it in S3, records it in
MongoDB's `knowledge_documents` and queues a BullMQ job on the `ingestion` queue
in Redis. The worker takes one job at a time, downloads the original, runs
`app.pipeline.run(path, doc_id=<document id>, labels=...)` and writes
`processing`, then `complete` or `failed` with the reason, back to the document.
Every passage carries the document's labels. When an admin corrects a
document, the gateway calls `PUT /documents/{doc_id}/labels` to rewrite them
in place, with no re-embedding (KB-01).

To run the worker outside Docker, start Redis (`docker compose up -d redis`) and
run, from this directory:

```powershell
uv run python -m app.worker
```

It reads `REDIS_URL`, `MONGODB_URI`, `S3_BUCKET`, `AWS_REGION` and the AWS
credentials from the root `.env`.

To stop the supporting services, run this from the repository root:

```powershell
docker compose down
```

## Run everything with Docker Compose

From the repository root, build the ingestion images on the first run or after
changing dependencies:

```powershell
docker compose build ingestion-service ingestion-worker ingestion-test
```

Start the full stack:

```powershell
docker compose up -d
```

Ollama downloads the `glm-ocr` model before the ingestion service becomes ready.
Check progress and service status with:

```powershell
docker compose logs -f ollama-pull
docker compose ps
```

View ingestion logs:

```powershell
docker compose logs -f ingestion-service ingestion-worker
```

## Run tests

Run these commands from this directory.

The normal suite uses the pytest settings in `pyproject.toml`; it skips slow,
inspection, model, and end-to-end tests, and stubs live OCR calls:

```powershell
uv run pytest
```

Run every test, including tests normally excluded by markers:

```powershell
uv run pytest -m "not slow or slow"
```

Use the real OCR service instead of the test stub by adding `--real-ocr`:

```powershell
uv run pytest -m "not slow or slow" --real-ocr
```

Real OCR requires Ollama to be running with the `glm-ocr` model. It can be slow
on CPU.

Tests marked `chroma` need the local Chroma server (`docker compose up -d
chroma`, `CHROMA_MODE=local`):

```powershell
uv run pytest -m chroma
```

### Inspect chunker output

`test_chunker.py` includes an opt-in inspection test:

```powershell
uv run pytest tests/test_chunker.py -m inspect -s --real-ocr
```

The options mean:

- `-m inspect`: run tests marked `inspect`: @pytest.mark.inspect
- `-s`: show the test's printed chunk text and metadata.
- `--real-ocr`: use the running OCR service instead of the default stub.

The inspection test also needs the fixture PDF and the local Docling model
weights. If those are unavailable, pytest reports a skip.

To run the test suite in Docker instead, use the repository root:

```powershell
docker compose run --rm ingestion-test
docker compose run --rm ingestion-test uv run pytest -q --tb=short --real-ocr
```

## Troubleshooting

### `uv` is not recognized

Install uv, restart the terminal, and confirm it is available:

```powershell
uv --version
```

### Docker cannot start or a port is already in use

Start Docker Desktop and wait until it reports that the engine is running. The
local stack uses ports `8000` (Chroma), `8001` (ingestion), and `11434`
(Ollama).

If port `11434` is occupied by Ollama Desktop, quit Ollama from the Windows
system tray before running Compose. Check the port with:

```powershell
netstat -ano | findstr ":11434"
```

### Ollama model or OCR connection fails

From the repository root, check the model pull and service:

```powershell
docker compose logs ollama-pull
docker compose exec ollama ollama list
```

Run `docker compose run --rm ollama-pull` again if `glm-ocr` is missing.

### Tests skip Docling or fixture-dependent cases

The model-based tests need the fixture PDF under
`tests/test_files/` and Docling model weights. Run `uv sync` first and allow
the first test run to download the models. For Docker tests, check that
`HUGGINGFACE_CACHE` in the root `.env` points to a valid host cache directory.

### Local code cannot connect to Chroma or Ollama

Local processes use `localhost`; Compose containers use service names such as
`chroma` and `ollama`. Start the dependencies with the local commands in
[Run locally with uv](#run-locally-with-uv), and do not copy the Compose-only
host overrides into a local shell.

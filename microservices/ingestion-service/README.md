# Ingestion service

The ingestion service parses documents, removes sensitive information, creates
chunks, and indexes them in Chroma. It runs on port `8001`.

## Prerequisites

Install:

- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for the full
  stack, local Chroma/Mongo, and (optionally) self-hosted GLM-OCR

The commands below use PowerShell. Run Docker Compose commands from the **repository
root**, not from this directory.

## First-time setup

From the repository root:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace any required `REPLACE_ME` values. Set
`COHERE_API_KEY` before running document indexing, and `ANTHROPIC_API_KEY` for
table/formula OCR (`OCR_PROVIDER=anthropic`, the default; see the OCR block in
`.env.example`).

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
docker compose --profile local-db up -d chroma
```

Skip this when `.env` uses Chroma Cloud (`CHROMA_MODE=cloud`). Table/formula OCR
calls the `OCR_PROVIDER` API, so nothing else is needed locally. For
self-hosted GLM-OCR instead, see
[Self-hosted GLM-OCR](#self-hosted-glm-ocr-optional).

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

Start the full stack. The default is cloud mode: Atlas (`MONGODB_URI`), Chroma
Cloud (`CHROMA_MODE=cloud`) and API OCR, with no Ollama. The image holds
CPU-only torch and Docling's models, so containers never download them:

```powershell
docker compose up -d
```

Add `--profile local-db` to also run local Mongo and Chroma containers:

```powershell
docker compose --profile local-db up -d
```

### Self-hosted GLM-OCR (optional)

The `docker-compose.local-ocr.yml` overlay adds Ollama with the `glm-ocr` model
(~2 GB), builds the image with the `local-ocr` extra and sets `OCR_PROVIDER=glm`.
With an NVIDIA GPU, add `docker-compose.gpu.yml` as a third `-f`:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local-ocr.yml up -d
docker compose -f docker-compose.yml -f docker-compose.local-ocr.yml logs -f ollama-pull
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

Real OCR calls the `OCR_PROVIDER` API (a few cents per document with Claude
Haiku), or Ollama's `glm-ocr` model with `OCR_PROVIDER=glm` (slow on CPU). To
send a real FM-200 table and formula crop to the provider and print the result:

```powershell
uv run pytest -m live -s tests/test_ocr_live.py
```

To compare providers on FM-200's tables (numbers scored against the PDF's own
text), see `eval/ocr/run_eval.py`.

Tests marked `chroma` need the local Chroma server (`docker compose --profile
local-db up -d chroma`, `CHROMA_MODE=local`):

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
docker compose --profile test run --rm --build ingestion-test
```

The container run skips `slow`, `inspect` and `live` tests, so it makes no paid
OCR calls.

## Troubleshooting

### `uv` is not recognized

Install uv, restart the terminal, and confirm it is available:

```powershell
uv --version
```

### Docker cannot start or a port is already in use

Start Docker Desktop and wait until it reports that the engine is running. The
local stack uses ports `8000` (Chroma, `local-db` profile), `8001` (ingestion),
and `11434` (Ollama, local-OCR overlay only).

If port `11434` is occupied by Ollama Desktop, quit Ollama from the Windows
system tray before running the local-OCR overlay. Check the port with:

```powershell
netstat -ano | findstr ":11434"
```

### OCR fails

With an API provider, check the provider's key in `.env`. A rejected key, missing
permission or unknown model fails the document with that error instead of
silently dropping its tables.

With the local-OCR overlay, check the model pull and service from the repository
root:

```powershell
docker compose -f docker-compose.yml -f docker-compose.local-ocr.yml logs ollama-pull
docker compose -f docker-compose.yml -f docker-compose.local-ocr.yml exec ollama ollama list
```

### Tests skip Docling or fixture-dependent cases

The model-based tests need the fixture PDF under
`tests/test_files/` and Docling model weights. Run `uv sync` first and allow
the first test run to download the models. Docker images already contain them
(downloaded at build time).

### Local code cannot connect to Chroma or Ollama

Local processes use `localhost`; Compose containers use service names such as
`chroma` and `ollama`. Start the dependencies with the local commands in
[Run locally with uv](#run-locally-with-uv), and do not copy the Compose-only
host overrides into a local shell.

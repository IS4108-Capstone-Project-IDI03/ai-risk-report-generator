# Run Cohere + Chroma

Cohere is a hosted API. Chroma can run locally or in Chroma Cloud. No Ollama process is needed.

## Configure

Use the existing root `.env`. If it does not exist, copy `.env.example` to `.env`.
Set `COHERE_API_KEY` to your key from [Cohere](https://dashboard.cohere.com/api-keys).
Never commit the key. Set the following in the same file:

```dotenv
EMBEDDING_MODEL=embed-v4.0
RERANK_MODEL=rerank-v3.5
CHROMA_HOST=localhost
CHROMA_PORT=8000
CHROMA_COLLECTION=risk_chunks
```

You may keep a different collection prefix already in your `.env`. Both services
append the model name and dimension to it. The models must be available to your
Cohere account. Only anonymised/synthetic text should be sent to these endpoints;
both embedding and reranking send text to Cohere.

## Shared Chroma Cloud for the team

One teammate creates the development database in the team's
[Chroma dashboard](https://trychroma.com/). Give teammates access through the
workspace and have each use their own API key. Copy the connection details from
the database's Connect panel into each person's root `.env`:

```dotenv
CHROMA_MODE=cloud
CHROMA_API_KEY=<your individual Chroma key>
CHROMA_TENANT=<team tenant ID>
CHROMA_DATABASE=<shared database name>
CHROMA_CLOUD_HOST=api.trychroma.com
CHROMA_COLLECTION=risk_team_dev
```

Use the region hostname from the Connect panel for `CHROMA_CLOUD_HOST` if it
differs. This separate setting avoids Compose's local `CHROMA_HOST=chroma`
override affecting cloud connections. `CHROMA_HOST` and `CHROMA_PORT` are only
used in local mode. Cloud credentials are required only in cloud mode.

All six teammates must use the same tenant, database, embedding model, and
collection prefix to share evidence. For experiments, use a personal prefix,
e.g. `CHROMA_COLLECTION=risk_reports_dev`, in both ingestion and RAG. Collections
organise experiments; they are not access-control boundaries. Use synthetic or
approved anonymised documents in the shared development database.

Run only ingestion and RAG locally (terminals 2 and 3 below), or in Docker:

```sh
docker compose up -d --build --no-deps ingestion-service rag-service
python3 eval/smoke_retrieval.py
```

No local Chroma server is needed in cloud mode. Restart services after changing
the environment. Local data is not automatically copied to Cloud: index the
approved documents again. `CHROMA_MODE=local` switches back to the local server.
The supplied env files default to local until cloud credentials are filled in.

See the official [Chroma client documentation](https://docs.trychroma.com/docs/run-chroma/clients).

## Local Chroma with Docker

From the repository root, with Docker running:

```sh
docker compose up -d --build chroma ingestion-service rag-service
curl -f http://localhost:8000/api/v2/heartbeat
curl -f http://localhost:8001/health
curl -f http://localhost:8002/health
python3 eval/smoke_retrieval.py
```

Compose overrides the Python services' Chroma host to `chroma`. These three
containers can run independently of MongoDB and the gateway. The health routes
check that the apps are alive; the smoke check exercises embedding, storage,
search, and reranking. It uses paid API calls and upserts two synthetic demo chunks
with fixed IDs, so it can be rerun without adding duplicate chunks.

Inspect failures with `docker compose logs ingestion-service rag-service chroma`.
A missing key raises `Set COHERE_API_KEY ...`; a Cohere authentication/rate-limit
error requires checking the key/account quota. After editing `.env`, run the
Compose command again to recreate containers with the new environment.

## Local processes without Docker

Use Python 3.11 or 3.12. Install Chroma separately from the Python services: the
full `chromadb` server and `chromadb-client` package share an import namespace
and should not be installed into the same environment.

Terminal 1, from the repo root:

```sh
python3.11 -m venv .venv
.venv/bin/pip install 'chromadb==1.5.5'
.venv/bin/chroma run --host 127.0.0.1 --port 8000 --path .chroma-data
```

Terminal 2:

```sh
cd microservices/ingestion-service
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --reload --reload-dir app --port 8001
```

Terminal 3:

```sh
cd microservices/rag-service
python3.11 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/uvicorn app.main:app --reload --reload-dir app --port 8002
```

Then run `python3 eval/smoke_retrieval.py` from the repo root. Both services load
the root `.env`; shell environment variables take precedence. Restart local
processes after changing settings. Do not start Docker and manual instances on
the same ports.

## API and limits

Inspect request schemas at `http://localhost:8001/docs` and
`http://localhost:8002/docs`. The smoke script provides a complete `/index`
request example. `/retrieve` accepts `{"query":"What flood protection is present?"}`.
See [storage conventions](areas/database.md) for metadata and upsert semantics.

This setup implements indexing pre-anonymised text and reranked retrieval.
`/ingest` is still a filename-only placeholder. `/generate` calls the new retriever,
but report generation and citation checking remain placeholders. The gateway
and frontend are not wired to these operations yet.

## Offline checks

From each of `microservices/ingestion-service` and `microservices/rag-service`:

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check .
.venv/bin/black --check .
```

These tests mock external services and require neither a Cohere key nor Chroma.

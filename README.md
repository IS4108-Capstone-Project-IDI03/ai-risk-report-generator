# A2603 — AI Risk Report Generator

Capstone project (A2603) for Marsh Singapore: an AI-powered system that generates
insurance risk reports. Users upload documents (and audio/scanned files), the system
extracts and indexes their content, and generates grounded, citation-checked risk
reports via retrieval-augmented generation.

## Architecture

The system is five independently deployable services across four tiers, communicating
over HTTP, using MongoDB, AWS S3, and Chroma in the data tier:

| Service | Role | Language | Port |
|---|---|---|---|
| `client` (S1) | React client | TypeScript (Vite) | 3000 |
| `server` (S2) | API gateway | Node/Express (TypeScript) | 4000 |
| `ingestion-service` (S3) | Parse, PII-guard, chunk, embed documents | Python/FastAPI | 8001 |
| `rag-service` (S4) | Retrieve, assemble context, generate, guardrail-check | Python/FastAPI | 8002 |
| `speech-ocr-service` (S5) | Stateless STT and OCR, returns results only | Python/FastAPI | 8003 |
| `mongo` | Local dev database (Atlas is used for staging/prod) | — | 27017 |
| `chroma` | Persistent vector database shared by ingestion and RAG | — | 8000 |

Ingestion now exposes `/index` for already anonymised text chunks, using Cohere
Embed and Chroma. RAG `/retrieve` embeds queries, searches Chroma, and reranks
with Cohere. MongoDB connectivity and the site schema are also implemented.
Raw-file ingestion, report generation, citation checks, speech/OCR, and gateway
forwarding remain placeholders; the UI is a health-check page.

See [Cohere + Chroma setup](docs/COHERE_CHROMA.md) for configuration, Docker/manual
startup, shared Chroma Cloud configuration for the team, and a live smoke check. See `docs/DECISIONS.md` for the service boundaries
and why S4 uses a single orchestrator function.

## Running the stack locally

One `.env.example` covers both run modes — pick one per session, don't mix them
for the same service.

**Docker (all five services + Mongo + Chroma, one command):**
```
cp .env.example .env   # fill in the real values
docker-compose up --build
```

**Manual (bare processes, faster iteration, one terminal per service):** copy
`.env.example` to `.env` in each service's own directory (`server/.env`,
`microservices/rag-service/.env`, etc.), fill in real values, then run each service's own
dev command (`npm run dev` for client/server, `uvicorn app.main:app --reload
--port <port>` for the Python services).

`.env.example`'s `*_SERVICE_URL` vars default to `localhost`, which is what
the manual run mode needs. Docker instead needs Docker service names
(`http://rag-service:8002`) — `docker-compose.yml` overrides those three vars
for the `server` container automatically, so the same `.env` file works
either way without editing. See `CLAUDE.md` "Known pitfalls" for why.

Either way, each of the five health endpoints should then be reachable at
`http://localhost:<port>/health` (or `/api/health` for the gateway).

## Branch and commit convention

- Branches: `feature/<initials>-<story-id>` (e.g. `feature/cg-F-01`)
- Commits must reference the story ID: `feat(F-01): init repo`

This README must reflect the current architecture. If a PR changes what is true here, update this file in the same PR — not later.

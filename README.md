# A2603 — AI Risk Report Generator

Capstone Project (A2603) for Marsh Singapore: An AI-powered system that generates
insurance risk reports. Users upload documents (and audio/scanned files), the system
extracts and indexes their content, and generates grounded, citation-checked risk
reports via retrieval-augmented generation.

## Architecture

The system is five independently deployable services across four tiers, communicating
over HTTP, using MongoDB, AWS S3, and Chroma in the data tier:

| Service | Role | Language | Port |
| --- | --- | --- | --- |
| `client` (S1) | React client | TypeScript (Vite) | 3000 |
| `server` (S2) | API gateway | Node/Express (TypeScript) | 4000 |
| `ingestion-service` (S3) | Parse, PII-guard, chunk, embed documents | Python/FastAPI | 8001 |
| `rag-service` (S4) | Retrieve, assemble context, generate, guardrail-check | Python/FastAPI | 8002 |
| `speech-ocr-service` (S5) | Stateless STT and OCR, returns results only | Python/FastAPI | 8003 |
| `mongo` | Local dev database (Atlas is used for staging/prod) | — | 27017 |
| `chroma` | Persistent vector database shared by ingestion and RAG | — | 8000 |

## Current implementation

### Backend

Ingestion now exposes `/index` for already anonymised text chunks, using Cohere
Embed and Chroma. RAG `/retrieve` embeds queries, searches Chroma, and reranks
with Cohere. MongoDB connectivity and the site schema are also implemented. The
gateway creates assessments at `POST /api/assessments` and starts or resumes an
assessment's capture session at `POST /api/assessments/:reference/capture-session`.
Raw-file ingestion, report generation, citation checks, speech/OCR, and gateway
forwarding remain placeholders.

### Frontend demo

The UI follows the Marsh design system and includes sign-in, the assessment
dashboard, observations, generation, review, and simulated export. It runs without
a backend and keeps demo changes in memory only. Refreshing or signing out resets
the demo; authentication and export are simulated.

Creating an assessment and capturing on site are the exceptions. New assessment
saves the assessment through the gateway; opening it from the dashboard starts its
capture session on the Site observation screen. Site observation opened from the
sample workspace captures for `RPT-2026-0411`; seed that assessment with
`npm --prefix server run seed`. Without the gateway, a new assessment is kept in
the demo only and capture shows sample data, and both say so. Saved observations
are still memory-only, and the dashboard does not yet list assessments from the
server, so created assessments are gone after a refresh (RV-10).

## Running the stack locally

One `.env.example` covers both run modes — pick one per session, don't mix them
for the same service.

### UI demo only

```sh
npm --prefix client ci
npm --prefix client run dev
```

Open `http://localhost:3000`. Use a sample email such as `demo@marsh.com` and any
non-empty sample password.

### Docker

Start all five services, MongoDB, and Chroma:

```sh
cp .env.example .env   # fill in the real values
docker-compose up --build
```

### Manual services

Use one terminal per service. Copy `.env.example` to `.env` in each backend
service's own directory (`server/.env`,
`microservices/rag-service/.env`, etc.), fill in real values, then run each service's own
dev command: `npm run dev` for client/server, or
`uvicorn app.main:app --reload --port <port>` for the Python services.

See [Running the stack](docs/RUNNING.md) for the full setup instructions.

### Service URLs and health checks

`.env.example`'s `*_SERVICE_URL` vars default to `localhost`, which is what
the manual run mode needs. Docker instead needs Docker service names
(`http://rag-service:8002`) — `docker-compose.yml` overrides those three vars
for the `server` container automatically, so the same `.env` file works
either way without editing. See `CLAUDE.md` "Known pitfalls" for why.

The Python services expose `http://localhost:<port>/health`. The gateway exposes
`http://localhost:4000/api/health`, and the client opens at `http://localhost:3000`.

## Documentation

- [Running the stack](docs/RUNNING.md) — Docker and manual setup.
- [Cohere + Chroma setup](docs/COHERE_CHROMA.md) — configuration and retrieval smoke checks.
- [Design system](docs/design-system.md) — visual foundations and shared component inventory.
- [UI conventions](docs/areas/ui.md) — guidance for future screens.
- [Architecture decisions](docs/DECISIONS.md) — service boundaries and implementation choices.

## Branch and commit convention

- Branches: `feature/<initials>-<story-id>` (e.g. `feature/cg-F-01`)
- Commits must reference the story ID: `feat(F-01): init repo`

This README must reflect the current architecture. If a PR changes what is true here, update this file in the same PR — not later.

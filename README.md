# A2603 — AI Risk Report Generator

Capstone Project (A2603) for Marsh Singapore: An AI-powered system that generates
insurance risk reports. Users upload documents (and audio/scanned files), the system
extracts and indexes their content, and generates grounded, citation-checked risk
reports via retrieval-augmented generation.

## Architecture

The system is five independently deployable services across four tiers, communicating
over HTTP, sharing a MongoDB Atlas cluster and an AWS S3 bucket in the data tier:

| Service | Role | Language | Port |
|---|---|---|---|
| `client` (S1) | React client | TypeScript (Vite) | 3000 |
| `server` (S2) | API gateway | Node/Express (TypeScript) | 4000 |
| `ingestion-service` (S3) | Parse, PII-guard, chunk, embed documents | Python/FastAPI | 8001 |
| `rag-service` (S4) | Retrieve, assemble context, generate, guardrail-check | Python/FastAPI | 8002 |
| `speech-ocr-service` (S5) | Stateless STT and OCR, returns results only | Python/FastAPI | 8003 |
| `mongo` | Local dev database (Atlas is used for staging/prod) | — | 27017 |

Each service is currently scaffolded with stub routes only — the folder structure
(routes/services/models separation in `server`, `api`/pipeline/orchestrator layout in
the Python services) is in place, every route responds, but no route has real
business logic yet (parsing, retrieval, generation, STT/OCR are all placeholders).
Real logic lands service-by-service as the project progresses. See `docs/DECISIONS.md`
for why this is microservices rather than a monolith, and why S4 uses a single
orchestrator function rather than choreography.

## Running the stack locally

One `.env.example` covers both run modes — pick one per session, don't mix them
for the same service.

**Docker (all five services + Mongo, one command):**
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

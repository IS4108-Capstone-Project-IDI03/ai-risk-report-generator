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
It lists assessments with their status at `GET /api/assessments`, and records
observations (any of a note, recordings and JPG or PNG photos, each file kept in
S3 as raw evidence) against the capture session in progress. S5 transcribes each
recording with Whisper and reads an observation's photos with Gemini, proposing
a description, category and hazard type for the engineer to review (CP-05); the
proposal is never drafting evidence.
An observation's tags (category, severity, location, standard) and note change at
`PATCH /api/observations/:id`; a finished transcript can be corrected, keeping
what Whisper wrote; and an observation can be deleted and restored, a soft
delete that drafting leaves out. Only the assessment's assigned engineer can
make these changes (CP-08). S5's OCR endpoint and the free-text `/api/rag/generate`
route remain placeholders.

### Frontend demo

The UI follows the Marsh design system and includes sign-in, the assessment
dashboard, observations, generation, review, and simulated export. Demo changes
are kept in memory only; refreshing or signing out resets them, and export is
simulated.

Sign-in is real (F-04): the form checks the credentials with the gateway, which
sets an httpOnly session cookie, so the gateway must be running. Each screen has
its own URL, and the role on the account decides which ones open (F-05): a risk
engineer runs assessments and capture; a knowledge admin manages the knowledge
base and user accounts (adding them and assigning roles, F-08) and can read assessments. A screen the
role may not open says so instead of loading, and the gateway answers 403 to the
API calls behind it. The matrix is in
`server/src/services/permissions.service.ts`.

Creating an assessment, the dashboard list and capturing on site are the
exceptions. The dashboard lists assessments from the gateway, with the sample
rows as a fallback when it cannot be reached, and shows only the assessments
the engineer is assigned to. New assessment saves the assessment through the
gateway; opening it from the dashboard opens its workspace, and Site observation
from there starts its capture session. Only `RPT-2026-0411` has sample workspace
content; seed it with `npm --prefix server run seed`. Without the gateway, a new assessment is kept in
the demo only and capture shows sample data, and both say so. Capture starts by
choosing or adding the location on site. With a capture
session live, an observation's note, recordings and photos are saved through the
gateway together: the note exactly as typed, each recording stored in S3
and transcribed by S5 with OpenAI Whisper (set `OPENAI_API_KEY`), and the
photos stored in S3 and read together by S5 with Gemini (set a paid-tier
`GEMINI_API_KEY`), whose proposal shows on the observation for the engineer to
use as its note or category through Edit (CP-05). An
observation may be left uncategorised. On the
Observations tab (CP-08), each row shows the observation's type, category,
location, severity, status and capture time, and the list filters by any of
them. An expanded observation offers Edit (its tags and note, saved together), Correct transcript
(for a finished one, keeping what Whisper wrote) and Delete; Show deleted lists
deleted ones to restore. These go through the gateway for a saved observation,
to its assigned engineer only, and stay in the demo for a sample one. A saved assessment drafts sections 7-12 on Report generation (GN-01), and
its Review tab is the review workspace (RV-01): each section's completion and
review state, its draft, and beside it each cited passage with its page,
document title, edition, effective date and any withdrawal, the original
observations and every claim.

## Running the stack locally

One `.env.example` covers both run modes — pick one per session, don't mix them
for the same service.

### Client with a local gateway

```sh
npm --prefix server ci
npm --prefix server run seed   # sample accounts, password `password123`
npm --prefix server run dev
npm --prefix client ci
npm --prefix client run dev
```

Open `http://localhost:3000` and sign in as a seeded account, e.g.
`alex.rowe@example.com` (risk engineer) or `sana.patel@example.com` (knowledge
admin), with the dev password `password123`.

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

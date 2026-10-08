# A2603 — CLAUDE.md
<!-- Keep this file SHORT. No explanations of what FastAPI or Express are.
     Only: exact commands, exact paths, hard rules, and real pitfalls from
     this specific project. -->

## Setup commands
<!-- Add the exact commands to spin up the stack here once confirmed. -->

## Key paths
| What | Where |
|---|---|
| API gateway entry | server/src/index.ts |
| RAG orchestrator | microservices/rag-service/app/orchestrator/orchestrator.py |
| Ingestion pipeline | microservices/ingestion-service/app/pipeline/ |
| Mongo schemas | server/src/models/ |
| Env vars | .env.example (never commit .env) |

## Hard rules
- Never commit `.env` or any file containing a real API key.
- Route handlers in `/server/src/routes/` must never import from `models/`
  directly — always go through `services/`.
- S5 (speech-ocr-service) writes nothing to MongoDB — it returns results only.
- LLM provider is set by `LLM_PROVIDER` env var in microservices/rag-service, and
  the photo-interpretation provider by `VISION_PROVIDER` in S5 (CP-05) — never
  hardcode "anthropic" or "gemini" in application code.
- All metadata fields on a MongoDB document must include: source_type,
  jurisdiction, facility_type, COPE_dimension, effective_date. See
  docs/areas/database.md before writing any new schema. One exception: an
  uncategorised observation stores `COPE_dimension: null` (present, but
  null), which keeps it out of category-scoped drafting (CP-02).

## Known pitfalls
<!-- One line each: what went wrong → why → how to avoid.
     Add entries here as they happen, not speculatively. -->
- `server`'s other-service URLs differ by run mode → Docker containers resolve
  each other by service name, bare local processes don't → `.env.example`'s
  `*_SERVICE_URL` vars default to `localhost` (for manual `npm run dev`), and
  `docker-compose.yml`'s `server` entry overrides them to Docker service names
  (`environment:` beats `env_file:` in Compose) so one `.env` file works for
  both run modes. If you add a new inter-service URL var, add the override
  to `docker-compose.yml` too, or it'll silently use the wrong host in
  containers.

## Pointers — read these before touching the relevant area
- Database schema & vector index → docs/areas/database.md
- UI conventions → docs/areas/ui.md
- AWS / deployment → docs/areas/cloud.md
- Service internals (ingestion, RAG, speech) → docs/areas/services.md
- Architecture decisions → docs/DECISIONS.md

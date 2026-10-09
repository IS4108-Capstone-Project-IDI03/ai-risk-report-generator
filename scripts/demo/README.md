# EV-01 demo data (dev only, fake)

Shows every EV-01 result on **Leeds Cold Store (RPT-2026-0408)** as `alex.rowe@example.com` / `password123`.

1. `docker compose up -d`, then `docker compose exec server npm run seed`
2. `docker compose exec -T mongo mongosh riskreport --quiet < scripts/demo/ev01-draft.js`
3. `docker compose exec -T rag-service python - < scripts/demo/ev01-chroma.py`
4. Sign in, open Leeds Cold Store, **Validation and export**, **Run checks**.

Remove the fake passages: `docker compose exec -T rag-service python - clean < scripts/demo/ev01-chroma.py`.
The draft is inserted by script, not written by the AI, so it costs nothing. Never run these against a shared database.

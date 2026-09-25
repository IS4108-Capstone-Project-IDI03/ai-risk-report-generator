# Running the stack — local vs Docker

Two ways to run the 5 services (`client`, `server`, `ingestion-service`,
`rag-service`, `speech-ocr-service`) + `mongo` + `chroma`. Same `.env.example` drives
both — see `CLAUDE.md` "Known pitfalls" for why `*_SERVICE_URL` differs
between them.

For Cohere/Chroma configuration and the retrieval smoke check, follow
[Cohere + Chroma setup](COHERE_CHROMA.md).

## Before either mode: check iCloud isn't syncing the project

If the project is under `~/Desktop`/`~/Documents` and iCloud's "Desktop &
Documents Folders" sync is on, installing dependencies creates thousands of
small files iCloud's sync hangs, so move your local repo to another place outside of iCloud's reach like `~/Projects` instead.
---

## Mode A — Local (bare processes)

Fastest iteration loop; use while actively editing one service.

### 1. The three Python microservices

**What/why:** each is a standalone FastAPI app with zero shared state — start
and health-check them first since nothing else depends on them existing.
For each of `microservices/{ingestion-service,rag-service,speech-ocr-service}`
(own venv per service — installing in one does not affect the others):

```
cd microservices/<service-name>
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"       # rest of the declared deps
uvicorn app.main:app --reload --reload-dir app --port <8001|8002|8003>
```

`--reload-dir app` matters: without it, `--reload`'s watcher covers the
whole service directory including `.venv/`, and ends up watching its own
freshly-installed dependencies — reload-loops forever.

Verify: `curl -s localhost:<port>/health`.

### 2. Local Mongo

**What/why:** `server` needs a real, reachable Mongo before it will finish
booting (`connectDb()` is awaited before the app starts listening) — bring
just that one container up rather than the whole stack:

```
docker-compose up -d mongo
```

### 3. `server`

**What/why:** confirms the gateway boots and connects to Mongo. Its config loads
the root `.env` relative to the source file. From the repository root, create
`.env` from `.env.example` if needed, preserving any existing credentials.

Edit the root `.env`:

```
MONGODB_URI=mongodb://localhost:27017/a2603
JWT_SECRET=any-random-32-plus-character-string
INGESTION_SERVICE_URL=http://localhost:8001
RAG_SERVICE_URL=http://localhost:8002
SPEECH_OCR_SERVICE_URL=http://localhost:8003
```

(Match the three URLs to whatever ports you actually started the
microservices on in step 1 — `server` doesn't validate these are real, only
that they're non-empty. If `localhost` ever stalls oddly on connect, try
`127.0.0.1` instead — macOS occasionally resolves `localhost` to IPv6 first.)

```
cd server
npm run dev
curl -s localhost:4000/api/health
```

**Using the shared Atlas cluster instead of local Mongo:** set `MONGODB_URI`
to the team's `mongodb+srv://` string and skip step 2. Atlas only accepts
allow-listed IPs: in Atlas, open Network Access → Add IP Address → Add
current IP address (the cluster owner may have to do this). Campus networks
such as NUS Wi-Fi can block MongoDB's port 27017; if the server still times
out after your IP is added, try a phone hotspot. `npm run seed` then writes
sample records, including four user accounts, to the shared database, and any
edits made in the UI change them for everyone.

### 4. `client`

**What/why:** the interactive UI demo runs independently of the backend. No `.env`
is needed. `vite.config.ts` still proxies `/api` to `server` for future integration.

```
cd client
npm run dev
```

Open `http://localhost:3000`, confirm the Marsh sign-in screen appears. Use a sample email such as `demo@marsh.com`
and any non-empty sample password to enter the demo. Refresh or sign out to reset.

---

## Mode B — Docker (full stack)

Use before a PR/demo, or to catch anything environment-specific that local
mode wouldn't surface.

### 1. Root `.env`

**What/why:** Docker Compose's `env_file: .env` on each service resolves
relative to `docker-compose.yml` — the project root, not each service's own
folder — so one `.env` at the root covers all 7 containers:

```
cp .env.example .env
```

Edit the root `.env`:

```
MONGODB_URI=mongodb://mongo:27017/a2603
JWT_SECRET=any-random-32-plus-character-string
```

Use `mongo:27017`, not `localhost:27017`: containers are created relative
to where `docker-compose.yml` and `.env` live, and Docker runs its own
internal DNS — resolving each service by its container/service name
(`mongo`, `server`, `rag-service`, ...) instead of `localhost`. Leave the
three `*_SERVICE_URL` vars as their `localhost` defaults — `server`'s and
`client`'s blocks in `docker-compose.yml` already override them to the
Docker names automatically.

### 2. Bring the whole stack up

**What/why:** one command builds and starts all 7 containers in dependency
order:

```
docker info > /dev/null 2>&1 && echo "daemon up" || echo "daemon NOT running"
docker-compose up --build
```

### 3. Verify each service booted, not just its container

**What/why:** a container can show `Up` while the process inside crashed —
health-checking each app confirms the process layer, not just the
container layer:

```
docker compose ps                      # all 7 should show Up
curl -s localhost:4000/api/health
curl -s localhost:8001/health
curl -s localhost:8002/health
curl -s localhost:8003/health
```

Open `http://localhost:3000` — confirm the Marsh sign-in screen appears. Gateway health remains available at `/api/health`.

### 4. Prove containers reach each other, not just your Mac reaching them

**What/why:** curling a published port from your Mac only proves the port
mapping works. This proves Docker's internal network actually resolves one
container from inside another:

```
docker compose exec server wget -qO- http://ingestion-service:8001/health
docker compose exec server wget -qO- http://rag-service:8002/health
docker compose exec server wget -qO- http://speech-ocr-service:8003/health
```

(`wget`, not `curl` — the Alpine-based images don't ship `curl`.)

---

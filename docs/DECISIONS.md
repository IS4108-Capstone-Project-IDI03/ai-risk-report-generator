# Architecture decisions

## 2026-09-07 — Five-service microservices, not a monolith
Chose: five independently deployable services (S1–S5) across four tiers.
Rejected: modular monolith (single deployable). Reason: prof's marking rubric
explicitly requires SOA/microservices backend; microservices also give
independent scaling and fault isolation per service.
Story: F-01 (repo and branching setup).

## 2026-09-07 — Orchestration inside S4, not choreography
Chose: a single controller function in microservices/rag-service/app/orchestrator/orchestrator.py calls
retrieve → assemble → generate → guardrail-check as plain function calls.
Rejected: choreographed event-driven agents. Reason: our evaluation harness
(EV-01–EV-04) needs end-to-end trace of a single pipeline run; choreography
makes that significantly harder to reconstruct. Six-person team with limited
DevOps capacity also can't afford the message broker infrastructure.
Story: RT-01, GN-01.

## 2026-09-07 — npm as the only package manager
Chose: npm everywhere (client, server, root, CI, Dockerfiles).
Rejected: yarn, which the repo started with. Reason: the repo had drifted
into both — yarn.lock files alongside npm-based CI — and mixed lockfiles
mean CI and laptops resolve different dependency trees. npm ships with
Node, so it needs no extra install step in CI or in a container.
Story: F-03.

## 2026-09-07 — CI supplies dummy env vars rather than mocking config
Chose: the server test job sets throwaway env values in the workflow.
Rejected: making config lazy, or mocking it in tests. Reason: config.ts
validates env at import time on purpose, so the server can never boot
half-configured. Weakening that to suit tests would trade a production
safety property for test convenience. Nothing in CI connects out.
Story: F-03.

## 2026-09-13 — Cohere retrieval with shared Chroma

Use Cohere Embed (`embed-v4.0`, 1024 dimensions) and Rerank (`rerank-v3.5`),
with one persistent Chroma HTTP server shared by ingestion and RAG. This
implements the requested Cohere/Chroma setup and replaces the planned Atlas
Vector Search role. MongoDB retains application records; S3 retains original
files. Use direct SDK calls inside existing services, without an additional
retrieval service or framework. Raw-file processing and report generation remain
separate unfinished work. See `docs/COHERE_CHROMA.md`.

## 2026-09-23 — Server tests run against an in-memory mongod

Chose: `mongodb-memory-server-core` starts a real, throwaway mongod for
server tests that touch MongoDB.
Rejected: mocking Mongoose, or adding a Mongo service container to CI.
Reason: capture sessions rely on a partial unique index and duplicate-key
handling that only a real database exercises; mocks would pass while the
index was wrong. The in-process server keeps the CI workflow unchanged. The
`-core` package downloads the binary on first test run, not on install, so
the Alpine server image (which runs `npm install`) is unaffected. The first
local run on Windows downloads roughly 800 MB into `~/.cache/mongodb-binaries`
(Linux, as in CI, is far smaller); set `MONGOMS_SYSTEM_BINARY` to an installed
mongod to skip the download.
Story: CP-01.

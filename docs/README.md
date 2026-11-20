# Documentation map

Docs go from short to deep. Start at the top and stop when you have what you need.

## Read in this order

| Step | Read | You learn |
|---|---|---|
| 1 | [README.md](../README.md) (repo root) | What the app does, the six services, how to run it |
| 2 | The README inside the service you work on (table below) | That one service, in about 5 minutes |
| 3 | [areas/](./areas/) | The deep reference: every record, every feature's internals, and the design system |
| 4 | [devguides/DECISIONS.md](./devguides/DECISIONS.md) | Why something was built the way it was |

## Where each document lives

| Folder or file | What it holds | Open it when |
|---|---|---|
| `README.md` (root) | The whole app on one page | You are new |
| `client/README.md`, `server/README.md`, `microservices/*/README.md` | One README per service | You work on that service |
| `docs/devguides/RUNNING.md` | Running the stack: plain processes or Docker | You set up a machine |
| `docs/devguides/COHERE_CHROMA.md` | Cohere and Chroma setup, limits | Search does not work |
| `docs/areas/database.md` | Every MongoDB record, field by field | You change or read data |
| `docs/areas/services.md` | How each feature works inside the services | You change a feature |
| `docs/areas/privacy.md` | How client details are hidden from outside AI | You send text to an AI |
| `docs/areas/cloud.md` | AWS: EC2, S3, nginx, deploy, cost | You deploy |
| `docs/areas/ui.md` | Rules for new screens | You build a screen |
| `docs/areas/design-system-v2.md` | The one design system (rules, then inventory) | You touch any UI |
| `docs/devguides/DECISIONS.md` | Dated log of decisions | You ask "why?" |
| `docs/devguides/USER_STORIES.md` | The backlog, by epic | You look up a story |
| `CLAUDE.md`, `AGENTS.md` | Rules for people and coding agents | Before you change code |

## Rules for keeping this tidy

1. **One home per fact.** If two files say the same thing, keep one and link to it.
2. **Every long file starts short.** A 30-second summary, then contents, then detail.
3. **A change that makes a doc untrue updates the doc in the same PR.**
4. Files that code reads at runtime (`rag-service/app/generation/*-skill.md`) are not documentation. Do not move or delete them.

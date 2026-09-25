# Storage and retrieval

- MongoDB stores application records: sites, assessments and capture sessions today; document/report records are planned.
- AWS S3 stores original uploaded files.
- Chroma stores anonymised chunk text, vectors, and citation/filter metadata. Chroma replaces the planned Atlas Vector Search role.

Ingestion and RAG connect to one Chroma database. `CHROMA_MODE=local` uses
the local HTTP server; `CHROMA_MODE=cloud` uses Chroma Cloud with
`CHROMA_API_KEY`, `CHROMA_TENANT`, `CHROMA_DATABASE`, and `CHROMA_CLOUD_HOST`.
See [team setup](../COHERE_CHROMA.md#shared-chroma-cloud-for-the-team). Docker persists its data in
`chroma-data:/data`; `docker compose down` keeps it, `down -v` deletes it.
The Chroma server and Python HTTP clients are pinned to 1.5.5.

Both services read the root `.env` locally and process environment in Docker:
`COHERE_API_KEY`, `EMBEDDING_MODEL=embed-v4.0`, `CHROMA_HOST`, `CHROMA_PORT`,
and `CHROMA_COLLECTION`. RAG also uses `RERANK_MODEL=rerank-v3.5`.
Embeddings use 1024 float dimensions and cosine distance. The actual collection
name is `<CHROMA_COLLECTION>_<EMBEDDING_MODEL>_1024`; switching models selects a
new collection and requires re-indexing. Do not point at an existing collection
containing vectors from another model. Reranker changes do not require re-indexing.

`POST /index` accepts 1–96 already anonymised chunks, each with a unique stable
`id`, nonblank `text` (at most 8,000 characters), and `metadata`:
`document_id`, `source_type`, `jurisdiction`, `facility_type`, `COPE_dimension`,
`effective_date`, and positive integer `page`. Use document/version/chunk IDs to
avoid collisions. Upsert makes retrying identical IDs safe; it does not remove
old IDs when a document is revised or shortened. Document replacement/deletion
must be implemented with the future raw-file ingestion lifecycle.

`POST /retrieve` embeds the query, searches up to 20 candidates, and returns up
to 5 Cohere-reranked results with ID, text, metadata, vector distance, and relevance
score. An absent/empty collection returns no results; dependency failures propagate
as errors rather than pretending retrieval succeeded. Metadata is stored for
future filtering; the initial endpoint searches the whole collection.

The current direct endpoints are for local development with synthetic or already
anonymised text. Raw-file parsing, automatic anonymisation, gateway auth, and
per-user evidence filtering are not implemented. Compose binds Chroma and these
Python service ports to loopback; do not expose them publicly as-is.

## Assessments and capture sessions

`assessments` holds a unique `reference` (the report ID shown in the UI, e.g.
`RPT-2026-0411`), a `site` reference, `client`, optional `policyReference`,
`surveyType`, optional `siteVisitDate` and `reportDueDate`, and the selected
`standards` and `engineers` (names for now; the first engineer is the lead).
Extend it rather than creating a parallel assessment schema.

`POST /api/assessments` creates an assessment and a new site for it (the site
gains an optional `address`). The body is validated with Zod; a 400 returns
`{ error, fields }`, where `fields` maps each invalid path (e.g. `site.name`) to
its first problem. `jurisdiction` is a two-letter code (`SG`, `MY`, `UK`, …)
because retrieval filters on it. The server allocates the reference
`RPT-<year>-<nnnn>` and the site code `SITE-<nnnn>` from atomically incremented
`counters` documents (`assessment:<year>`, `site`), skipping any code already
in use, such as a seeded one. Dev and test MongoDB are standalone servers without
transactions, so if the assessment insert fails, the new site is deleted by hand.

`capture_sessions` records each on-site capture for an assessment, with
`status` `active` or `ready_for_generation` (set by CP-14). A partial unique
index on `assessment` where `status: 'active'` allows at most one active
session per assessment, so concurrent requests cannot start two. Completed
sessions fall outside the index and are kept as history.

`POST /api/assessments/:reference/capture-session` returns the active session
(200) or starts one (201), together with the assessment's reference, client and
site for the capture screen. Assessments are addressed by `reference`, the ID the
client already holds, not by ObjectId. An unknown reference returns 404. The
gateway does not authenticate this route yet (F-04).

An assessment's status is stored only once a report exists: `reportStatus` is
`draft`, `under_review` or `finalised`, set by the generation and sign-off
stories. Before that it is derived from the latest capture session rather than
copied onto the assessment, so there is one source of truth:

| Status | Comes from |
| --- | --- |
| `not_started` | no capture session |
| `capturing` | latest session `active` |
| `ready_to_generate` | latest session `ready_for_generation` |
| `draft` / `under_review` / `finalised` | `reportStatus`, which wins when set |

`GET /api/assessments` returns every assessment with its derived `status`, most
recent site visit first, in two queries (assessments, then their sessions). The
dashboard filters and searches it in the browser (RV-10) and shows only the
assessments whose `engineers` include the signed-in user. That user is fixed
until accounts exist (F-04); the gateway does not paginate or filter by user yet.

References: [Chroma Docker](https://docs.trychroma.com/guides/deploy/docker),
[Cohere RAG](https://docs.cohere.com/docs/rag-complete-example).

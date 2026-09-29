# Storage and retrieval

- MongoDB stores application records: sites, assessments, capture sessions and user accounts today; document/report records are planned.
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

## User accounts

`users` holds one profile per team member (F-03): a unique, fixed `staffId`
(`MRE-0001`), `name`, a unique lowercased `email`, `role`
(`risk_engineer`, `reviewer` or `knowledge_admin`), optional `jobTitle`,
`phone` and `office` (a two-letter jurisdiction code), and `active`. There are
no passwords; sign-in arrives with F-04, which should extend this collection
rather than add a parallel one.

`GET /api/users` lists accounts by name and `GET /api/users/:id` returns one
(404 for an unknown or malformed ID). `PUT /api/users/:id` replaces the whole
editable profile; optional fields sent as `''` are removed. Invalid input
returns 400 `{ error, fields }` like assessments, and an email another account
uses returns 409 with `fields.email`. `staffId` cannot be changed. The gateway
does not yet restrict these routes to knowledge admins (F-04).

`npm --prefix server run seed` inserts four sample accounts (`MRE-0001` to
`MRE-0004`, `example.com` emails) only when their staff ID is missing, so
re-seeding keeps edits made on screen. Against the shared Atlas cluster, those
edits are visible to the whole team.

## Observations

`observations` holds voice notes; notes and photos are still browser-only. The
original audio goes to S3 at `audio/<reference>/<observation id>.<ext>`; the
document keeps the key, content type and size, never the audio. Each document
links to its `assessment` and the capture `session` it was recorded in, the
recording `engineer` (a name until F-04), and `metadata` with the five required
fields: `source_type: 'voice'`, `jurisdiction` and `facility_type` copied from
the site, `COPE_dimension` from the COPE category the engineer picked
(`Construction`, `Occupancy`, `Protection` or `Exposure`, the same values the
knowledge base uses), and `effective_date` (when it was recorded). `severity`
(`critical`, `high`, `moderate` or `low`) is required; `area` (the location on
site) and `standard` are optional. `standard` is the standard the engineer tied
the note to (e.g. `NFPA 25 – 2026 Edition`); only the standard is stored, and
the draft finds the clause.

`transcription.status` is `transcribing`, `transcribed` (with `transcript`) or
`failed` (with `error`, the reason shown to the engineer). `attempts` records
each run with its start, finish and error. Saving a recording creates exactly
one attempt; a retry adds one only while the status is `failed`, using an
atomic update so two clicks cannot start two. Saving leaves the capture session
`active`.

| Route | Does |
| --- | --- |
| `POST /api/assessments/:reference/observations/voice` | Body is the audio with its own `Content-Type`, up to 25 MB; `X-Engineer` names the engineer, `X-COPE-Dimension` gives the category and `X-Severity` the severity; the optional `?area=` and `?standard=` query values hold the location and standard (a query, since they are not plain ASCII). 201, or 400 (missing engineer, category or severity) / 404 / 409 (no active session) / 413 / 415 |
| `GET /api/assessments/:reference/observations` | The assessment's voice notes, newest first |
| `POST /api/observations/:id/transcription/retry` | New attempt for a failed note: 202, or 404 / 409 |
| `GET /api/observations/:id/audio` | Streams the original recording from S3 |

## Knowledge documents (IN-01)

`knowledge_documents` holds one record per accepted upload. Its `_id` is the
permanent document identifier; chunk ids in Chroma are `<_id>:<n>`. The admin
enters `title`, `issuingBody` and `edition`; `fileName` is the original name.
The unaltered PDF is in S3 at `knowledge/<_id>.pdf`; the record keeps `file`
(`key`, `contentType`, `size`, `sha256`). `metadata` has the five required
fields: `source_type` (`fm_standard`, `nfpa_standard` or `marsh_report`),
`jurisdiction` (two-letter code), `facility_type` (`all` unless the admin picks
one), `COPE_dimension` (`all`, since a whole standard spans every dimension)
and `effective_date`.

`status` is `queued` (set by the gateway), then `processing`, `complete` (with
`result`: `chunksIndexed`, `tablesCaptured`, `imagesCaptured`) or `failed`
(with `error`, the reason shown to the admin), all set by the ingestion worker,
which also records `startedAt` and `finishedAt`. Rejected uploads are never
stored.

| Route | Does |
| --- | --- |
| `POST /api/knowledge-documents` | Body is the PDF (`Content-Type: application/pdf`, up to 100 MB); `fileName`, `title`, `issuingBody`, `edition`, `effectiveDate`, `sourceType`, `jurisdiction` and optional `facilityType` are query values. 201 queued, or 400 `{ error, fields }` / 413 / 415 / 422 / 503, each with `error` giving the reason |
| `GET /api/knowledge-documents` | Every accepted document with its status, newest first |
| `GET /api/knowledge-documents/:id/file` | Streams the original PDF from S3; 404 for an unknown ID |

References: [Chroma Docker](https://docs.trychroma.com/guides/deploy/docker),
[Cohere RAG](https://docs.cohere.com/docs/rag-complete-example).

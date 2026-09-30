# Storage and retrieval

- MongoDB stores application records: sites, assessments, capture sessions, observations and user accounts today; document/report records are planned.
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

`locations` lists the places on site the engineer records observations in, as
the engineer adds them during capture: each has an `_id`, a `name` (up to 100
characters), and an optional `floor` (up to 40), plus a
`key` of the lowercased name and floor. They are embedded because the list is
short and always read with its assessment. `POST
/api/assessments/:reference/locations` (JSON `name`, `floor`) returns
201, 400 `{ error, fields }`, 404, or 409 with `fields.name` when the same name
and floor is already listed; matching on `key` in the same update keeps two
taps from adding it twice. `GET` on the same path lists them in the order they
were added. Adding one needs no capture session. `DELETE
/api/assessments/:reference/locations/:id` removes one added by mistake: 204,
404, or 409 while any observation is saved there, so no observation loses its
location; editing an observation's tags (CP-06) moves it elsewhere. `npm --prefix server run seed`
gives `RPT-2026-0411` six sample locations when it has none.

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

`observations` holds one document per observation: one thing the engineer saw
on site, with everything captured about it. It has an optional `note` (CP-02)
and a `recordings` list (CP-03), and needs at least one of them. Photos are
still browser-only placeholders; CP-04 should add a `photos` list to the same
document rather than a new collection.

Each document links to its `assessment` and the capture `session` it was
recorded in, the `engineer` who captured it (a name until F-04), and `metadata`
with the five required fields: `source_type` (`observation`), `jurisdiction`
and `facility_type` copied from the site, `COPE_dimension` from the COPE
category the engineer picked (`Construction`, `Occupancy`, `Protection` or
`Exposure`, the same values the knowledge base uses), and `effective_date`
(when it was captured). `createdAt` is the capture timestamp. `severity`
(`critical`, `high`, `moderate` or `low`) and `location` (the `_id` of one of
the assessment's `locations`) are required; `standard` is optional. `standard` is the standard the engineer tied
the observation to (e.g. `NFPA 25 – 2026 Edition`); only the standard is
stored, and the draft finds the clause. The category, severity, location and
standard are stored once and cover the note and every recording. The location
is stored by id rather than name, so renaming a location later does not split
its observations; responses include it as `location: { id, name, floor }`.

`note` is stored exactly as written, untrimmed, up to 5,000 characters; a blank
note counts as none. An observation may be saved uncategorised: its
`COPE_dimension` is then `null`, present but null rather than left out.
`listCategoryObservations` in `observation.service.ts`, the category-scoped
drafting inputs for GN-01, matches on `COPE_dimension`, so an uncategorised
observation stays out of drafting until it is categorised by editing its tags.

The category, severity, location and standard are the observation's tags
(CP-06). `PATCH /api/observations/:id` changes any of them in place, validated
against the same values as capture, and leaves the note, recordings and capture
time as they are. Nothing keeps the previous tags: no draft cites an observation
yet, and corrections that keep the prior version are CP-08. There is no zone
field: the location's `name` is its zone and its `floor` the floor, so choosing
a location tags both. The Observations tab filters by category, severity,
location and floor in the browser, like the dashboard.

Each recording has its own `_id`, a `name` ("Recording 2" or the uploaded
file's name), and its original audio in S3 at
`audio/<reference>/<observation id>/<recording id>.<ext>`; the document keeps
the key, content type and size, never the audio. Its `transcription.status` is
`transcribing`, `transcribed` (with `transcript`) or `failed` (with `error`,
the reason shown to the engineer). `attempts` records each run with its start,
finish and error. Saving creates exactly one attempt per recording; a retry
adds one only while that recording's status is `failed`, using an atomic
update so two clicks cannot start two. Each recording is transcribed and
updated on its own, so one failure leaves the others. Saving leaves the
capture session `active`.

| Route | Does |
| --- | --- |
| `POST /api/assessments/:reference/observations` | Multipart form: a `details` part with the JSON fields `note` (optional), `engineer`, `copeDimension` (one of the four, or `null` to leave it uncategorised; it must be sent), `severity`, `locationId` (one of the assessment's locations), and optional `standard` (100 characters), plus a `recording` part per audio file (up to 25 MB each, 100 MB in all). 201, or 400 `{ error, fields }` as for assessments (also for no note and no recording, an empty recording, or a location not on the assessment) / 404 / 409 (no active session) / 413 / 415 |
| `GET /api/assessments/:reference/observations` | Every observation, newest first, with its `note` and `recordings`, each recording with its `url` and `transcription`. `copeDimension` is `null` for an uncategorised observation |
| `PATCH /api/observations/:id` | Changes the tags: JSON with any of `copeDimension` (one of the four, or `null` to uncategorise), `severity`, `locationId` (one of the assessment's locations) and `standard` (100 characters; `null` or `''` removes it). A tag left out is unchanged. 200 with the observation, or 400 `{ error, fields }` as for capture (also when no tag is sent) / 404 |
| `POST /api/observations/:id/recordings/:recordingId/transcription/retry` | New attempt for a failed recording: 202, or 404 / 409 |
| `GET /api/observations/:id/recordings/:recordingId/audio` | Streams the original recording from S3 |

References: [Chroma Docker](https://docs.trychroma.com/guides/deploy/docker),
[Cohere RAG](https://docs.cohere.com/docs/rag-complete-example).

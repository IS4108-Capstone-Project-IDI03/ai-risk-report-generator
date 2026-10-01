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
as errors rather than pretending retrieval succeeded. An optional `filters`
object (`source_type`, `jurisdiction`, `facility_type`) narrows the search:
`source_type` matches exactly, and `jurisdiction` and `facility_type` match the
value or `all`. Without filters it searches the whole collection (KB-01; RT-01
extends this for site applicability).

The current direct endpoints are for local development with synthetic or already
anonymised text. Raw-file parsing, automatic anonymisation, gateway auth, and
per-user evidence filtering are not implemented. Compose binds Chroma and these
Python service ports to loopback; do not expose them publicly as-is.

## Assessments and capture sessions

`assessments` holds a unique `reference` (the report ID shown in the UI, e.g.
`RPT-2026-0411`), a `site` reference, `client`, optional `policyReference`,
`surveyType`, optional `siteVisitDate` and `reportDueDate`, and the selected
`standards`, `engineers` (display-name snapshots), and `engineerIds` (user IDs; the first engineer is the lead).
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
gateway requires authentication and the `assessments:edit` permission.

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

`GET /api/assessments` returns assessments assigned to the authenticated risk
engineer's user ID; knowledge admins receive all assessments. The derived status
and sort order (most recent site visit first) are unchanged. Site/client/report-ID
search and status filtering happen in the browser. `GET /api/assessments/engineers`
requires `assessments:edit` and returns only active risk engineers' IDs, names,
staff IDs and job titles for assignment. Creating an assessment accepts
`engineerIds`, validates the active accounts, and derives display-name snapshots;
legacy name-only `engineers` input is rejected. IDs survive display-name changes.

## User accounts

`users` holds one profile per team member (F-03): a unique, fixed `staffId`
(`MRE-0001`), `name`, a unique lowercased `email`, `role`
(`risk_engineer` or `knowledge_admin`, F-05), optional `jobTitle`,
`phone` and `office` (a two-letter jurisdiction code), `active`, and the
bcrypt `passwordHash` (F-04, never selected by default). A deactivated account
cannot sign in.

`GET /api/users` lists accounts by name and `GET /api/users/:id` returns one
(404 for an unknown or malformed ID). `PUT /api/users/:id` replaces the whole
editable profile; optional fields sent as `''` are removed. Invalid input
returns 400 `{ error, fields }` like assessments, and an email another account
uses returns 409 with `fields.email`. `staffId` cannot be changed. These routes
need a session (401) and the `users:manage` permission, which only knowledge
admins have (403 otherwise). An admin cannot change their own role or
deactivate themselves (400 against `fields.role` or `fields.active`), so the
last admin cannot lock everyone out.

## Role permissions (F-05)

Every `/api` route except `/api/health` and `/api/auth/login|logout` needs a
session cookie (401 without one). Each then names one permission; a role
without it gets 403 `{ error: 'Your role does not allow this.' }` before the
handler reads the body or the database. The matrix lives in
`server/src/services/permissions.service.ts`, and `/api/auth/login` and
`/api/auth/me` return the role's `permissions` so the client guards its screens
with the same list.

| Permission | Routes | Risk engineer | Knowledge admin |
| --- | --- | --- | --- |
| `assessments:view` | `GET` assessments, their locations and observations, recording audio | yes | yes |
| `assessments:edit` | create assessments, capture sessions, locations, observations, tag edits, transcription retry | yes | no |
| `reports:generate` | `POST /api/rag/generate` | yes | no |
| `knowledge:view` | `GET` knowledge documents and their files | yes | yes |
| `knowledge:manage` | `POST /api/knowledge-documents`, `PUT /api/knowledge-documents/:id` (KB-01 correction) | no | yes |
| `users:manage` | `/api/users` | no | yes |

The role is read from the signed session, so a role change takes effect at the
user's next sign-in (sessions last 15 minutes). The seed script turns accounts
saved with the retired `reviewer` role into risk engineers; any left unmigrated
get no permissions.

`npm --prefix server run seed` inserts four sample accounts (`MRE-0001` to
`MRE-0004`, `example.com` emails, dev password `password123`; Sana Patel is the
knowledge admin, the rest risk engineers) only when their staff ID is missing, so
re-seeding keeps edits made on screen. Against the shared Atlas cluster, those
edits are visible to the whole team.

## Observations

`observations` holds one document per observation: one thing the engineer saw
on site, with everything captured about it. It has an optional `note` (CP-02)
and a `recordings` list (CP-03), and needs at least one of them. Photos are
still browser-only placeholders; CP-04 should add a `photos` list to the same
document rather than a new collection.

Each document links to its `assessment` and the capture `session` it was
recorded in, the authenticated `engineerId` and `engineer` display name at capture time, and `metadata`
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

The API derives `noteType: "Text"` (or null when absent) and each recording's
`type: "Voice"`. Both share the observation's `engineerId`, set from the signed
session; client-supplied attribution is ignored. Legacy engineer IDs are null
until explicitly mapped.

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
| `POST /api/assessments/:reference/observations` | Multipart form: a `details` part with the JSON fields `note` (optional), `copeDimension` (one of the four, or `null` to leave it uncategorised; it must be sent), `severity`, `locationId` (one of the assessment's locations), and optional `standard` (100 characters), plus a `recording` part per audio file (up to 25 MB each, 100 MB in all). 201, or 400 `{ error, fields }` as for assessments (also for no note and no recording, an empty recording, or a location not on the assessment) / 404 / 409 (no active session) / 413 / 415 |
| `GET /api/assessments/:reference/observations` | Every observation, newest first, with its `note` and `recordings`, each recording with its `url` and `transcription`. `copeDimension` is `null` for an uncategorised observation |
| `PATCH /api/observations/:id` | Changes the tags: JSON with any of `copeDimension` (one of the four, or `null` to uncategorise), `severity`, `locationId` (one of the assessment's locations) and `standard` (100 characters; `null` or `''` removes it). A tag left out is unchanged. 200 with the observation, or 400 `{ error, fields }` as for capture (also when no tag is sent) / 404 |
| `POST /api/observations/:id/recordings/:recordingId/transcription/retry` | New attempt for a failed recording: 202, or 404 / 409 |
| `GET /api/observations/:id/recordings/:recordingId/audio` | Streams the original recording from S3 |

## Knowledge documents (IN-01, KB-01)

`knowledge_documents` holds one record per accepted upload. Its `_id` is the
permanent document identifier; chunk ids in Chroma are `<_id>:<n>`.
`fileName` is the original name. The unaltered PDF is in S3 at
`knowledge/<_id>.pdf` (flat: no folder per source type, because a corrected
source type would leave the file in the wrong folder); the record keeps `file`
(`key`, `contentType`, `size`, `sha256`).

The source type decides which details the admin gives:

| Field | Standard (`fm_standard`, `nfpa_standard`) | Past report (`marsh_report`) |
| --- | --- | --- |
| `title` | required | required |
| `issuingBody` | set from the source type: `FM Global` / `NFPA` | set: `Marsh` |
| `edition` | required, a four-digit year, e.g. `2022` | absent |
| `metadata.effective_date` | the edition's effective date | the report date |
| `metadata.jurisdiction` | two-letter code, or `all` (all countries; the default) | two-letter code (default `SG`) |
| `metadata.facility_type` | optional; `all` unless the admin picks one | required, one facility type |
| `metadata.COPE_dimension` | `all` | `all` |

`jurisdiction: 'all'` is the only value that isn't a two-letter code; like
`facility_type: 'all'`, retrieval must treat it as matching any site. Every
passage (chunk) in Chroma carries its document's five labels (`source_type`,
`jurisdiction`, `facility_type`, `COPE_dimension`, `effective_date` as
`YYYY-MM-DD`) next to the pipeline's `doc_id`, `headings`, pages and `bbox`: the
worker adds them at ingest, and a correction rewrites them in place (KB-01).

`status` is `queued` (set by the gateway), then `processing`, `complete` (with
`result`: `chunksIndexed`, `tablesCaptured`, `imagesCaptured`) or `failed`
(with `error`, the reason shown to the admin), all set by the ingestion worker,
which also records `startedAt` and `finishedAt`. Rejected uploads are never
stored.

A `complete` document is **active**: it is what search can use, and the only
kind the knowledge base lists or lets the admin correct (KB-01). A correction
overwrites the details in place and keeps what it replaced in `history`; the
last save wins. `history` is an embedded list, oldest first, of earlier
versions: `{ title, issuingBody, edition?, metadata (all five labels),
replacedAt, replacedBy: { id, name } }` (`replacedBy` is the signed-in user).
A save that changes nothing adds no version. Restoring is an ordinary
correction with an old version's details, so the details it replaces become a
new version. The API returns `history` newest first. If the
ingestion service cannot relabel the passages, the gateway writes the old
details and history back (no transactions on standalone MongoDB), so a failed
relabel leaves both on the old labels and records no version. Not covered: two admins saving the same
document at once, or a relabel that succeeds but whose reply is lost.

| Route | Does |
| --- | --- |
| `POST /api/knowledge-documents` | Body is the PDF (`Content-Type: application/pdf`, up to 100 MB); `fileName`, `sourceType`, `title`, `effectiveDate`, `jurisdiction`, `facilityType` and (standards only) `edition` are query values, as in the table above. 201 queued, or 400 `{ error, fields }` / 413 / 415 / 422 / 503, each with `error` giving the reason |
| `GET /api/knowledge-documents` | Recent uploads, newest first: every document queued or processing, plus complete ones for 24 hours and failed ones for 7 days after `finishedAt`. Older documents stay stored, just not listed |
| `GET /api/knowledge-documents/active` | Every active document, by title A–Z (KB-01) |
| `PUT /api/knowledge-documents/:id` | Corrects a document's details (KB-01): JSON with the same fields as upload, minus `fileName`. `facilityType` must be one of the client's `FACILITY_TYPES` (or `all` for a standard), as at upload. 200 with the updated document (its `history` gains the replaced details, if any changed), or 400 `{ error, fields }` / 404 / 409 (not active) / 503 (search not updated, old details and history kept) |
| `GET /api/knowledge-documents/:id/file` | Streams the original PDF from S3; 404 for an unknown ID |

References: [Chroma Docker](https://docs.trychroma.com/guides/deploy/docker),
[Cohere RAG](https://docs.cohere.com/docs/rag-complete-example).

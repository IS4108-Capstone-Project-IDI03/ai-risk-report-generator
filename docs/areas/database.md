# Storage and retrieval

- MongoDB stores application records: sites, assessments, capture sessions, observations, report section drafts and user accounts.
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
`standards`, and `engineer`: the assigned engineer's user ID (one per assessment). The
engineer's name is read from their account, so a rename shows everywhere.
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
staff IDs and job titles for assignment. Creating an assessment requires
`engineerId`, the ID of one active risk engineer.

`PUT /api/assessments/:reference` corrects an assessment's details (RV-10 AC10):
its site's name, address, jurisdiction and facility type, and its client,
assessment type and dates, with the same validation as creating one (AC11).
The engineer, policy reference and standards are not editable: they stay as
the assessment was created. A date left empty is cleared. Only the assigned engineer
can edit (403 otherwise), and not once it is archived (409).

`POST /api/assessments/:reference/archive` archives an assessment (RV-10 AC8), a
soft delete: it sets `archivedAt`, and nothing the assessment holds is removed.
Only its assigned engineer can archive it (403 otherwise), once (409 the second
time). An archived assessment lists with status `archived`, which the work list
shows only under the Archived filter, and refuses a new capture session (409).
`POST /api/assessments/:reference/restore` (AC9) clears `archivedAt`, with the same
rules (assigned engineer only; 409 when it is not archived). The `reportStatus` and
capture sessions were kept, so the assessment returns with the status it had.

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

`POST /api/users` creates an account (F-08) from `name`, `email` and `role`,
with optional `jobTitle`, `phone` and `office`, validated as for `PUT`. It is
always saved active, and the gateway assigns the next unused `staffId` from
the `staff` counter (one already in use, e.g. a seeded `MRE-0001`, is skipped);
any `staffId` or `active` in the body is ignored. 201 returns the account;
invalid input is 400 `{ error, fields }` and an email another account uses is
409 with `fields.email`, and neither saves anything. A new account has no
`passwordHash`: its owner sets one through the password reset (F-06), then
signs in.

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
| `assessments:view` | `GET` assessments, their locations, observations, report sections and review workspace, recording audio and photos | yes | yes |
| `assessments:edit` | create assessments, capture sessions, locations, observations, transcription retry and reading photos; tag and note edits, transcript corrections, deletes and restores (the assessment's assigned engineer only, CP-08) | yes | no |
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
on site, with everything captured about it. It has an optional `note` (CP-02),
a `recordings` list (CP-03) and a `photos` list (CP-04), and needs at least one
of them.

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
(CP-06). `PATCH /api/observations/:id` changes any of them, and the note
(CP-08), in place, validated against the same values as capture; the
recordings, photos and capture time never change. The note is stored exactly as
typed, and a blank one removes it, which an observation without a recording or
a photo can't do.
Only what differs is saved, with `edited: { at, by: { id, name } }` naming who
made the latest change; a save that changes nothing records nothing. The
observation keeps no history of its own: report section drafts cite
observations by `_id`, and each draft keeps the observations as it was given
them in its `evidence`, so a draft can always be checked against what it was
drafted from. There is no zone field: the location's `name` is its zone and
its `floor` the floor, so choosing a location tags both. The Observations tab
filters by type (Note, Voice, Photo), category, severity, location, floor and status
(Transcribing, Interpreting, Transcription failed, Interpretation failed,
Complete) in the browser, like the dashboard.

A finished transcript can be corrected (CP-08): the recording's
`transcription.correction` holds `{ text, at, by }`, and `transcript` stays as
Whisper wrote it, as evidence of what was said. Drafting uses the correction.
Writing Whisper's words back removes it. Only a `transcribed` recording can be
corrected; one still transcribing, or failed, is refused (409).

Deleting is a soft delete (CP-08): `deleted: { at, by }` is set, present only
while deleted, and nothing is removed, the recordings in S3 included.
`listObservations`, which the Observations tab, the section evidence counts and
drafting all read, leaves deleted observations out, so drafting never uses
them; `?include=deleted` lists them too, for the tab's Show deleted. Restoring
removes `deleted`. A deleted observation can't be changed until it is
restored, and its location can't be removed while it is saved there, so a
restored one keeps its location. A draft that was given an observation since
deleted, or uncategorised, counts it in `changesSinceDraft`.

Only the assessment's assigned engineer can change, delete or restore its
observations (403 otherwise), and not once the assessment is archived (409),
as for its other details (RV-10). Capturing observations and retrying a failed
transcription stay open to any risk engineer.

The API gives each recording `type: "Voice"`; the note is text by being the
`note` field. The observation's `engineerId` is set from the signed session;
client-supplied attribution is ignored. Observations saved before this change
have a null `engineerId`.

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

Each photo (CP-04) has its own `_id`, a `name` (the uploaded file's, or "Photo
2"), and its original image in S3 at
`photos/<reference>/<observation id>/<photo id>.<jpg|png>`, stored unaltered;
the document keeps the key, `contentType` (`image/jpeg` or `image/png`) and
size. Only JPG and PNG are stored, and the format comes from the file's first
bytes, not the type the browser reports, so a HEIC renamed `.jpg` is refused.
A photo has no status: it is stored as taken. Observations saved before CP-04
have no `photos` field, which reads treat as none. Drafting does not read
photos yet, so an observation that is only photos is not usable evidence and
doesn't count toward a section's minimum.

An observation with photos gains an `interpretation` (CP-05) once an engineer
asks for its photos to be read: what the vision model proposes from all its
photos together, for the engineer to review. Saving never reads them, so a
client's site photos reach the vision model only by an engineer's choice. Its
`status` is `interpreting`, `interpreted` (with `description`, a
proposed `copeDimension` and a `hazardType`) or `failed` (with `error`, S5's
reason, which the API turns into a readable one). `attempts` records each run
as for a recording, and `provenance` records the `provider`, `model`,
`promptVersion`, token `usage` (`inputTokens`, `outputTokens`,
`thoughtTokens`, or null when not reported, EV-03) and `interpretedAt`.
Asking creates it with one attempt, or adds one while it is `failed`, matched
atomically so two clicks start one reading. Until then it has no
`interpretation`, and the API returns `null`. The proposal is not drafting
evidence: `toEvidence` never reads it, drafting does not wait for it, and it
does not count towards `changesSinceDraft`. It becomes the engineer's only
when they save it into the note or the category through `PATCH`. The Photos tab lists every photo of
the assessment's observations not deleted (CP-04 AC3), the collection the
report's photo appendix (EX-01) is to draw on; like the Observations tab's
filters, it is built in the browser from the observation list.

| Route | Does |
| --- | --- |
| `POST /api/assessments/:reference/observations` | Multipart form: a `details` part with the JSON fields `note` (optional), `copeDimension` (one of the four, or `null` to leave it uncategorised; it must be sent), `severity`, `locationId` (one of the assessment's locations), and optional `standard` (100 characters), plus a `recording` part per audio file (up to 25 MB each) and a `photo` part per JPG or PNG (up to 20 MB each), 100 MB in all. 201, or 400 `{ error, fields }` as for assessments (also for no note, recording or photo, an empty file, or a location not on the assessment) / 404 / 409 (no active session) / 413 / 415 (an audio format Whisper can't read, or a photo that isn't JPG or PNG, named in `error`). One refused file saves nothing |
| `GET /api/assessments/:reference/observations` | Every observation not deleted, newest first, with its `note`, `recordings` and `photos`, each recording with its `url` and `transcription` (`transcript` as Whisper wrote it, and any `correction`), each photo with its `url`, its `interpretation` (`{ status, description, copeDimension, hazardType, error, attempts, model }`, or `null` until its photos are read, CP-05), plus `edited` and `deleted` (`{ at, by }` or `null`). `copeDimension` is `null` for an uncategorised observation. `?include=deleted` lists deleted ones too |
| `PATCH /api/observations/:id` | Changes the tags and note: JSON with any of `copeDimension` (one of the four, or `null` to uncategorise), `severity`, `locationId` (one of the assessment's locations), `standard` (100 characters; `null` or `''` removes it) and `note` (5,000 characters, stored as typed; `null` or blank removes it). A field left out is unchanged. 200 with the observation, or 400 `{ error, fields }` as for capture (also when nothing is sent, or the note would leave nothing captured) / 403 not the assigned engineer / 404 / 409 archived or deleted |
| `PUT /api/observations/:id/recordings/:recordingId/transcript` | Corrects a finished transcript: JSON `text` (20,000 characters, not blank). 200 with the observation, or 400 / 403 / 404 / 409 (not transcribed, deleted or archived) |
| `DELETE /api/observations/:id` | Soft-deletes the observation. 200 with it (`deleted` set), or 403 / 404 / 409 (already deleted, or archived) |
| `POST /api/observations/:id/restore` | Restores a deleted observation. 200 with it, or 403 / 404 / 409 (not deleted, or archived) |
| `POST /api/observations/:id/recordings/:recordingId/transcription/retry` | New attempt for a failed recording: 202, or 404 / 409 |
| `POST /api/observations/:id/interpretation` | Reads the observation's photos (CP-05): the first reading, or a new one after a failure. Saving never reads them. 202, or 404 (unknown observation) / 409 (no photos, deleted, already being read, or already read) |
| `GET /api/observations/:id/recordings/:recordingId/audio` | Streams the original recording from S3 |
| `GET /api/observations/:id/photos/:photoId/image` | Streams the original photo from S3, cacheable since it never changes; 404 for an unknown observation or photo |

## Report sections (GN-01)

`report_sections` holds one document per generated draft of a report section
(7-12). Drafting the same section again adds a new document, so earlier drafts
are kept; the newest is current. Each document has:

- `assessment` and `sectionId` (`'7'`), and the template's `title`.
- `subsections`, in the template's order. Each has a `heading` and a `kind`
  (`narrative`, `fields` or `table`). Tables are left empty for GN-03 to fill.
- `statements`, each with its `text`, `citations` and `supported`. A citation
  is `O:<observation _id>` or `C:<chunk id>`. `supported` is false when a
  citation does not resolve to evidence the draft was given.
- `sources`: the cited passages by citation ID, with their text, `doc_id`,
  `headings` and `page_start`/`page_end`: every cited standard (`C:`), and any
  past-report passage (`P:`) a statement cites, kept so the review workspace
  can open it (RV-01). Drafts saved before RV-01 hold standards only.
- `questions`: up to three questions for the engineer about gaps the evidence
  leaves. They are not part of the report.
- `evidence`: the observations the draft was given, as they were then (`id`,
  `COPE_dimension`, `note`, `transcripts`, `severity`, `location`,
  `standard`). A later edit to an observation does not change it, so a
  citation can always be checked against what was drafted from. This stands in
  for CP-14's snapshot, which the team dropped.
- `guardrail`: `{ passed, unsupported_count }`.
- `provenance`: `provider`, `model`, `effort`, `prompt_version`,
  `template_version`, `generated_at` (AC7).
- `createdBy`, the engineer's user `_id`.
- `metadata` with the five required fields:
  - `source_type: 'report_section'`;
  - `jurisdiction` and `facility_type` from the site;
  - `COPE_dimension`: the section's one category, or `all` when it draws on
    several (section 12);
  - `effective_date`: when it was drafted.

The first draft sets the assessment's `reportStatus` to `draft`.

| Route | Does |
| --- | --- |
| `GET /api/assessments/:reference/sections` | Sections 7-12 from the template, each with `copeDimensions`, `minObservations`, `usableObservations`, `latestDraft` (or `null`) and `changesSinceDraft`: how many observations the newest draft's `evidence` lacks, holds in an older form, or holds that are no longer evidence (deleted or uncategorised, CP-08), which a redraft would bring up to date; and `changeCounts` `{ added, changed, removed }`, the same total by kind, which the screens name, leaving out any kind with none. 404, or 503 when S4 cannot be reached. |
| `POST /api/assessments/:reference/sections/:sectionId/draft` | Drafts and saves the section (`reports:generate`, assigned engineer only). 201 with the draft, 403, 404 (unknown assessment or section), 409 (a transcription in progress, or archived), 422 `{ error, found, needed }` (not enough usable evidence), 503 (drafting failed, with the reason). |
| `GET /api/assessments/:reference/review` | The review workspace (RV-01): `{ sections }`, sections 7-12 in template order. Each has `completion` (`state`: `not_started`, `partial` or `complete`, with `written` of `total` prose and field subsections, and `tables`), `review` (`state`: `not_drafted`, `ai_draft` or `needs_review`, with `unsupportedStatements`, `withdrawnSources`, `changesSinceDraft` and its `changeCounts`), the newest `draft` without its raw `sources`, `sources` (each cited passage by citation ID: `kind` `standard` or `precedent`, `text`, `headings`, `pageStart`, `pageEnd`, `documentId`, and `document`: the knowledge base's current `title`, `issuingBody`, `sourceType`, `edition`, `effectiveDate`, `withdrawnAt`, `fileUrl`, or `null` with no record) and `observations` (the draft's `evidence` filed under the section's categories, plus any other it cites). Read-only. 404, or 503 when S4 cannot be reached. |

## Opportunities for Improvement (GN-05)

`report_ofis` holds one document per drafted Opportunity for Improvement (OFI),
the records in the report's Section 3. A draft is a *suggestion* until the
engineer accepts it; only accepted OFIs are in the report. Drafting again
replaces the unaccepted suggestions and leaves accepted OFIs alone. Each
document has:

- `assessment`, and `state`: `suggested` or `accepted`, with `acceptedAt` and
  `acceptedBy` (the engineer's user `_id`) once accepted.
- The model's fields: `title`, `category` (Management Programs, Physical
  Protection or Other), `type`, `description` (the technical basis),
  `observation` (why it was raised here), `likelihood`, `consequence` and
  `effort`. The value lists are `rag-service/app/generation/ofi.json`, taken
  from Marsh's template; `type` is provisional until Marsh sends its RQR
  sub-categories.
- `priority` (`Priority 1` to `Priority 4`): the Risk Assessment Matrix's
  value for `likelihood` × `consequence`, set by S4's code, never by the model.
- `observations` (the observation `_id`s it rests on), `standards` (cited
  `C:` IDs), `precedent` (the `P:` ID of the past-report OFI it was adapted
  from, or `null`) and `sources` (those passages, with `doc_id` and
  `headings`).
- `provenance`: `provider`, `model`, `effort`, `prompt_version`,
  `config_version` (of `ofi.json`), `generated_at`.
- `createdBy`, the engineer's user `_id`.
- `metadata` with the five required fields: `source_type: 'ofi'`,
  `jurisdiction` and `facility_type` from the site, `COPE_dimension: 'all'`
  (an OFI can address any category) and `effective_date` (when drafted).

Not stored, but worked out when the list is read: the OFI `number`
(`<site visit year>-NN`, in report order: Management Programs, then Physical
Protection, then Other, each by acceptance time), `status` (`New`),
`issueDate` (the site visit date). OFI issued by, insurer rec no., loss
expectancy, related RTM ID, client response, advisory comment and loss
scenario are left for people to fill: loss figures never come from a model.

| Route | Does |
| --- | --- |
| `GET /api/assessments/:reference/ofis` | `{ suggestions, accepted }`. Each OFI has `status` and `issueDate`; `accepted` is in report order with `number`. 404. |
| `POST /api/assessments/:reference/ofis/draft` | Drafts OFIs from the assessment's usable observations and replaces the unaccepted suggestions (`reports:generate`, assigned engineer only). 201 with the list, 403, 404, 409 (a transcription in progress, or archived), 503 (drafting failed, with the reason). |
| `POST /api/assessments/:reference/ofis/:id/accept` | Accepts a suggestion into the report (assigned engineer only). 200 with the list; accepting twice changes nothing. 403, 404. |

## Knowledge documents (IN-01, KB-01)

`knowledge_documents` holds one record per accepted upload. Its `_id` is the
permanent document identifier; chunk ids in Chroma are `<_id>:<n>`.
`fileName` is the original name. The unaltered PDF is in S3 at
`knowledge/<_id>.pdf` (flat: no folder per source type, because a corrected
source type would leave the file in the wrong folder); the record keeps `file`
(`key`, `contentType`, `size`, `sha256`).

The details are read from the PDF at upload (IN-05, see "Automatic labelling"
below) and corrected by the admin (KB-01). The source type decides which apply:

| Field | Standard (`fm_standard`, `nfpa_standard`) | Past report (`marsh_report`) |
| --- | --- | --- |
| `title` | required | required |
| `issuingBody` | set from the source type: `FM Global` / `NFPA` | set: `Marsh` |
| `edition` | required, a four-digit year, e.g. `2022` | absent |
| `metadata.effective_date` | the edition's effective date | the report date |
| `metadata.jurisdiction` | two-letter code, or `all` (all countries; the default) | two-letter code (default `SG`) |
| `metadata.facility_type` | optional; `all` unless the admin picks one | required, one facility type |
| `metadata.COPE_dimension` | `all` | `all` (each passage carries its own, see below) |

`jurisdiction: 'all'` is the only value that isn't a two-letter code; like
`facility_type: 'all'`, retrieval must treat it as matching any site. Every
passage (chunk) in Chroma carries its document's labels (`source_type`,
`jurisdiction`, `facility_type`, `effective_date` as `YYYY-MM-DD`) next to the
pipeline's `doc_id`, `headings`, pages and `bbox`: the worker adds them at
ingest, and a correction rewrites them in place (KB-01). An Unconfirmed detail
(IN-05) is left out of the passage, since Chroma can't store null, so no filter
can match it.

Each passage's `COPE_dimension` is its own (IN-05): during ingestion, a past
report's passage gets the COPE category of the report section it sits under,
from the outermost heading in its `headings` that names a mapped section
(`Construction` → Construction; `Occupancy, Hazards, and Utilities` →
Occupancy; `Fire Protection` and `Security` → Protection; `External Exposures`
→ Exposure; titles only, never section numbers). Every other passage, and
every passage of a standard or of a document whose source type is Unconfirmed,
is `all`. The map is in `microservices/ingestion-service/app/pipeline/cope.py`.
A relabel never sends `COPE_dimension`, so a correction keeps each passage's
own.

Each passage also carries `status`: `active`, `withdrawn` (KB-01) or
`needs_review` (IN-05: the document has an Unconfirmed detail). The worker
writes `needs_review` or `active` at ingest; a correction, withdraw and reinstate
rewrite it in place (reinstating a document that still has Unconfirmed details
gives `needs_review`). Retrieval returns only passages that are neither
`withdrawn` nor `needs_review`. Passages indexed before the status label
existed have no `status`; retrieval treats that as active.

#### Automatic labelling (IN-05)

At upload the gateway asks the ingestion service's `POST /label` to read the
PDF's first `LABEL_PAGES` pages (default 20; pages without a text layer in the
first 5 are OCR'd) and fill in the six details. A detail the models are not
confident about is **Unconfirmed**: stored as `null` in `metadata` (or no
`edition`), the one exception to the CLAUDE.md metadata rule besides
uncategorised observations. The title falls back to the file name, and
`issuingBody` is `null` while the source type is Unconfirmed. Extra fields:

- `unconfirmed`: the Unconfirmed detail names (`source_type`, `title`,
  `edition`, `effective_date`, `jurisdiction`, `facility_type`); a report never
  lists `edition`. Non-empty means the document **needs review**. Written by the
  gateway at upload and emptied by a correction (which must give every
  detail); the worker reads it to choose the passages' `status`. The API returns
  it in camelCase.
- `labelling`: `{ labelledAt, details: { <detail>: { value, confidence,
  evidence: { page, quote } | null, model, source } } }`, what labelling found
  (`source: 'auto'`). A correction sets each detail's `value` and `source:
  'admin'`. Absent when labelling failed, in which case every detail is
  Unconfirmed.

`status` is `queued` (set by the gateway), then `processing`, `complete` (with
`result`: `chunksIndexed`, `tablesCaptured`, `imagesCaptured`) or `failed`
(with `error`, the reason shown to the admin), all set by the ingestion worker,
which also records `startedAt` and `finishedAt`. Rejected uploads are never
stored.

`retryCount` tracks how many times a knowledge admin has pressed Retry on a
failed document. It is incremented atomically — inside the same
`failed → queued` status flip in `retryIngestion` — so it counts human retries
only, never automatic BullMQ re-runs of a stalled job. Its value is never
shown to the user; its sole purpose is to make each retry's ingestion
notification distinct: `retryCount` is carried in `context.attempt` of the
notification payload, which `createNotification`'s dedupe key includes, so a
document that fails, is retried, and fails again produces a second notification
rather than being deduped into silence. Starts at 0; the `knowledge_documents`
schema enforces that with `default: 0`.

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

An active document can be **withdrawn** (KB-01): `withdrawn: { at, by: { id,
name } }` is set (`by` is the signed-in user), and it is absent while the
document is active. `status` stays `complete`. The document is still listed, but
shows as Withdrawn, its passages are skipped by search, and it can't be
corrected. Reinstating removes `withdrawn` and records no one. Only the latest
withdrawal is kept. As with a correction, a failed relabel puts `withdrawn` back
as it was. The API returns `withdrawn` as `{ at, by } | null`.

| Route | Does |
| --- | --- |
| `POST /api/knowledge-documents` | Body is the PDF (`Content-Type: application/pdf`, up to 100 MB); `fileName` is the only query value (IN-05: the details are read from the file, a few seconds, longer for a scanned PDF). 201 queued, or 400 `{ error, fields }` / 413 / 415 / 422 / 503, each with `error` giving the reason. A labelling failure never fails the upload: every detail is then Unconfirmed |
| `GET /api/knowledge-documents` | Recent uploads, newest first: every document queued or processing, plus complete ones for 24 hours and failed ones for 7 days after `finishedAt`. Older documents stay stored, just not listed |
| `GET /api/knowledge-documents/ingested` | Every ingested document, active or withdrawn, by title A–Z (KB-01) |
| `PUT /api/knowledge-documents/:id` | Corrects a document's details (KB-01): JSON with every detail (`sourceType`, `title`, `effectiveDate`, `jurisdiction`, `facilityType`, and `edition` for a standard); partial saves are refused, so a save completes a needs-review document. `facilityType` must be one of the client's `FACILITY_TYPES` (or `all` for a standard), as at upload. 200 with the updated document (its `history` gains the replaced details, if any changed), or 400 `{ error, fields }` / 404 / 409 (not active) / 503 (search not updated, old details and history kept) |
| `POST /api/knowledge-documents/:id/withdraw` | Withdraws an active document (KB-01), no body. 200 with the document (`withdrawn` set), or 404 / 409 (not complete, or already withdrawn) / 503 (search not updated, still active) |
| `POST /api/knowledge-documents/:id/reinstate` | Reinstates a withdrawn document (KB-01), no body. 200 with `withdrawn: null`, or 404 / 409 (not withdrawn) / 503 (search not updated, still withdrawn) |
| `POST /api/knowledge-documents/:id/retry` | Retries a failed ingestion without re-uploading (the PDF and all details are kept). Flips `status` to `queued`, clears `error`/`finishedAt`, increments `retryCount`, and re-queues the ingestion job. 202 on accept, 404 unknown, 409 not failed (someone already retried it), 503 queue unreachable (document left failed, counter rolled back). `knowledge:manage` only |
| `GET /api/knowledge-documents/:id/file` | Streams the original PDF from S3; 404 for an unknown ID |

### Ingestion jobs (`ingestion_jobs`)

One document per ingestion run, written by the ingestion worker and read by the
gateway to enrich the `KnowledgeDocument` DTO (E2). Keyed by `documentId` (unique
index → `knowledge_documents._id`), so the gateway finds a run with one query and
no `$lookup`. Fields: `currentStage` (one of `parsing`, `anonymising`,
`chunking`, `indexing`, `complete`, `failed`), `pageCurrent` and
`pageTotal` (the page being chunked and the document's page count — progress is
tracked by page because the chunk total is not knowable up front; both null until
chunking reaches a page with provenance), `stageLog` (completed stages, each with
`stage`, `startedAt`, `durationMs`), `failedStage` (the stage that was in
progress when ingestion failed, written on failure so it need not be inferred
from `stageLog`; absent otherwise — used by the ingestion notification, IN-10),
`currentStageStartedAt`, `startedAt`, and
`updatedAt` (the worker
sets `updatedAt` itself; the schema has no `timestamps`). Every write is an upsert
on `documentId`, so a worker that crashes and is handed the job again resumes
cleanly. The gateway folds this into the DTO as `progress` only while a document
is `processing`: the worker's final write moves the current stage into `stageLog`
and clears `currentStage`, so a `complete` or `failed` document carries no
`progress`. Elapsed times (`elapsedMs`, `currentStageElapsedMs`) are computed on
read, never stored.

## Notifications

`notifications` holds one document per event a user is told about, read by the
header dropdown. A notification is **shared** by the users it targets rather than
copied per user, so the plan is one document per event and per-user state held on
it as lists of user ids.

Fields: `purpose` (one of `ingestion_status`, `transcription_status`,
`drafting_status`, `knowledge_document_status`, `account_status`,
`assessment_status`), `message` (the line shown in the dropdown), `details` (the
longer text behind the row's expand control, e.g. a failure reason),
`targetRole` (a `USER_ROLES` value), `targetUserIds`, `readBy`, `dismissedBy`,
`createdBy` and `createdByService`, and `context`.

`targetUserIds` names who within the role sees it: user ids, or `['all']` for
every user holding the role. It is required and must be non-empty — Mongoose
treats `[]` as present, so the schema adds its own non-empty validator; without
it a notification would save and then be shown to nobody.

Read paths match `targetRole` against the **session's current role**, never a
copy stored per recipient. That is what makes a role change take effect at once:
a user moved from `knowledge_admin` to `risk_engineer` stops seeing the admin
notifications on their next request, with no migration of existing documents.

`readBy` and `dismissedBy` exist because the document is shared. Marking as read
adds the caller to `readBy`; "mark all as read" adds them to `readBy` across
everything they can see; "dismiss all" adds them to `dismissedBy`. None delete,
since deleting a shared document would clear it for everyone else too — so one
user reading or dismissing never changes what another user in the role sees.

`createdBy` (a user) and `createdByService` (a service name) are both nullable,
and normally exactly one is set: a notification raised by the ingestion worker
has no user behind it, and there is no system or service role to point at.

`context` is the purpose-specific payload, e.g. `{ documentId, stage }` for
`ingestion_status`. It is deliberately **not** called `metadata`: in this
codebase that name means the five mandatory label fields (see CLAUDE.md), and
notifications carry none of them — they are not retrieval evidence.

Indexes: `{ targetRole: 1, createdAt: -1 }` for the dropdown's query, and a TTL
index on `createdAt` expiring documents after 90 days. The TTL is load-bearing:
nothing else ever deletes a notification, because dismissing is per user.

Purposes are a closed set so every notification has a known audience and a known
screen to open. Only `ingestion_status` has a producer today. Deadline and
reminder purposes are absent on purpose: nothing in the repo schedules work, so
nothing could fire them.

References: [Chroma Docker](https://docs.trychroma.com/guides/deploy/docker),
[Cohere RAG](https://docs.cohere.com/docs/rag-complete-example).

## AI-call usage (EV-03)

Collection `ai_calls` (`server/src/models/ai-call.model.ts`). One document per paid AI call, saved by the gateway (`ai-usage.service.ts`) from the `usage` list that the Python services return. The services never write it.

| Field | Meaning |
|---|---|
| `feature` | `draft-section`, `retrieval`, `transcribe` or `label-document` |
| `billedService` | who bills us: `anthropic`, `cohere-embed`, `cohere-rerank`, `openai-whisper`, `openai-label`, `typesafe-jev` |
| `model` | the exact model the provider reported |
| `reportId` | the assessment reference (absent for labelling, which has no report) |
| `durationMs` | how long the call took |
| `inputTokens`, `outputTokens`, `cacheReadTokens` | provider-reported; `null` when not reported |
| `searchUnits`, `audioSeconds` | Cohere rerank and Whisper billing units |
| `usageStatus` | `recorded`, or `unavailable` when the provider gave no usage data |
| `estimatedCostUsd`, `pricingBasis` | the estimate and where its price came from; cost is `null` when there is no price or no usage |

- One draft writes three rows: Claude, Cohere embed and Cohere rerank.
- A draft that fails after its paid calls (refused, cut off) is not recorded: the service raises before it returns the list.
- Prices are list prices in `ai-pricing.service.ts` (Claude and Whisper from the vendors' pages, read 2026-10-08). Cohere publishes no per-use price, so those two are estimates, set by `COHERE_EMBED_USD_PER_1M_TOKENS` and `COHERE_RERANK_USD_PER_1K_SEARCHES`.
- A failure while saving is logged and ignored, so bookkeeping can never fail a draft or a transcription.
- Nothing reads the collection yet; EV-04 (cost report) will.

### Where each `ai_calls` field comes from (EV-03)

Each provider reports usage differently. The services rename it into one shape (the "wire" item), and the gateway cleans it and saves it.

| Provider field | Wire item (Python to gateway) | Stored field (`ai_calls`) |
|---|---|---|
| Anthropic `usage.input_tokens` | `input_tokens` | `inputTokens` |
| Anthropic `usage.output_tokens` | `output_tokens` | `outputTokens` |
| Anthropic `usage.cache_read_input_tokens` | `cache_read_tokens` | `cacheReadTokens` |
| Cohere embed `meta.billed_units.input_tokens` | `input_tokens` | `inputTokens` |
| Cohere rerank `meta.billed_units.search_units` | `search_units` | `searchUnits` |
| Whisper `verbose_json` `duration` (seconds) | `audio_seconds` | `audioSeconds` |
| Time around the call (`perf_counter`) | `duration_ms` | `durationMs` |
| Labelling `seconds` (gateway multiplies by 1000) | `duration_ms` | `durationMs` |
| Labelling `cost_usd` (kept as the service's own cost) | `cost_usd` | `estimatedCostUsd` |
| Labelling `model`, mapped to its vendor | `billed_service` | `billedService` |
| Which code path made the call | `feature` | `feature` |
| Provider gave nothing | `usage_status: "unavailable"` | `usageStatus` |
| Assessment reference, added by the gateway | not sent | `reportId` |
| Price table lookup, added by the gateway | not sent | `estimatedCostUsd`, `pricingBasis` |

What the gateway does on the way in (`ai-usage.service.ts`): non-numbers become `null`; items with an unknown feature or service are dropped; the status becomes `unavailable` when every amount is empty; cost is never computed from partial usage; names change from snake_case to camelCase.


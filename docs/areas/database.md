# Storage and retrieval

- MongoDB stores application records: sites, assessments, capture sessions, observations, report section drafts, the review audit log and user accounts.
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
`document_id`, `source_type`, `jurisdiction`, `facility_type`, `section`,
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
`RPT-2026-0411`), a `site` reference, `surveyType`, optional
`siteVisitDate` and `reportDueDate`, and `engineer`: the assigned engineer's user ID
(one per assessment). The engineer's name is read from their account, so a rename shows everywhere.
Its client is read through its site (CP-17); an assessment saved before then
also keeps the `client` name typed on it, unused once its site is migrated.
Extend it rather than creating a parallel assessment schema.

`POST /api/assessments` creates an assessment for a listed client
(`clientId`) or a new one (`client`, a name), on one of that client's sites
(`siteId`) or a new site (`site`, which has an optional `address`): exactly
one of each pair (CP-17). A listed site of another client is refused, as is a
new site named like one the client has, ignoring case (`site.name`). On a
listed site the assessment starts with a copy of the locations of the site's
latest assessment not archived, whatever its status (latest by visit date,
then creation), each with a new `_id`, unless `copyLocations` is `false`; no
observations are copied. The body is validated with Zod; a 400 returns
`{ error, fields }`, where `fields` maps each invalid path (e.g. `site.name`) to
its first problem. `jurisdiction` is a two-letter code (`SG`, `MY`, `UK`, …)
because retrieval filters on it. The server allocates the reference
`RPT-<year>-<nnnn>` and the site code `SITE-<nnnn>` from atomically incremented
`counters` documents (`assessment:<year>`, `site`), skipping any code already
in use, such as a seeded one. Dev and test MongoDB are standalone servers without
transactions, so if the assessment insert fails, a new site is deleted by hand.

`clients` (CP-17) holds the clients the firm surveys for, each with a `name`
(up to 200 characters) and a unique `key`: the name lowercased with its spacing
tidied, so "Northgate  Logistics" and "northgate logistics" are one client.
Every engineer sees every client. A site belongs to one client through its
`client` reference; one client has many sites, and a site many assessments,
one per visit. Creating an assessment with a new client name finds the client
by key, or adds it with the name as typed. `GET /api/clients` lists every
client in name order with its number of sites, and `GET
/api/clients/:id/sites` a client's sites in name order, each with its latest
assessment not archived (`reference`, `siteVisitDate`, and the `locations` and
`buildings` a new assessment would copy); 404 for an unknown client. Both need
`assessments:edit`. Assessments list with `clientId` (null for a site not yet
migrated) and `siteShared`: whether the site has another assessment not
archived. Sites saved before CP-17 have no `client` until `npm --prefix server run
migrate:clients` links each to a client made from its assessment's `client`
text: names matching by key become one client, spelt as first found, and sites
are never merged. It is safe to run more than once, and leaves a site with no
assessment (the health check's `SYN-SG-001`) unlinked. The assessment's
`client` text stays as it was saved; it is shown only while its site has no
client.

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
the engineer adds them during capture (CP-15), organised by building and level
(CP-16). Each has an `_id`, a `name` (up to 100 characters), an optional
`building` (up to 100) and an optional `floor` (up to 40, shown as Level),
plus a `key`. A location is either in a building, with a `building` and
optionally a `floor` (none means the whole building, e.g. its facade), or
elsewhere on site (roads, car parks, a guardhouse, a sprinkler tank), with a
`name` only. One saved before CP-16 may have a `floor` but no `building`; the
picker lists it under Building not recorded until it is edited into a
building. The `key` is the lowercased name and floor, `name|floor`, with
`|building` added only when there is one, so keys saved before CP-16 still
match. They are embedded because the list is short and always read with its
assessment. `POST /api/assessments/:reference/locations` (JSON `name`,
`building`, `floor`) returns 201, 400 `{ error, fields }` (also for a `floor`
without a `building`), 404, or 409 with `fields.name` when the same name,
level and building is already listed; matching on `key` in the same update
keeps two taps from adding it twice. A building or level that differs from
one already listed only in case is saved in the listed spelling, so "block a"
joins "Block A". A level the gateway recognises is saved in its standard
spelling (`standardLevel`): "L2", "lvl 2" and "2nd floor" are Level 2, "B1"
Basement 1 and "GF" Ground, so shorthand never splits a level in two; any other
name, e.g. Podium, is kept as given. The client asks before saving one of those
(see the design system). `GET` on the same path lists them in the order they were
added; the client groups them. Adding one needs no capture session. `PATCH
/api/assessments/:reference/locations/:id` (the same JSON) changes a location in
place, so every observation saved there follows it: 200 with the location, 400,
403 for anyone but the assessment's assigned engineer, 404, or 409 once the
assessment is archived or when another location already has those details. A
report draft keeps the location as it was drafted from in its `evidence`, so a
changed one counts in `changesSinceDraft`. `DELETE
/api/assessments/:reference/locations/:id` removes one added by mistake: 204,
404, or 409 while any observation is saved there, so no observation loses its
location; editing an observation's tags (CP-06) moves it elsewhere. `npm --prefix server run seed`
gives `RPT-2026-0411` eight sample locations, in two buildings and elsewhere on
site, when it has none.

Where a report names a location (drafting `evidence`, Appendix A captions,
the photo reading's prompt), `locationText` in `location.service.ts` words it
most specific first: "Staircase, Level 2, Block A". A location without a
building reads "Pump room, B1", exactly as before CP-16, so drafts made
before it still compare equal. Section 1 names each building, then each place
elsewhere on site.

`appendixPhotos` (GN-07) is Appendix A's photos in report order: each a
`photo` (the `_id` of one of the assessment's observations' photos) and the
`caption` shown under it (up to 200 characters). Embedded for the same reason
as `locations`. `GET /api/assessments/:reference/appendix` returns `{ selected,
available }`: the chosen photos with their details and caption, leaving out any
whose observation was deleted since, and every photo of the assessment's
non-deleted observations (`photoId`, `observationId`, `name`, `url`,
`location`, `category`, `note`, `selected`). `PUT` on the same path (JSON
`photos: [{ photoId, caption }]`, assigned engineer only) replaces the list:
200 with the same shape, 400 for a photo not the assessment's, one given
twice, or a caption over 200 characters, 403, 404, 409 archived. The export
(EX-01) is to read it.

`GET /api/assessments` returns assessments assigned to the authenticated risk
engineer's user ID; knowledge admins receive all assessments. The derived status
and sort order (most recent site visit first) are unchanged. Site/client/report-ID
search and status filtering happen in the browser. `GET /api/assessments/engineers`
requires `assessments:edit` and returns only active risk engineers' IDs, names,
staff IDs and job titles for assignment. Creating an assessment requires
`engineerId`, the ID of one active risk engineer.

`PUT /api/assessments/:reference` corrects an assessment's details (RV-10 AC10):
its site's name, address, jurisdiction and facility type, and its assessment
type and dates, with the same validation as creating one (AC11). The engineer,
client and site are not editable: they stay as the assessment was created
(CP-17 AC8). The site's details are shared once the site has another
assessment not archived, so changing them is then refused (409); sending them
unchanged is fine. Renaming a site to another of its client's site names is
refused (400, `site.name`). A date left empty is cleared. Only the assigned engineer
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
| `assessments:edit` | create assessments, capture sessions, locations, observations, transcription retry and reading photos; tag and note edits, changing locations (CP-16), transcript corrections, deletes and restores, and adding, removing and restoring recordings and photos (the assessment's assigned engineer only, CP-08) | yes | no |
| `reports:generate` | `POST /api/rag/generate` | yes | no |
| `knowledge:view` | `GET` knowledge documents and their files | yes | yes |
| `knowledge:manage` | `POST /api/knowledge-documents`, `PUT /api/knowledge-documents/:id` (KB-01 correction), `POST /api/knowledge-documents/:id/decision` (IN-07) | no | yes |
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
and `facility_type` copied from the site, `COPE_dimension`, the list of COPE
categories the engineer picked (any of `Construction`, `Occupancy`,
`Protection` and `Exposure`, the same values the knowledge base uses; one
finding can concern several), and `effective_date` (when it was captured).
The list is stored in C-O-P-E order without repeats, so the same choice always
saves the same list. Observations saved before an observation could have
several categories hold one string; `copeDimensionsOf` in
`observation.model.ts` reads it as a list of one, and `npm --prefix server run
migrate:cope` rewrites those (and drafts' `evidence`) as lists. `createdAt` is the capture timestamp. `severity`
(`critical`, `high`, `moderate` or `low`) and `location` (the `_id` of one of
the assessment's `locations`) are required; `standard` is optional. `standard` is the standard the engineer tied
the observation to (e.g. `NFPA 25 – 2026 Edition`); only the standard is
stored, and the draft finds the clause. The category, severity, location and
standard are stored once and cover the note and every recording. The location
is stored by id rather than name, so renaming a location later does not split
its observations; responses include it as
`location: { id, building, floor, name }`.

`note` is stored exactly as written, untrimmed, up to 5,000 characters; a blank
note counts as none. An observation may be saved uncategorised: its
`COPE_dimension` is then `null`, present but null rather than left out, and
never `[]` (an empty list sent is saved as `null`).
`listCategoryObservations` in `observation.service.ts`, the category-scoped
drafting inputs for GN-01, matches on `COPE_dimension`, which MongoDB matches
against any item of the list, so an observation filed under two categories is
an input to both, and an uncategorised one stays out of drafting until it is
categorised by editing its tags.

The category, severity, location and standard are the observation's tags
(CP-06). `PATCH /api/observations/:id` changes any of them, and the note
(CP-08), in place, validated against the same values as capture; the capture
time never changes. The note is stored exactly as typed, and a blank one
removes it, which an observation without a recording or a photo it keeps
can't do.
Only what differs is saved, with `edited: { at, by: { id, name } }` naming who
made the latest change; a save that changes nothing records nothing. The
observation keeps no history of its own: report section drafts cite
observations by `_id`, and each draft keeps the observations as it was given
them in its `evidence`, so a draft can always be checked against what it was
drafted from. There is no zone field: choosing a location tags its building,
level and name (CP-16). The Observations tab filters by type (Note, Voice,
Photo), category (an observation filed under several matches any of them),
severity, building (Elsewhere on site among them), level, location and status
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

Recordings and photos can be added to a saved observation, and removed from it
(CP-08). `POST /api/observations/:id/media` takes them as capture does, stores
each in S3 under the observation's folder, marks it `added: { at, by }`, and
starts each recording's transcription; no photo is read until an engineer
asks. It needs no capture session. Removing is a soft removal, like deleting:
the recording or photo gets `removed: { at, by }`, present only while removed,
and nothing is deleted, in MongoDB or S3. Restoring removes `removed`. A
removal must leave a note, a recording or a photo (409 otherwise); the update
matches on that, so two removals at once can't leave nothing. The API lists
only kept ones under `recordings` and `photos`, and removed ones under
`removedRecordings` and `removedPhotos`, so everything that reads the former
leaves removed ones out without asking: drafting, the section evidence counts,
the wait for transcriptions before drafting, the Photos tab and the photo
appendix (EX-01). Removing or restoring a transcribed recording, or adding one
once it is transcribed, changes the transcripts a draft was given, so it
counts in `changesSinceDraft`; photos are not drafting evidence, so they don't.
A removed recording's transcript can't be corrected, nor a failed one retried,
until it is restored.

Only the assessment's assigned engineer can change, delete or restore its
observations, or add, remove and restore their recordings and photos (403
otherwise), and not once the assessment is archived (409), as for its other
details (RV-10). Capturing observations, retrying a failed transcription and
reading photos stay open to any risk engineer.

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
`interpretation`, and the API returns `null`, as it does while no photo is
kept. Each attempt records the photos it reads in `photoIds` (CP-08). A
finished reading whose `photoIds` differ from the photos kept now, because
photos were added or removed since, is out of date: the API returns
`outOfDate: true`, nothing reads the photos again by itself, and asking again
reads the kept ones, clearing the old proposal while it runs. A reading from
before photos could change has no `photoIds` and counts as reading every photo
the observation was saved with (those without `added`). The proposal is not drafting
evidence: `toEvidence` never reads it, drafting does not wait for it, and it
does not count towards `changesSinceDraft`. It becomes the engineer's only
when they save it into the note or the categories through `PATCH`; the
Observations tab's Add category adds the proposed one to those it has. The Photos tab lists every photo of
the assessment's observations not deleted (CP-04 AC3), the collection the
report's photo appendix (EX-01) is to draw on; like the Observations tab's
filters, it is built in the browser from the observation list.

| Route | Does |
| --- | --- |
| `POST /api/assessments/:reference/observations` | Multipart form: a `details` part with the JSON fields `note` (optional), `copeDimensions` (a list of any of the four, or `null` or `[]` to leave it uncategorised; it must be sent), `severity`, `locationId` (one of the assessment's locations), and optional `standard` (100 characters), plus a `recording` part per audio file (up to 25 MB each) and a `photo` part per JPG or PNG (up to 20 MB each), 100 MB in all. 201, or 400 `{ error, fields }` as for assessments (also for no note, recording or photo, an empty file, or a location not on the assessment) / 404 / 409 (no active session) / 413 / 415 (an audio format Whisper can't read, or a photo that isn't JPG or PNG, named in `error`). One refused file saves nothing |
| `GET /api/assessments/:reference/observations` | Every observation not deleted, newest first, with its `note`, `recordings` and `photos` (kept ones only), each recording with its `url` and `transcription` (`transcript` as Whisper wrote it, and any `correction`), each photo with its `url`, each with `added` (`{ at, by }` or `null`), then `removedRecordings` and `removedPhotos`, each also with `removed` (CP-08); its `interpretation` (`{ status, description, copeDimension, hazardType, error, attempts, model, photoIds, outOfDate }`, or `null` until its photos are read, CP-05), plus `edited` and `deleted` (`{ at, by }` or `null`). `copeDimensions` is the list in C-O-P-E order, or `null` for an uncategorised observation. `?include=deleted` lists deleted ones too |
| `PATCH /api/observations/:id` | Changes the tags and note: JSON with any of `copeDimensions` (a list of any of the four, or `null` or `[]` to uncategorise; the same categories in another order change nothing), `severity`, `locationId` (one of the assessment's locations), `standard` (100 characters; `null` or `''` removes it) and `note` (5,000 characters, stored as typed; `null` or blank removes it). A field left out is unchanged. 200 with the observation, or 400 `{ error, fields }` as for capture (also when nothing is sent, or the note would leave nothing captured) / 403 not the assigned engineer / 404 / 409 archived or deleted |
| `PUT /api/observations/:id/recordings/:recordingId/transcript` | Corrects a finished transcript: JSON `text` (20,000 characters, not blank). 200 with the observation, or 400 / 403 / 404 / 409 (not transcribed, removed, deleted or archived) |
| `DELETE /api/observations/:id` | Soft-deletes the observation. 200 with it (`deleted` set), or 403 / 404 / 409 (already deleted, or archived) |
| `POST /api/observations/:id/restore` | Restores a deleted observation. 200 with it, or 403 / 404 / 409 (not deleted, or archived) |
| `POST /api/observations/:id/media` | Adds recordings and photos (CP-08): multipart `recording` and `photo` parts, checked as at capture, 100 MB in all; no capture session needed. 200 with the observation, or 400 (none sent, or an empty file) / 403 / 404 / 409 (deleted or archived) / 413 / 415. One refused file adds nothing |
| `DELETE /api/observations/:id/recordings/:recordingId`, `DELETE /api/observations/:id/photos/:photoId` | Removes one, a soft removal (CP-08). 200 with the observation, or 403 / 404 / 409 (already removed, deleted, archived, or it would leave nothing captured) |
| `POST /api/observations/:id/recordings/:recordingId/restore`, `POST /api/observations/:id/photos/:photoId/restore` | Restores a removed one. 200 with the observation, or 403 / 404 / 409 (not removed, deleted or archived) |
| `POST /api/observations/:id/recordings/:recordingId/transcription/retry` | New attempt for a failed recording: 202, or 404 / 409 (not failed, or removed) |
| `POST /api/observations/:id/interpretation` | Reads the observation's kept photos (CP-05): the first reading, a new one after a failure, or after photos were added or removed (CP-08). Saving never reads them. 202, or 404 (unknown observation) / 409 (no photos, deleted, already being read, or read and up to date) |
| `GET /api/observations/:id/recordings/:recordingId/audio` | Streams the original recording from S3 |
| `GET /api/observations/:id/photos/:photoId/image` | Streams the original photo from S3, cacheable since it never changes; 404 for an unknown observation or photo |

## Report sections (GN-01)

`report_sections` holds one document per generated draft of a report section
(7-12). Drafting the same section again adds a new document, so earlier drafts
are kept. No draft is ever changed: the engineer's decisions on its findings
are in the [review audit log](#review-audit-log-rv-02). The section's saved
content is its newest draft, except that a replacement draft counts only once
accepted, and from when it was accepted. Each document has:

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
  `COPE_dimension` (the list of categories; one string in drafts saved
  before an observation could have several, read as a list of one), `note`,
  `transcripts`, `severity`, `location`, `standard`). A later edit to an observation does not change it, so a
  citation can always be checked against what was drafted from. This stands in
  for CP-14's snapshot, which the team dropped.
- `guardrail`: `{ passed, unsupported_count }`.
- `provenance`: `provider`, `model`, `effort`, `prompt_version`,
  `template_version`, `generated_at` (AC7), and `instruction`: what the
  engineer asked a regenerated draft to change, or `null` (RV-02). A
  regenerated draft's `prompt_version` is `gn01-v2.4+rv02-v1`.
- `replacementFor`: set only on a replacement draft made by Regenerate in the
  review workspace (RV-02), the `_id` of the saved draft it was made to
  replace. It waits until accepted or discarded, decisions held in the log.
- `createdBy`, the engineer's user `_id`.
- `metadata` with the five required fields:
  - `source_type: 'report_section'`;
  - `jurisdiction` and `facility_type` from the site;
  - `COPE_dimension`: the section's one category, or `all` when it draws on
    several (section 12);
  - `effective_date`: when it was drafted.

The first draft sets the assessment's `reportStatus` to `draft`.

**Section 2, Executive Summary (GN-07)** is saved here too, as `sectionId:
'2'`, drafted by S4 from the text of Sections 3-12 alone. Its three
subsections are the template's: "Executive Summary" (the statements, each
citing the sections it rests on as `S:<id>`), and "Changes Since Previous
Survey" and "Planned Changes / Projects", left empty for the engineer.
`evidence` and `sources` are empty. `summarised` records the version of each
section it read (`{ sectionId, version }`: for 4-12, the saved draft's `_id`
and its number of review decisions, as `<_id>:<n>`; for 3, the sorted accepted
OFI `_id`s), so a new draft, an accepted replacement, an edit or a rejection
marks it out of date. It summarises each section's saved draft as reviewed
(RV-02): an edited finding as edited, a rejected one not at all, and a
replacement only once accepted.
`metadata.COPE_dimension` is `all`. Section 1, Purpose and Scope, is not
stored: the gateway fills Marsh's standard wording from the assessment and site on each read.

| Route | Does |
| --- | --- |
| `GET /api/assessments/:reference/sections` | Sections 7-12 from the template, each with `copeDimensions`, `minObservations`, `usableObservations`, `latestDraft` (the saved draft, or `null`; a replacement waiting for a decision is not it) and `changesSinceDraft`: how many observations the newest draft's `evidence` lacks, holds in an older form, or holds that are no longer evidence (deleted or uncategorised, CP-08), which a redraft would bring up to date; and `changeCounts` `{ added, changed, removed }`, the same total by kind, which the screens name, leaving out any kind with none. 404, or 503 when S4 cannot be reached. |
| `POST /api/assessments/:reference/sections/:sectionId/draft` | Drafts and saves the section (`reports:generate`, assigned engineer only). 201 with the draft, 403, 404 (unknown assessment or section), 409 (a transcription in progress, or archived), 422 `{ error, found, needed }` (not enough usable evidence), 503 (drafting failed, with the reason). |
| `GET /api/assessments/:reference/summary` | Sections 1 and 2 (GN-07): `{ purposeAndScope, executiveSummary: { draft, missing, staleSections } }`. `purposeAndScope` is Marsh's standard Section 1 wording filled in with the client, site and locations: paragraphs, with the visit activities as a nested list. `missing` lists the sections of 3-12 not yet complete (3: no accepted OFI; 4-12: no draft), `staleSections` those changed since the summary was drafted, each `{ id, title }` in report order. 404. |
| `POST /api/assessments/:reference/summary/draft` | Drafts and saves Section 2 (`reports:generate`, assigned engineer only). 201 with the draft, 403, 404, 409 archived, 422 `{ error, missing }` while a section is incomplete (no S4 call), 503 (drafting failed). |
| `GET /api/assessments/:reference/review` | The review workspace (RV-01, RV-02): `{ sections, summary, asOf }`, sections 7-12 in template order. Each has `completion` (`state`: `not_started`, `partial` or `complete`, with `written` of `total` prose and field subsections that keep a finding not rejected, and `tables`), `review` (`state`: `not_drafted`, `ai_draft`, `in_review`, `reviewed`, or `needs_review`, which wins; with `unsupportedStatements` and `withdrawnSources` counting only findings still in the draft, `changesSinceDraft` and its `changeCounts`), `findings` (`{ total, pending, accepted, edited, rejected }`), the saved `draft` without its raw `sources`, each statement with its current `text`, `generatedText` and `review` (`state`, `at`, `by`), `sources` (each cited passage by citation ID: `kind` `standard` or `precedent`, `text`, `headings`, `pageStart`, `pageEnd`, `documentId`, and `document`: the knowledge base's current `title`, `issuingBody`, `sourceType`, `edition`, `effectiveDate`, `withdrawnAt`, `fileUrl`, or `null` with no record), `observations` (the draft's `evidence` filed under any of the section's categories, plus any other it cites, each with `copeDimensions`), `replacement` (a regenerated draft waiting for a decision, with its own `draft`, `sources` and `observations`, and `instruction`, `requestedBy`, `requestedAt`; or `null`) and `history` (the section's audit log entries, newest first). `summary` totals `findings` over the saved drafts; `asOf` is when it was read. 404, or 503 when S4 cannot be reached. |

## Review audit log (RV-02)

`review_audit_log` holds one entry per review decision on a section's draft.
It is append-only: the model (`review-audit.model.ts`) refuses every update,
replace and delete, and the gateway only adds entries. A finding's state and
text are read from it (`review-decision.service.foldFindings`), never stored
on the draft. Each entry has:

- `assessment`, `sectionId`, and `draft`: the `report_sections` `_id` decided
  on.
- `finding`: the statement as `<subsection index>.<statement index>`, e.g.
  `0.2`; `null` for a decision on a whole draft.
- `sequence`: 0, 1, 2… per draft and finding. `{ draft, finding, sequence }`
  is unique, so of two decisions made at once on one finding only one is
  saved.
- `action`: `accept`, `edit`, `reject`, `restore` (a finding), or
  `regenerate`, `accept_replacement`, `discard_replacement` (a replacement
  draft, on its own `_id`).
- `heading` (the finding's subsection), `before` (its text when decided: what
  was accepted, edited or rejected), `after` (the engineer's text, for an
  edit), `citations` (its citations then), `instruction` (for a regenerated
  draft), `bulk` (accepted by Bulk accept).
- `by` `{ id, name }`, the signed-in user as they were then, and `at`.
- `metadata` with the five required fields: `source_type: 'review_decision'`,
  `jurisdiction`, `facility_type` and `COPE_dimension` from the draft, and
  `effective_date` (when decided).

A finding starts `pending`. `accept` makes it `accepted` (from pending, or
from edited, keeping the engineer's text), `edit` makes it `edited` with the
new text, `reject` makes it `rejected` (out of the draft), and `restore`
returns it to its state before rejection. A decision that changes nothing
records nothing.

Indexes: the unique `{ draft, finding, sequence }`, and
`{ assessment, sectionId, at: -1 }` for a section's history.

Every route below needs `reports:generate`, the assigned engineer and an
assessment not archived, names the draft decided on in the body as
`draftId`, and answers with the review workspace as `GET …/review` does.
Errors: 400 (invalid body, with `fields`), 403, 404 (unknown assessment,
section, finding, or no waiting replacement of that id), 409 (archived; not
drafted; the saved draft is not `draftId`; a rejected finding accepted or
edited; a decision saved at the same moment; a replacement already waiting;
a transcription in progress), 422 (too little evidence to regenerate), 503
(S4 failed or could not be reached; nothing is saved).

| Route | Does |
| --- | --- |
| `POST /api/assessments/:reference/sections/:sectionId/findings/:finding/accept` | Accepts a pending finding (AC1), or an edited one, which keeps the engineer's text. Accepting an accepted one records nothing. |
| `PUT /api/assessments/:reference/sections/:sectionId/findings/:finding` | `{ draftId, text }` (1-2,000 characters, trimmed): the engineer's wording replaces the finding's text (AC2); the entry keeps the text before and after (AC3) and who and when (AC4). |
| `POST /api/assessments/:reference/sections/:sectionId/findings/:finding/reject` | Takes the finding out of the draft; the entry keeps its text and citations (AC5, AC6). |
| `POST /api/assessments/:reference/sections/:sectionId/findings/:finding/restore` | Returns a rejected finding to its state before rejection. |
| `POST /api/assessments/:reference/sections/:sectionId/bulk-accept` | Accepts every pending finding of the saved draft, one entry each with `bulk: true`; rejected and edited ones keep their decisions (AC7, AC8). |
| `POST /api/assessments/:reference/sections/:sectionId/regenerate` | `{ instruction? }` (up to 1,000 characters): drafts the section again through S4 as a replacement for its saved draft (AC10). 201. Only one replacement waits at a time. |
| `POST /api/assessments/:reference/sections/:sectionId/replacement/accept` | `{ draftId }` of the waiting replacement: it becomes the saved draft (AC11), every finding pending. |
| `POST /api/assessments/:reference/sections/:sectionId/replacement/discard` | Leaves the saved draft and its decisions as they were (AC12). |

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

## Knowledge documents (IN-01, KB-01, IN-07)

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
| `standardNumber` | required, the designation without the issuing body, e.g. `13` or `2-81` (IN-07 matching identity; the labeller's `standard_number`) | absent |
| `metadata.effective_date` | the edition's effective date | the report date |
| `metadata.jurisdiction` | two-letter code, or `all` (all countries; the default) | two-letter code (default `SG`) |
| `metadata.facility_type` | optional; `all` unless the admin picks one | required, one facility type |

`jurisdiction: 'all'` is the only value that isn't a two-letter code; like
`facility_type: 'all'`, retrieval must treat it as matching any site. Every
passage (chunk) in Chroma carries its document's labels (`source_type`,
`jurisdiction`, `facility_type`, `effective_date` as `YYYY-MM-DD`) next to the
pipeline's `doc_id`, `headings`, pages and `bbox`: the worker adds them at
ingest, and a correction rewrites them in place (KB-01). An Unconfirmed detail
(IN-05) is left out of the passage, since Chroma can't store null, so no filter
can match it.

Knowledge documents carry no `COPE_dimension` (an exception to the
five-field rule): each passage carries its own `section` instead (IN-05).
During ingestion, a past report's passage gets the template section it sits
in, found from the PDF's fonts: a line in the section-title size whose text
is close to one of the Global PRE template's 12 titles (`Purpose and Scope`
… `Business Interruption`; titles only, never section numbers, since reports
number them differently), taken by the page the passage starts on. Anything
after the report's last section is `Appendix`. Two more values keep "no
section" apart from "unknown section": `Not applicable` for a standard's
passages and a report's pages before its first section (cover, survey
details, contents); `Undefined` for a report passage whose section the rule
can't tell (it runs into a page where a new section starts, the report has no
titles the rule finds, it has no page, or the source type was Unconfirmed at
ingest), meant for a person to label. The rule
is in `microservices/ingestion-service/app/pipeline/sections.py`. A relabel
never sends `section`, so a correction keeps each passage's own.

Each passage also carries `status`: `active`, `withdrawn` (KB-01) or
`needs_review` (IN-05: the document has an Unconfirmed detail; IN-07: it has a
`match`). The rule, in the worker and the gateway alike: `withdrawn` if the
document is withdrawn, else `needs_review` if `unconfirmed` is non-empty or
`match` is set, else `active`. The worker indexes every passage as
`needs_review`, so a document mid-ingest is never searchable, then writes the
final status once the match step has run. A correction, a decision, withdraw and
reinstate rewrite it in place (reinstating a document that still has
Unconfirmed details or a match gives `needs_review`). Retrieval returns only passages that are neither
`withdrawn` nor `needs_review`. Passages indexed before the status label
existed have no `status`; retrieval treats that as active.

#### Automatic labelling (IN-05)

At upload the gateway asks the ingestion service's `POST /label` to read the
PDF's first `LABEL_PAGES` pages (default 20; pages without a text layer in the
first 5 are OCR'd) and fill in the seven details. A detail the models are not
confident about is **Unconfirmed**: stored as `null` in `metadata` (or no
`edition`), the one exception to the CLAUDE.md metadata rule besides
uncategorised observations. The title falls back to the file name, and
`issuingBody` is `null` while the source type is Unconfirmed. Extra fields:

- `unconfirmed`: the Unconfirmed detail names (`source_type`, `title`,
  `edition`, `standard_number`, `effective_date`, `jurisdiction`,
  `facility_type`); a report never lists `edition` or `standard_number`. Non-empty means the document **needs review**. Written by the
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
which also records `startedAt` and `finishedAt`. An admin can stop a queued or
processing document; it then ends as `cancelled`, not `failed`, and remains
retryable. `cancelRequestedAt` marks an active run waiting for the worker to
stop at a safe checkpoint, and `cancelledAt` marks terminal cleanup. Rejected
uploads are never stored.

`retryCount` tracks how many times a knowledge admin has pressed Retry on a
failed or cancelled document. It is incremented atomically — inside the same
`failed`/`cancelled → queued` status flip in `retryIngestion` — so it counts
human retries only, never automatic BullMQ re-runs of a stalled job. Its value
is never shown to the user; its sole purpose is to make each retry's ingestion
notification distinct: `retryCount` is carried in `context.attempt` of the
notification payload, which `createNotification`'s dedupe key includes, so a
document that fails, is retried, and fails again produces a second notification
rather than being deduped into silence. Starts at 0; the `knowledge_documents`
schema enforces that with `default: 0`.

A `complete` document is **active**: it is what search can use, and the only
kind the knowledge base lists or lets the admin correct (KB-01). A correction
overwrites the details in place and keeps what it replaced in `history`; the
last save wins. `history` is an embedded list, oldest first, of earlier
versions: `{ title, issuingBody, edition?, standardNumber?, metadata (all five labels),
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

#### Duplicates and newer editions (IN-07)

Two more fields on `knowledge_documents`:

- `match`: absent or `null`, or `{ kind, documentId, newMatched, newTotal,
  storedMatched, storedTotal }`. `kind` is `newer_edition`, `earlier_edition` or
  `possible_copy`; `documentId` is the stored document it repeats or updates.
  The four counts always come from the passage check, also for an edition match:
  how many of this document's passages (`newMatched` of `newTotal`) and how many
  of the stored document's (`storedMatched` of `storedTotal`) have a match in the
  other. Written only by the ingestion service's match step (see
  [services.md](services.md) "Matching"). A non-null `match` makes the document
  **needs review** until the admin decides. The API returns it with the matched
  document's `{ id, title, edition }` instead of `documentId`, plus
  `otherNeedsReview` (that document is also waiting).
- `editionFamily`: absent or `null`, or an ObjectId shared by every edition of
  one standard the admin has linked. It is the `_id` of the family's first
  document. Written only by the gateway, when a decision supersedes or adds an
  older edition. The API returns `newerEdition: { id, title, edition } | null` on
  a withdrawn family member when a later edition exists (the family's newest),
  and `reinstateBlockedBy: { id, title, edition } | null`, the active member of
  its family (the one the reinstate 409 names), computed on read.

`keep_both` gives the reviewed document the matched document's status: if the
matched one is withdrawn, the reviewed one is withdrawn too (`{ at, by }`) and
joins its `editionFamily` (when it has one); otherwise it is active. A
correction re-runs `/match` when the source type, standard number or edition
changed, not the title.

`file.sha256` has a **unique partial index** covering documents whose `status`
is `queued`, `processing` or `complete`, so a failed document's file can be
uploaded again. It stops two identical files uploaded together both being
stored. The gateway builds it at startup. It can't build while identical files
are already stored: the gateway then logs one error naming how many groups of
identical files there are, and carries on without the index. Remove the extra
copies and restart. The upload's own check still rejects most repeats.

| Route | Does |
| --- | --- |
| `POST /api/knowledge-documents` | Body is the PDF (`Content-Type: application/pdf`, up to 100 MB); `fileName` is the only query value (IN-05: the details are read from the file, a few seconds, longer for a scanned PDF). 201 queued, or 400 `{ error, fields }` / 409 (IN-07: an identical file is stored; `error` names it and its status, e.g. "Already in the knowledge base as NFPA 13 (2019 edition), Withdrawn.") / 413 / 415 / 422 / 503, each with `error` giving the reason. A labelling failure never fails the upload: every detail is then Unconfirmed |
| `GET /api/knowledge-documents` | Recent uploads, newest first: every document queued or processing, plus complete ones for 24 hours and failed ones for 7 days after `finishedAt`. Older documents stay stored, just not listed |
| `GET /api/knowledge-documents/ingested` | Every ingested document, active or withdrawn, by title A–Z (KB-01) |
| `PUT /api/knowledge-documents/:id` | Corrects a document's details (KB-01): JSON with every detail (`sourceType`, `title`, `effectiveDate`, `jurisdiction`, `facilityType`, and `edition` and `standardNumber` for a standard); partial saves are refused, so a save completes a needs-review document. `facilityType` must be one of the client's `FACILITY_TYPES` (or `all` for a standard), as at upload. 200 with the updated document (its `history` gains the replaced details, if any changed), or 400 `{ error, fields }` / 404 / 409 (not active) / 503 (search not updated, old details and history kept) |
| `POST /api/knowledge-documents/:id/withdraw` | Withdraws an active document (KB-01), no body. 200 with the document (`withdrawn` set), or 404 / 409 (not complete, or already withdrawn) / 503 (search not updated, still active) |
| `POST /api/knowledge-documents/:id/reinstate` | Reinstates a withdrawn document (KB-01), no body. 200 with `withdrawn: null`, or 404 / 409 (not withdrawn, or IN-07: another edition in its `editionFamily` is active, named in `error`) / 503 (search not updated, still withdrawn) |
| `POST /api/knowledge-documents/:id/retry` | Retries a failed or cancelled ingestion without re-uploading (the PDF and all details are kept). Flips `status` to `queued`, clears terminal error/cancellation fields, increments `retryCount`, and re-queues the ingestion job. 202 on accept, 404 unknown, 409 not retryable (someone already retried it), 503 queue unreachable (document is restored to its previous terminal state, counter rolled back). `knowledge:manage` only |
| `GET /api/knowledge-documents/:id/comparison` | The document, the document its `match` points to, and their passages side by side (IN-07): `{ document, matched, rows }`. 200, or 404 / 409 (no match, or the matched document is gone) / 503 |
| `POST /api/knowledge-documents/:id/decision` | The admin's decision on a match (IN-07): `{ choice }`, one of `keep_both`, `discard_new`, `discard_other`, `supersede`, `add_as_older` (effects in [services.md](services.md)). Needs `knowledge:manage`. 200 `{ document }`, with `document: null` after `discard_new`; or 400 (unknown choice) / 404 / 409 (details still Unconfirmed, no match, the matched document gone, a choice that doesn't fit the match, or `supersede` while another edition in the stored edition's family is still active) / 503 (nothing changed) |
| `GET /api/knowledge-documents/:id/file` | Streams the original PDF from S3; 404 for an unknown ID |

### Ingestion jobs (`ingestion_jobs`)

One document per ingestion run, written by the ingestion worker and read by the
gateway to enrich the `KnowledgeDocument` DTO (E2). Keyed by `documentId` (unique
index → `knowledge_documents._id`), so the gateway finds a run with one query and
no `$lookup`. Fields: `currentStage` (one of `parsing`, `anonymising`,
`chunking`, `indexing`, `complete`, `failed`), `pageCurrent` and
`pageTotal` (the page reached and the document's page count: while parsing, the
last page parsed, `0` as parsing starts, then written after each 10-page batch; while chunking, the page being
chunked, set to the page count once every page has been walked (trailing blank or
image-only pages yield no chunk); while indexing, the furthest page embedded after
each Cohere batch, then the page count — progress is tracked by page because the
chunk total is not knowable up
front; both set back to null at the start of every stage, so one stage's count
never shows under the next), `ocrCurrent` and `ocrTotal` (during chunking's OCR
pass, the table and formula regions read so far and the number queued: `0` of the
total as the pass starts, then one more per region; counted by region because
regions finish out of page order; null until the pass starts, when nothing needs
OCR, and at the start of every stage), `stageLog` (completed stages, each with
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

Collection `ai_calls` (`server/src/models/ai-call.model.ts`). One document per paid AI call, saved by the gateway (`ai-usage.service.ts`) from the `usage` list that the Python services return. The services never write it. Ingestion is the exception to "one per call": its many small calls are summed into one row per document, stage and model (see `callCount`).

| Field | Meaning |
|---|---|
| `feature` | `draft-section`, `retrieval`, `transcribe`, `label-document`, `interpret-photo`, `ocr`, `embed-document` or `chat` |
| `billedService` | who bills us: `anthropic`, `cohere-embed`, `cohere-rerank`, `openai-whisper`, `openai-label`, `typesafe-jev`, `gemini-vision`, `gemini-ocr`, `self-hosted-ocr` |
| `model` | the exact model the provider reported |
| `reportId` | the assessment reference (absent for labelling, ingestion and chat, which have no report) |
| `documentId` | the knowledge document a labelling or ingestion call was for (absent otherwise) |
| `userId` | the signed-in user who sent a chat message (chat only; report calls are attributed to the assessment's assigned engineer when read) |
| `section` | the report section id a draft was for, as in `report_sections.sectionId`: `7`–`12` for drafted sections, `3` for OFIs, `2` for the executive summary (drafting only; absent on rows saved before it existed) |
| `callCount` | how many provider calls the row stands for: 1, except ingestion rows, which sum a document's calls per stage and model |
| `durationMs` | how long the call took (for an ingestion row, the total of its calls) |
| `inputTokens`, `outputTokens`, `cacheReadTokens` | provider-reported; `null` when not reported |
| `searchUnits`, `audioSeconds` | Cohere rerank and Whisper billing units |
| `usageStatus` | `recorded`, or `unavailable` when the provider gave no usage data |
| `estimatedCostUsd`, `pricingBasis` | the estimate and where its price came from; cost is `null` when there is no price or no usage |

- One draft writes three rows: Claude, Cohere embed and Cohere rerank.
- A draft that fails after its paid calls (refused, cut off) is not recorded: the service raises before it returns the list.
- Prices are list prices in `ai-pricing.service.ts` (Claude and Whisper from the vendors' pages, read 2026-10-08; Gemini from ai.google.dev/gemini-api/docs/pricing, read 2026-10-13, with its announced 2027-01-01 rise applied by call date). Self-hosted OCR costs $0 per call, with that named as its basis. Cohere publishes no per-use price, so those two are estimates, set by `COHERE_EMBED_USD_PER_1M_TOKENS` and `COHERE_RERANK_USD_PER_1K_SEARCHES`.
- A failure while saving is logged and ignored, so bookkeeping can never fail a draft or a transcription.
- Read by the EV-04 cost report (`usage-report.service.ts`).
- Indexes: `feature`, `billedService`, `reportId`, `documentId`, `userId`, `createdAt`.

### Where each `ai_calls` field comes from (EV-03)

Each provider reports usage differently. The services rename it into one shape (the "wire" item), and the gateway cleans it and saves it.

| Provider field | Wire item (Python to gateway) | Stored field (`ai_calls`) |
|---|---|---|
| Anthropic `usage.input_tokens` | `input_tokens` | `inputTokens` |
| Anthropic `usage.output_tokens` | `output_tokens` | `outputTokens` |
| Anthropic `usage.cache_read_input_tokens` | `cache_read_tokens` | `cacheReadTokens` |
| Cohere embed `meta.billed_units.input_tokens` | `input_tokens` | `inputTokens` |
| Cohere rerank `meta.billed_units.search_units` | `search_units` | `searchUnits` |
| Gemini `usage.total_input_tokens` | `input_tokens` | `inputTokens` |
| Gemini `usage.total_output_tokens` + `total_thought_tokens` (both billed as output) | `output_tokens` | `outputTokens` |
| Number of provider calls summed into one ingestion row | `call_count` | `callCount` |
| Whisper `verbose_json` `duration` (seconds) | `audio_seconds` | `audioSeconds` |
| Time around the call (`perf_counter`) | `duration_ms` | `durationMs` |
| Labelling `seconds` (gateway multiplies by 1000) | `duration_ms` | `durationMs` |
| Labelling `cost_usd` (kept as the service's own cost) | `cost_usd` | `estimatedCostUsd` |
| Labelling `model`, mapped to its vendor | `billed_service` | `billedService` |
| Which code path made the call | `feature` | `feature` |
| Provider gave nothing | `usage_status: "unavailable"` | `usageStatus` |
| Assessment reference, added by the gateway | not sent | `reportId` |
| Knowledge document id (ingestion sends it; the gateway adds it for labelling) | `document_id` | `documentId` |
| Report section, added by the gateway | not sent | `section` |
| Session user, added by the gateway for chat | not sent | `userId` |
| Price table lookup, added by the gateway | not sent | `estimatedCostUsd`, `pricingBasis` |

What the gateway does on the way in (`ai-usage.service.ts`): non-numbers become `null`; items with an unknown feature or service are dropped; the status becomes `unavailable` when every amount is empty; cost is never computed from partial usage; names change from snake_case to camelCase.

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

## 2026-09-26 — Voice transcription runs in the gateway, tracked in MongoDB

Chose: the gateway starts each transcription itself after saving the
recording, and records its status and attempts on the observation document.
Rejected: a job queue (Redis/BullMQ, SQS) or a separate worker.
Reason: one transcription per recording at capture volume does not justify
broker infrastructure (see the orchestration decision above). S5 stays
stateless and never writes to MongoDB. The cost is that an attempt running
when the gateway restarts is lost; startup marks it failed so the engineer can
retry. Move to a job collection with a worker if volume grows or restarts
become common.
Story: CP-03.

## 2026-09-29 — One observations collection, one Mongoose discriminator per kind

Chose: text notes join voice notes in `observations`, told apart by `type`,
which is the Mongoose discriminator key; each kind has its own model and
required fields. An uncategorised text note stores `COPE_dimension: null`.
Rejected: a separate collection per kind, which splits the per-assessment list
and the drafting inputs; one schema with every kind's fields optional, which
loses the database's check that a voice note has its audio; and a placeholder
category such as `'Uncategorised'`, a value the knowledge base never uses that
every retrieval filter would have to remember to exclude. Reason: the report
treats all captures as one observation structure, and null keeps the
metadata field present (the CLAUDE.md rule) without inventing a category.
Story: CP-02.

## 2026-09-29 — One observation holds its note and recordings

Chose: an observation is one thing the engineer saw, stored as one document
with an optional `note`, a `recordings` list (each with its own transcription)
and, from CP-04, photos. The category, severity, location and standard are
stored once for all of them, and it is saved in one multipart request.
Supersedes the same day's discriminator decision (one document per note or
per recording). Rejected: keeping one document per item and grouping them with
a shared ID, which copies the category and severity onto every item so later
edits (CP-06, CP-08) could leave them disagreeing, and makes drafting regroup
them. Reason: design-system rule 8 already treats note, voice and photo as
modes of one record, and the report cites an observation with all its
evidence. Any observation, not only a note, may now be left uncategorised.
Stories: CP-02, CP-03.

## 2026-09-29 — Locations on the assessment, chosen from a sheet on the capture screen

Chose: engineers add the site's locations (a name and optional floor) during
capture. They are embedded in the assessment, and each
observation stores its location's id. On the capture screen a sticky location
bar opens a sheet to search, pick or add one; it opens by itself until a
location is chosen, and is a bottom sheet on phones. Rejected: a separate
locations page before the observation page, since on a phone every switch of
location would cost two screen changes; a location type field, which nothing
used and which usually repeats the name ("Stairwell B"); and storing the location's name on the observation,
which a later rename would split. Reason: engineers walk a site area by area on
a phone, so switching location should take one tap.
Stories: CP-02, CP-03.

## 2026-09-30 — Tags are edited in place, and a location's name is its zone

Chose: `PATCH /api/observations/:id` changes an observation's category,
severity, location and standard in place, from an Edit tags dialog on the
Observations tab. CP-06's zone is the location's name and its floor the
location's `floor`, so no new field. The tab filters by category, severity,
location and floor in the browser. Rejected: a zone field on locations, which
the 2026-09-29 decision already turned down and which would usually repeat the
name; leaving all editing to CP-08, which would keep an observation saved
uncategorised out of drafting until Sprint 2; and filter parameters on the
list route, since the tab already loads every observation and sample ones
never reach the gateway. Reason: CP-06 asks for tags that persist and filter,
and no draft cites an observation yet, so overwriting a tag loses nothing.
Once drafts cite observations, CP-08 should keep the prior version (its AC5).
Story: CP-06.

## 2026-09-30 — Knowledge ingestion runs on a Redis/BullMQ queue
Chose: the gateway stores each uploaded PDF in S3, records it in MongoDB
and adds a job to a BullMQ queue in Redis; a separate Python worker
(`ingestion-worker`, same image as the ingestion service) takes one job at
a time, runs the ingestion pipeline and writes the outcome to MongoDB.
Rejected: running ingestion inside the gateway like transcription (above),
or inside the ingestion service's HTTP process. Reason: one parse takes
minutes on CPU, so a restart would lose work that is expensive to redo, and
several uploads must wait their turn rather than compete for the CPU. This
follows the interim report (Redis + BullMQ for background jobs). Python and
Node BullMQ share one queue format, so the gateway enqueues in Node and the
worker consumes in Python. Transcription keeps its no-broker design.
Story: IN-01.

## 2026-09-30 — Two roles, one permission matrix on the gateway

Chose: two roles, `risk_engineer` and `knowledge_admin`, and six named
permissions (`assessments:view`, `assessments:edit`, `reports:generate`,
`knowledge:view`, `knowledge:manage`, `users:manage`) mapped to roles in one
file, `server/src/services/permissions.service.ts`. Every protected route
names its permission; the gateway sends the role's list with the session, and
the client hides and blocks screens with it. Knowledge admins can read
assessments but not change them; risk engineers can open knowledge documents
(for citations) but not upload them. Each screen now has a URL so a blocked
one can be opened, and refused, directly. Rejected: keeping the `reviewer`
role, which F-05 does not list; a wildcard admin, which would let a knowledge
admin draft reports; and checking roles in route handlers, which scatters the
matrix. Reason: F-05 asks for an agreed matrix enforced on both the browser
route and the API, and one list keeps them from drifting. The role is read
from the signed session, so a change applies at next sign-in.
Stories: F-04, F-05.

## 2026-10-02 — The dashboard continues the engineer's own capture, by name

Chose: the dashboard's capture button reads "Continue capture · <site>" and
opens the engineer's own assessment with a capture session in progress, the
most recently started if there are several; the work list now carries each
assessment's `captureStartedAt` for this. With none in progress the button is
hidden. The side navigation offers Site observation and Open assessment only
for an assessment on the work list, so the demo default (RPT-2026-0411) is no
longer offered to an engineer it is not assigned to. Without the gateway the
button opens the demo assessment, as before. Rejected: the unnamed Site
observation button, which opened whichever assessment was last opened, or
RPT-2026-0411 for everyone, so a note could be saved to the wrong site;
removing it, which costs a tap on every site visit; and switching the side
navigation to the capture in progress by itself, which would list under Open
assessment one the engineer never opened. Reason: an observation's assessment
is part of its evidence trail, so the engineer should see which one capture
opens. This changes only what the browser offers: the gateway still accepts
capture on any assessment from any risk engineer who knows its reference.
Stories: CP-01, RV-10.

## 2026-10-03 — Report sections 7-12 are drafted from a versioned template, with checked citations

Chose: Marsh's Global PRE Report Template v2.0 (Feb 2026) is read once into
`rag-service/app/generation/sections.json`. It lists the technical sections
by their template numbers, 7 (Construction) to 12 (Business Interruption),
which GN-01 calls sections 6-12. Section 6 in v2.0, Management Programs, is
left out. Each entry has its subsections in order, the COPE categories it
draws observations from, and the minimum usable observations. Its `version`
is saved with every draft. The writing conventions come from
`drafting-skill.md`, our version of Marsh's PRE drafting skill, loaded into
the prompt (prompt `gn01-v2`). It sets the voice (engineering before
compliance, no recommendations), the house conventions (Singapore English,
observed versus reported, units), and up to three questions for the engineer
returned with each draft. Sections 7-12 state findings only, as Marsh's own
reports do: what a control does or is for, and classifications that follow
directly from the evidence, are allowed; sentences on what a condition may
lead to are not. Drafts that were allowed such sentences when a standard
supported them wrote them without one (prompt gn01-v2, 4 Oct 2026), and the
citation check cannot tell them from findings. Judgement on significance
belongs in Sections 3 and 4.
The gateway loads the assessment's observations and sends every categorised
one with a note or a finished transcript. Observations filed under the
section's own categories are its main evidence: they alone decide whether
there is enough to draft, and they alone steer the standards search. Those
under other categories go into the prompt as backup, for the model to use
only where they directly concern the section, since one finding can belong
in several sections. Uncategorised observations stay out (CP-02 AC4). S4 then:
1. retrieves standard passages (`fm_standard`, `nfpa_standard`) for each
   subsection, and past-report passages under the same section heading;
2. has the LLM return structured JSON, each statement listing the IDs it
   cites: `O:<observation id>`, `C:<chunk id>`, or `P:<chunk id>`;
3. lays the draft out in the template's order, whatever order the model used;
4. marks a statement unsupported if it cites nothing, or cites an ID it was
   not given.

Past-report passages (`P:`) are wording and precedent only, never citable,
since they describe other sites. Table subsections (measured values) are not
drafted; GN-03 fills them. The gateway saves each draft as a new
`report_sections` document with its provider, model, effort, prompt version
and template version. S4 stores nothing. The model is Claude Opus 5.5 at `high` effort
(`LLM_MODEL`, `LLM_EFFORT`), to be raised to `xhigh` only if comparing drafts
of every section shows it is better.

Rejected:
- Free-text generation with citations parsed out of prose: the IDs would have
  to be found in the text, and a missing one would go unnoticed.
- Building the template from retrieved past-report headings at request time:
  it depends on Chroma's contents, and the past reports number their sections
  differently from v2.0.
- Letting the model decide the section's structure: AC5 needs it fixed.
- Sending only the section's own category: a finding filed under Protection
  could never reach Occupancy.
- Sending every observation with no main evidence: the engineer's category
  would stop meaning anything, and a per-section evidence check would be
  impossible.
- Multi-category tags on observations: these would change CP-02 and CP-06,
  which other teammates own.

Reason: GN-01 needs every statement traceable to an observation or a source
passage (AC3, AC4), the template's structure (AC5), and a record of the
configuration that wrote it (AC7). Checking whether a cited source actually
supports its statement is GN-02.

Stories: GN-01.

## 2026-10-03 — CP-14 dropped: drafting needs no completed capture, and each draft keeps its evidence

Chose: the team dropped CP-14 (complete a site assessment) as redundant. GN-01
therefore no longer requires a `ready_for_generation` capture session. A
section can be drafted, and drafted again, whenever it has enough evidence, as
long as the assessment is not archived and no recording is still being
transcribed. The two things CP-14 gave that still matter now live with each
draft:
- `report_sections.evidence` keeps the observations as the draft was given
  them, the snapshot CP-14 AC2 and AC4 asked for, scoped to what that draft
  used.
- `GET /sections` counts `changesSinceDraft`: observations added or changed
  since the newest draft. The screen asks the engineer to redraft to include
  them.

Rejected:
- Keeping the session gate. Nothing sets `ready_for_generation` without
  CP-14, and simply opening Site observation starts a new active session,
  which blocked drafting again.
- A separate assessment-wide snapshot. Each draft holding its own evidence is
  smaller, and it is the evidence a reviewer checks citations against.

Reason: an engineer should be able to draft early and redraft as evidence
comes in, while every draft stays traceable to what it was written from.
`ready_for_generation` and the "Ready to generate" status are now unused.

Stories: GN-01, CP-14 (dropped).

## 2026-10-05 — The LLM judge's pass mark is weighted by the cost of each error

Chose: a draft passes AC13 when its scores, averaged over two judge runs, are
at least 4.0 for groundedness and no invention, 3.5 for structure and
coverage, and 3.0 for conventions, with a mean of at least 4.0
(`eval/judge_sections.py`, `PASS_FLOORS`). Each criterion starts at 5 and
loses 1 per major issue and 0.5 per minor one, so 4.0 allows one major issue.

Rejected:
- A flat 4.0. Marsh's own report text scores 1.0-3.0 on conventions against
  our drafting guide, so the bar would fail Marsh's real reports and measure
  how our style list differs from Marsh's, not draft quality.
- A flat 3.0. It allows two major issues per criterion, so a section with two
  fabricated facts would pass.

Reason: unsupported or invented statements mislead an insurer and read
plausibly in review, so they get the strictest floor. Misplaced or missed
points are visible to the reviewing engineer. Style slips are cosmetic, and
the judge is least consistent on them (the same draft got 4 and then 2
convention issues). Two runs are averaged because scores vary by about 0.5
between runs. Move to a flat 4.0 once Marsh confirms the drafting guide's
conventions.

Stories: GN-01 (AC13).
## 2026-10-04 — A new account sets its first password through the reset

Chose: a knowledge admin creates an account with no password, and its owner
sets one with Reset password on the sign-in screen (F-06), which already
works for any active account. The gateway assigns the staff ID from a
counter, and the new account always starts active. Rejected: the admin
typing a first password, which means one person knowing another's password
and sending it outside the app; and emailing a separate set-password link on
creation, which the sign-in screen has no way to redeem without first
requesting a reset. Reason: F-08 needs the new employee to sign in to their
role's screens, and the reset flow gets them there with no new password
handling. A real welcome email can reuse the same token once email delivery
exists.
Story: F-08.

## 2026-10-06 — Retrieved passages are reranked once per section

Chose: after the per-observation vector search, one Cohere Rerank call per
section orders all candidate standard and past-report passages against the
section's own observations, and only the top 12 and top 4 are sent
(`orchestrator.draft`). If rerank fails, the draft goes ahead in vector order.

Rejected:
- One rerank call per observation. It ranks each finding's passages best, but
  the Cohere trial key allows 10 rerank calls a minute, and drafting the whole
  report would make dozens.
- A minimum relevance score. With only the FM-200 manual ingested, there is no
  data to set one; the 0.60 distance cut stays as the off-topic filter.

Reason: vector distance finds passages on the same topic; a reranker reads the
query and passage together, so it is better at picking the passage that bears
on a finding (AC6). The search stays per observation, so each finding still
puts candidates forward; only the final pick is section-wide. Drafts are not
blocked by a rate limit on an optional step.

Stories: GN-01 (AC14).
## 2026-10-05 — The review workspace reads one gateway route, and a section's review state comes from its draft's checks

Chose: the Review tab of a saved assessment reads
`GET /api/assessments/:reference/review`, which returns every section 7-12
with its completion and review states, its newest draft, the passages it
cites and the observations it was drafted from. Rail, draft and source panel
on one screen: sections left, draft centre, provenance right, as the design's
review workspace lays out.
- A cited passage shows its text, headings and pages as the draft saved them,
  and its document's title, edition, effective date and withdrawal as
  `knowledge_documents` holds them now, looked up in one query.
- Completion counts the template's prose and field subsections the draft
  writes; tables are left out, since GN-03 fills them.
- Review state is `not_drafted`, `ai_draft`, or `needs_review` when a
  statement is unsupported, a cited document has been withdrawn, or
  observations changed since drafting. RV-02 adds the engineer's decisions.
- S4 now keeps a cited past-report passage (`P:`) in the draft's `sources`, so
  it can be opened like a standard. It still cannot support its statement.
- The observations shown are the draft's own `evidence`, filed under the
  section's categories or cited by it, not the observations as they are now.

Rejected:
- Reading the document details from the passage's Chroma labels: they hold no
  title or edition, and a withdrawal after drafting would never show.
- Joining `GET /api/knowledge-documents/ingested` in the browser: it lists the
  whole knowledge base, and RV-04 needs the withdrawn-source check on the
  gateway anyway.
- One request per opened citation: every passage a section cites is already
  in its draft, and the reviewer opens most of them.
- Adding a stored review status now: nothing sets one until RV-02 records
  decisions, so a derived state is the only honest one.

Reason: RV-01 asks for each claim to be checked against the exact passage,
its page and its document's current standing, which needs both what the draft
was given and what the knowledge base says now.

Stories: RV-01.

## 2026-10-07 — Documents are labelled automatically by a cheap classifier plus a cheap LLM, chosen by measurement

Chose: on upload, ingestion-service's `POST /label` reads the first
`LABEL_PAGES` (20) pages of the PDF and fills its details.
- Fixed-list details (source type, country, facility type) come from the Jev
  classifier. A detail below the `LABEL_MIN_CONFIDENCE` cutoff (0.70) is left
  Unconfirmed.
- Free-text details (title, edition, effective date) come from GPT-6 Luna
  (~$0.001 a document). A value is kept only if its quote is found on the page
  the model names (grounding).
- Scanned pages are OCR'd with the IN-06 engine selection, capped at the first
  5 pages.
- A document with any Unconfirmed detail is `needs_review`. Its passages stay
  out of search until an admin fills the details in.
- Labelling has its own `LABEL_LLM_PROVIDER`/`LABEL_LLM_MODEL`, separate from
  rag-service's `LLM_PROVIDER`. Labelling is a small extraction task where a
  model 12× cheaper scores the same, while drafting needs the strongest model.
- A passage's COPE category comes from the Marsh report section it sits in.
  Section titles are found by font size (lines set like the mapped titles,
  28 pt), with Docling's heading trail as a fallback when no mapped title is
  found.
- Effective date is never Unconfirmed. A standard gets the upload date, since
  its effective date is when the admin makes it the current copy, not a date
  printed in it. A report keeps its grounded date, else gets the upload date.
  The upload date is Singapore's (UTC+8), and the gateway applies the same
  default when /label fails, so no upload ever waits on its date.
  Reason: the date is not something a model can reliably find, and a missing
  one would hold every dateless upload in review.
- If the classifier fails but the LLM answers, the fixed-list details use the
  LLM's own answers (stored model = the LLM). Reason: one failed cheap call
  should not turn a whole upload into manual work. If the LLM fails, every
  detail except the date is still Unconfirmed.
- The Documents tab counts the documents needing review, and the banner names
  them (at most three, then "and N more", with a button to filter to them).
  Withdrawn documents are left out: they can't be edited. Reason: until the
  app-wide notifications story lands, this is how an admin learns that an
  upload needs them.

Rejected:
- Reading only the first 5 pages. Golden evidence showed reports state the
  country only through "Currency: SGD" on pp. 12–20, and the facility type on
  p. 6.
- COPE from Docling heading trails alone. Docling mis-nests Marsh section
  headings: 391/661 passages (59%) were correct on the golden reports, against
  661/661 (100%) with font sizes.
- Claude Haiku 4.5 for free text: 93% correct on the tuning split against
  Luna's 100%, at about 12× the cost.
- Claude Haiku 5.5 (released 2026-10-07, thinking off, same per-token price as
  Luna) for free text: it matches Luna (96% of auto-filled details correct
  across all cases, 46 filled against Luna's 47) and is faster (2.7 s against
  3.6 s a document), but costs about 1.7× more a document. Its tokenizer turns
  the same pages into about 1.7× as many tokens. It doesn't change either
  winner.
- The OpenAI Decisions classifier: as accurate as Jev on the tuning split, at
  about twice the cost.
- Picking the lowest cutoff that reaches 90%. It chose a less accurate point
  with the same auto-fill rate. The rule is: among cutoffs reaching 90% on the
  tuning split, take the most auto-fill, then the higher accuracy, then the
  lower cutoff.
- A 30 s or 90 s gateway timeout for labelling. In Docker, OCR of a scanned
  file's first 5 pages takes about 30 s alone, but about 100 s while the
  worker is OCR-ing another scan, which is the usual case when several are
  dropped at once. So the gateway waits 180 s. On failure, every detail is
  left Unconfirmed.

Reason: AC11 asks for ≥ 90% of auto-filled details to be correct. The models,
cutoff and prompt hints were tuned on the tuning split only, then scored once
on the test split (95% of auto-filled details correct; 87% auto-filled). See
`microservices/ingestion-service/eval/labelling/results/2026-10-08.md` (the
2026-10-07 run plus Haiku 5.5).
Anthropic structured output allows at most 16 nullable fields, so evidence
uses `0` and `""` for "none" instead of null.

Known coverage gap: the golden reports are all Singapore and cover three
facility types (office, mall, mixed-use). Other countries and facility types
are untested.

Stories: IN-05.

## 2026-10-07 — CP-06 merges into CP-08, and observations are corrected in place, soft-deleted and changed only by the assigned engineer

Chose: CP-06 (tag an observation) is merged into a new CP-08 (manage
captured observations), since both change the same document on the same tab
through the same route. KB-02 into KB-01 was the precedent. The merged ACs
read "name" as the location and floor (as CP-06 did), define status as
Transcribing, Transcription failed or Complete, and list the whole assessment
rather than one capture session, which the engineer never sees.
- A note edit or tag edit overwrites the observation in place, with
  `edited: { at, by }` naming who made the latest change. The traceable
  record of what a draft cited is the draft's own `evidence`, which already
  holds each observation as it was drafted from.
- A transcript correction is stored beside Whisper's words, never over them:
  `transcription.correction` is what drafting uses, `transcript` is evidence
  of what was said. Only a finished transcription can be corrected.
- Deleting sets `deleted: { at, by }` and removes nothing, as RV-10's archive
  and KB-01's withdraw do. `listObservations` leaves deleted observations out,
  so the list, section counts and drafting all drop them in one place; Show
  deleted lists them, and restoring removes the mark.
- `changesSinceDraft` now also counts observations a draft was given that are
  no longer evidence (deleted or uncategorised), so the draft shows as out of
  date. `changeCounts` splits that total into added, changed and removed, and
  the warning names only the kinds that happened ("2 observations added and 1
  removed"). The total alone still decides whether the draft is out of date.
- Only the assessment's assigned engineer can change, delete or restore its
  observations, and not once it is archived, as for its other details
  (RV-10). This tightens CP-06, which let any risk engineer retag. Capturing
  and retrying a transcription stay open to any risk engineer.
- Categories are shown as the values they are stored as (Construction,
  Occupancy, Protection, Exposure, Uncategorised), as AC7 names them, rather
  than as report section names ("Fire protection"). The client no longer maps
  labels to stored values.

Rejected:
- An edit history on each observation, as KB-01 keeps for documents: no AC
  asks to browse earlier wording, and the version that matters, the one a
  draft cited, is already in that draft's `evidence`.
- Copying a transcript into the note to edit it ("Edit as text note", design
  annotation 23): drafting would then read the same words twice, as both
  transcript and note.
- Removing a recording from an observation, or deleting an observation for
  good: either would remove raw evidence.
- Owner as the engineer who captured the observation: observations saved
  before CP-02's revision have no capturer ID, and every other change to an
  assessment already goes by its assigned engineer.

Reason: CP-08 asks for observations to be corrected and removed while every
draft that cites one stays traceable, and the merged ACs keep CP-06's
behaviour while closing its overwrite-in-place gap now that drafts cite
observations (the CP-06 entry above anticipated this).

Stories: CP-08 (with CP-06 merged in), CP-02, GN-01.

## 2026-10-07 — Photos join the observation, their format is read from the image, and the collection is a tab

Chose: an observation gains a `photos` list (CP-04), as the 2026-09-29
decision planned, saved in the same multipart request as its note and
recordings. Each photo's original goes to S3 at
`photos/<reference>/<observation id>/<photo id>.<jpg|png>` and is never
altered; CP-05's interpretation and CP-10's annotation can attach to a photo by
its `_id`.
- Only JPG and PNG are stored, and the gateway decides by the file's first
  bytes, not the type the browser sends. The client refuses other types first,
  with the same wording, so the engineer learns before saving.
- Two pickers (AC6): Take photograph, whose `capture` attribute sends a phone
  straight to its camera, one photo per shot; and Choose photographs, without
  it, for several from the library. Chrome on Android 14 and 15 opens
  Android's photo picker for an image-only picker, which has no camera, so
  one picker without `capture` left Android engineers unable to take a photo
  (found testing on a phone, 7 Oct 2026). A desktop browser ignores
  `capture`, so Take photograph is hidden where the main pointer is a mouse.
- The photo collection (AC3) is a Photos tab in the assessment workspace,
  built in the browser from the observation list it already loads, leaving
  out deleted observations as drafting does. AC3 originally ended "then the
  image is available for the report photo appendix", which no screen could
  show: the appendix is EX-01 (its AC3), and the Export tab is still
  simulated. It now reads "every photo saved with the assessment's
  observations is listed, except those of deleted observations", which
  CP-04 can deliver on its own; EX-01 draws its appendix from the same
  photos.
- Thumbnails load the original, which the gateway marks cacheable since the
  image under a photo's id never changes.
- Photos are not drafting evidence yet: `report_sections.evidence` is
  unchanged, so no existing draft reads as out of date.

Rejected:
- Trusting the browser's type or the file extension: an iPhone's HEIC renamed
  `.jpg`, or a file with no type, would be stored as a JPG that nothing can
  open.
- Converting HEIC to JPG in the gateway: it alters the raw evidence (AC1)
  and needs an image library for one phone setting. iOS usually converts to
  JPG itself when the picker asks for JPG or PNG; the engineer is told when
  it does not.
- One picker without `capture`, the first version: no camera on Android 14+.
- Widening the picker's types so Android shows its camera (adding
  `text/plain`, or the non-standard `android/allowCamera`): the first lets any
  file through the picker, the second is undocumented and could stop working.
- A gateway route for the collection: no screen needs more than the
  observation list already holds, as with the Observations filters
  (2026-09-30). Export (EX-01) reads the photos from the observations.
- Resized thumbnails: they need an image library and a second stored copy;
  CP-10 already adds derivative images, so thumbnails can follow that.

Reason: CP-04 asks for the original kept as evidence, linked to its
observation and available to the report appendix, and for photos taken on the
device to upload as normal. Reading the format from the image is what makes
"rejected with a format message" hold whatever the browser reports.

Stories: CP-04.

## 2026-10-08 — AI-call usage is returned by the services and saved by the gateway

Chose: each Python service adds a `usage` list to the response it already sends
(drafting, Whisper) and the gateway saves one `ai_calls` row per paid call and
works out the cost from a dated price table. Labelling already priced its own
calls, so the gateway keeps that cost and names its basis. Missing provider
usage is stored as `null` with `usageStatus: "unavailable"`, never 0. Saving
never throws. Cohere's prices are labelled estimates because Cohere publishes no
per-use price. Rejected: a callback from each service to a gateway route, which
needs a service key, a gateway address and an HTTP client in two more services
for no gain (every call already returns to the gateway), and which would break
the rule that S5 writes nothing to MongoDB; and storing each provider's raw
response, which no one could add up across providers.

Reason: EV-04 needs totals per feature, report and billed service, so every
call has to share one shape. Known gap: a call whose service then fails (a
refused draft) is not recorded, and ingestion-time embedding is not covered.

Stories: EV-03.


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
Partly superseded 2026-10-29: the location navigator on the Observations tab now
filters the list (see "Site walks: proposal first"); the sheet on the capture
screen remains.

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
Superseded on 2026-10-22: the new employee is emailed an invitation instead (below).

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

## 2026-10-08 — The reset email goes over SMTP with a console fallback, and the browser times itself out

Chose: the password reset email (F-06) is sent through SMTP when `SMTP_HOST` is
set (Gmail with an app password for our demo) and carries a link
`APP_URL/?reset=<code>`; the sign-in screen opens at the new-password step with
the code filled in and removes it from the address bar. With no `SMTP_HOST` the
code is printed to the server console as before, so CI and fresh checkouts need
no mail server, and the server tests force `SMTP_HOST` empty so a developer's
real `.env` can never make a test send mail. A send failure is logged and the
response stays identical to success, and real sends are not awaited, so
neither an outage nor response time reveals which addresses are registered.
F-07's browser half is a 15-minute idle timer (`useIdleTimeout`) that signs
out on its own, because the gateway cannot tell an idle page its session
ended. Rejected: making SMTP settings required, which breaks CI; a
transactional email service (SES, SendGrid), which adds an account and a
dependency for one email; and polling the gateway to detect expiry, which
would count as activity and keep the session alive.

Reason: AC1 needs a real emailed link, but the project has no mail
infrastructure; generic SMTP settings work with any provider.

Stories: F-06, F-07.
## 2026-10-08 — Photos are read by Gemini in S5, once per observation, as a proposal only

Chose: S5 interprets an observation's photos with Gemini (`gemini-3.8-flash`)
behind its own `VISION_PROVIDER` setting, as the team's flowchart and
architecture diagram place it: photo captioning beside Whisper and OCR, in the
service that turns captured media into text. The gateway starts it after
saving, as it does a transcription, and stores the result; S5 stores nothing.
- One interpretation per observation, covering all its photos in one call.
  This replaces the CP-04 entry's plan to attach it per photo: the category
  is a tag on the whole observation, Marsh's own observations often rest on two
  or three photos of one finding, and photos can't be added after saving, so
  the set is fixed.
- The model sees the photos, the location and the note, never the engineer's
  category or severity, so the category it proposes is its own.
- It answers in a fixed form: a description in Marsh's "it was observed that"
  style, one of the four COPE categories, and a hazard type from the OFI Types
  in Marsh's sample reports, plus Other and "No hazard visible". Many site
  photos only record a condition as found, and a list without that option
  would make the model invent a hazard. The list is provisional until Marsh
  confirms the template's own.
- S5 turns each photo upright from its EXIF orientation and shrinks it to
  1600 px before sending (Pillow); the original in S3 is never changed. The
  model never reads EXIF, so a portrait phone photo would arrive on its side,
  and Gemini caps a request at 20 MB while CP-04 accepts 20 MB photos.
- The proposal is not drafting evidence. Drafting does not wait for it,
  never reads it, and a draft is not out of date when it arrives. Use as note
  and Change category open the Edit dialog with the proposal filled in, so it
  becomes the engineer's only when they save it; Use as note appends, never
  replaces, what they wrote.
- Interpreting and Interpretation failed join the Observations tab's status,
  as transcription's do. A failure can be retried; a gateway restart marks an
  attempt still running as failed.
- Each proposal keeps its provider, model, prompt version and token usage
  (EV-03); usage is null when the provider reports none.
- Without a capture session the demo shows a sample proposal per category,
  labelled as a sample, not a reading of the photo.

Rejected:
- S4 with Anthropic, which already has a provider switch, structured output
  and refusal handling in `llm.py`, so it was less work. The team's diagrams
  put photo captioning with the media-to-text steps, and Miya, who built S5,
  agreed to host it there.
- One interpretation per photo: three photos of one finding could propose three
  categories for one observation.
- Sending the engineer's category: the proposal would only echo it.
- Feeding the proposal to drafting as evidence: a draft would then cite, as an
  observation, something no engineer wrote, and the citation check would pass.
- Free-text hazard types: they could not be filtered or carried into a
  Section 3 OFI (GN-05).
- The free Gemini tier: Google may use what is sent and have people read it,
  and these are client site photos. The key must be on a billed project, and
  requests go with `store: false`.

Open: Marsh has been asked whether site photos and notes may go to Google;
until they answer, only sample photos go through Gemini. The redacted sample
reports keep only two OFI photos, so the reference set in
`speech-ocr-service/eval/` needs more photos with Marsh's reading before its
hit rate means much.

Stories: CP-05, CP-04, CP-08.

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

## 2026-10-08 — The cost report is scoped by the API, and the chatbot is left out until it exists

Chose: one `usage:view` permission for both roles, with the scope enforced in
the report service: a knowledge admin sees every report, a risk engineer only
the reports where they are the assigned engineer (403 otherwise). The summary
is added up in the gateway from `ai_calls`, percentiles use the nearest-rank
method, and the export is a CSV of the breakdown on screen. The four features
that exist are always listed; the chatbot appears once CB-01 does. Calls with
no cost are counted, never summed as 0. Rejected: a separate engineer-only
permission and route, which duplicates the same query; a Mongo aggregation
pipeline, which is more code for a table that holds a few hundred rows today;
and XLSX or PDF export.

Reason: EV-04 asks for a knowledge-admin cost report, and a risk engineer
reasonably wants to see what their own report cost. Changes to the acceptance
criteria (role, chatbot, units, empty state, scope) are listed in the PR.

Stories: EV-04.

## 2026-10-08 — OFIs are suggested by the model and accepted by the engineer; code sets their priority and number

Chose:
- The model proposes Section 3 OFIs from observations rated moderate or worse,
  as structured records whose category, type, likelihood, consequence and
  effort must come from `ofi.json` (Marsh's template lists).
- Code sets the priority from the template's Risk Assessment Matrix, and the
  number, status and issue date when the list is read. OFI issued by is left
  for the engineer (Marsh or the consultant).
- An OFI is a suggestion, kept out of the report, until the engineer accepts
  it. Redrafting replaces only unaccepted suggestions.
- Past OFIs are retrieved from the knowledge base by heading, since RT-02 is
  not built.
- Section 3 is the first row of the Report generation tab's sections table,
  laid out like sections 7-12, not the RV-01 review workspace. Any number of
  suggestions can be accepted, one by one or all at once.

Rejected:
- An engineer-set "needs OFI" flag on observations. It changes capture screens
  and adds a step on site, when severity already says which findings matter.
- Free-text types, as in the sample reports. AC5 asks for configured value
  lists, so the provisional list is the sample reports' types plus the seven
  RQR main categories, swappable when Marsh sends its sub-categories.
- The model choosing the priority. The backlog notes that priority is a matrix
  lookup, and showing "Likely × Major" lets the engineer see the basis.
- Loss expectancy from the model. Loss figures stay out of LLM output; those
  fields are left for people.

Reason: OFIs are advice the client acts on and insurers read, so every
judgement the template defines as a rule (priority, numbering) is made in code.
The model does the writing, and the engineer stays the one who decides what
goes in the report.

Measured (AC7, 2026-10-08, guide `gn05-v4`, gpt-6-luna judge): the mall (4.8)
and mixed-use (4.55) cases pass; the office case (4.5) fails on field fit. Its
drafts rated the fire door and recessed sprinklers Priority 1, as Marsh did,
but the judge marks Major down against the guide's wording, and gives Marsh's
own office OFIs 2.5 for field fit too. Drafted priorities match Marsh's in 7 of
10 OFIs and are within one step in 9. Next: score priority by agreement with
Marsh's own priorities, not the judge's view of likelihood and consequence.

Stories: GN-05.
## 2026-10-08 — Photos are read only when an engineer asks

Chose: saving an observation stores its photos and reads nothing. Read photos
on the Observations tab sends `POST /api/observations/:id/interpretation`,
which starts the first reading, or a new one after a failure, and replaces
`/interpretation/retry`. It stays open to any risk engineer, as the retry was.
This supersedes two points of the CP-05 entry above: "The gateway starts it
after saving, as it does a transcription" and "Saving starts exactly one
attempt". Everything else in that entry stands: one reading per observation,
S5 with Gemini, a proposal that is never drafting evidence.
- Until asked, the observation has no `interpretation` and the API returns
  `null`, as before for an observation without photos. The tab shows "Not
  read yet" with what reading does.
- The CP-04 AC7 (vetted sheet) and CP-05 AC1 (repo copy) now read "when the
  engineer asks for them to be read", and a new AC says nothing is sent until
  then.
- Observations already read keep their reading.

Rejected:
- Reading on save, as before: every site photo went to Google whether or not
  anyone wanted a proposal, while the CP-05 entry's open question (may client
  photos go to Google?) is unanswered, and each one is a paid call.
- A per-assessment or per-user setting for automatic reading: more to build
  and explain, for a choice one button already gives.

Reason: the proposal saves the engineer typing but is optional, so sending a
client's photos to a third party should be a deliberate act, and Marsh pays
only for proposals someone wants. The cost is one tap per observation.

Stories: CP-05 (CP-04 in the vetted sheet).

## 2026-10-08 — Repeats and newer editions: fingerprint at upload, one match check after ingestion, one Needs review status

Chose: three checks, then one admin decision (IN-07).
- An identical file is rejected at upload, before labelling, S3 and the queue.
  The gateway compares the file's sha256 fingerprint with every stored
  document that is not failed, and a unique partial index on `file.sha256`
  settles two identical files uploaded together. Reason: no LLM call, no
  storage and no job is spent on a repeat.
- A document that shares passages with a stored one is checked once, after
  ingestion, using the embeddings already in Chroma. Two passages match at
  similarity 0.90 or more (`MATCH_PASSAGE_SIMILARITY`). A document is a
  possible copy if 58% or more (`MATCH_MIN_SHARE`) of either document's
  passages match the other. Either direction, so an excerpt of a stored
  document and a full document whose excerpt is stored are both caught.
  Candidates are every complete document except itself and its own edition
  family; the one with the most shared passages is the match.
- Editions are told apart by the standard number, never the title (step-4
  feedback: a title missing one "s" flipped a match). The labeller reads the
  number ("13", "2-81"); on an excerpt without its cover, NFPA's page numbers
  ("13-33") prove it. Rules, in order: a copy (58%+) of the same edition is a
  possible copy; same issuing body and number with a different year is a
  newer or earlier edition, whatever the share; a 58%+ match of another year
  with an unknown number is an edition; any other 58%+ match is a copy.
  Reason: the evaluation found the 2022 and 2019 editions of NFPA 13 share
  only 42% of their passages at 0.90, below any safe copy threshold, and two
  excerpts of different chapters share none.
- Keep both gives the new document the matched one's status, and Supersede is
  refused while another edition of the family is active, so two editions are
  never active at once.
- T and S come from the evaluation, not a guess: at T = 0.90 the lowest copy
  shares 83% of its passages and the highest non-copy 33%, a 50-point margin,
  so S = 58% sits in the middle. At 0.80 and 0.85 the margin is only 17 points
  (two reports from one template share 67%); at 0.95 it is 38. Both are env
  settings. See `microservices/ingestion-service/eval/matching/results/2026-10-08.md`
  (8 pairs: re-saved, scanned, no-cover, two editions, two same-template
  reports and three unrelated).
- One Needs review status for every reason (Unconfirmed details or a match).
  Passages carry `needs_review` and stay out of search. The row says why. A
  document mid-ingest is indexed as `needs_review` until the match step
  finishes.
- No Superseded status. Supersede withdraws the old edition and links the
  editions in an `editionFamily`; a withdrawn edition shows the family's newest
  edition. Reinstate is refused while another edition of the family is active.
- Discard deletes fully: passages, S3 file, ingestion job and record, after a
  confirm. Other documents that matched it are matched again.

Rejected:
- Separate Awaiting decision and Superseded statuses (from the VETTED backlog).
  Needs review already means "waiting for an admin", and Withdrawn plus an
  edition family covers a retired edition. Fewer statuses to filter, count
  and keep in step in the passage labels.
- A text comparison before ingestion for text PDFs. A scanned copy needs
  ingestion anyway, so one check after it covers both, and a discarded
  document costs only the ingestion run.
- Title matching, fuzzy or exact. Titles are not unique and one typo changed
  the outcome; the standard number is short, printed on every page and
  checkable against the text.
- A word-level diff inside a passage. The review page marks which passages
  differ; a tidied-text change is enough to show a revised value.

Known limit: an edition whose standard number can't be read or is typed wrong,
with less than 58% of its passages matching, is not flagged. Retest on
full-size documents when ingestion moves to cloud models.

Stories: IN-07 (covers IN-11).

## 2026-10-08 — Recordings and photos can be added to and removed from a saved observation; removal hides, and a changed photo set marks the reading out of date

Chose: the assigned engineer can add recordings and photos to a saved
observation (`POST /api/observations/:id/media`), and remove and restore any
of them (`DELETE` / `POST .../restore` on `/recordings/:id` and
`/photos/:id`), from Add media and Remove on the Observations tab. This
supersedes two points above: the CP-08 entry's rejection of "removing a
recording from an observation", and the CP-05 entry's "photos can't be added
after saving, so the set is fixed".
- Removal is soft, as deleting an observation is: the item gets `removed: {
  at, by }`, its file stays in S3, and Restore brings it back. The API lists
  kept items under `recordings` and `photos` and removed ones apart, so
  drafting, the evidence counts, the Photos tab and the photo appendix leave
  removed ones out with no change of their own. A removed transcript changes
  what a draft was given, so the draft shows as out of date.
- An observation must keep a note, a recording or a photo. The removal's
  update matches on that, so two removals at once can't leave nothing; the
  note-clearing edit now counts only kept items, matched the same way.
- An item added later records `added: { at, by }`, since it was not captured
  with the observation.
- Each photo reading records the photos it read (`photoIds`). A finished
  reading of a different set from the photos kept now is out of date: the tab
  says so and offers Read again. Nothing reads photos by itself, as the entry
  above decided. Readings from before have no `photoIds` and count as reading
  the photos saved with the observation.
- No capture session is needed: adding is a correction, like the other CP-08
  changes, and often made at the desk after the visit.
- One upload check (`server/src/routes/media-form.ts`) serves capture and
  adding, so both refuse the same files with the same words.

Rejected:
- Deleting the file from S3 on removal: it would destroy raw evidence that a
  past draft may have been written from, and could not be undone.
- Removal with no restore: every other soft removal in the app (observation
  delete, KB-01 withdraw, RV-10 archive) can be undone, and a mis-tap on a
  phone is likely.
- Reading the photos again by itself on every change: a paid call that
  sends client photos to a third party each time, against the entry above.
- Requiring an active capture session: drafting may already be under way, and
  starting capture again to attach one photo is two screens for one tap.
- Reusing the capture screen to add to an existing observation: its tags are
  for a new observation, and the engineer would lose their place on the
  Observations tab.

Reason: an engineer finds after saving that a photo is missing, a recording
is of the wrong room, or the best shot was taken later, and CP-08 asks for
observations to be corrected while every draft stays traceable to what it
was drafted from. Hiding rather than deleting keeps that trail.

Stories: CP-08, CP-04, CP-05.

## 2026-10-10 — An observation can be filed under several COPE categories

Decision:
- An observation's `metadata.COPE_dimension` is a list of one or more of the
  four categories, stored in C-O-P-E order without repeats. Uncategorised
  stays `null` (never `[]`), so the CLAUDE.md exception is unchanged. The
  field keeps its name because the five-field metadata rule names it; the API
  field becomes `copeDimensions` so a caller still sending one string fails
  loudly instead of being misread.
- An observation is a section's own evidence when any of its categories is one
  of the section's. One filed under two categories counts towards both
  sections' minimum, and is own evidence (not backup) in each draft.
- A photo reading still proposes one category. Accepting it adds it to the
  categories the observation has, rather than replacing them.
- Observations and drafts saved before hold one string. Reads treat it as a
  list of one (`copeDimensionsOf`), so nothing breaks before migrating, and a
  draft's old evidence does not count as changed. `npm --prefix server run
  migrate:cope` rewrites them as lists; running it twice changes nothing.

Rejected:
- A separate `COPE_dimensions` list beside the single field: two fields to
  keep in step, and every reader would have to choose between them.
- A primary category plus secondary ones: drafting has no use for the
  distinction, and engineers would have to pick one for no gain.
- Storing `[]` for uncategorised: it would read as a category list that
  happens to be empty, against the rule that the field is present but null.

Reason: one finding often concerns several parts of the report (an unsealed
wall penetration is both Construction and Protection), and with one category
an engineer had to pick a section to leave it out of.

Stories: CP-02, CP-06, GN-01.

## 2026-10-10 — Ingestion moves to one cloud instance; tables and formulas are read by Claude Haiku 5.5, several at once

Chose:
- The whole backend runs in Docker Compose on one free-tier EC2 m7i-flex.large
  (2 vCPU, 8 GiB), with Atlas, Chroma Cloud and S3. Redis stays a container on
  the instance, shared by the server and the worker (docs/areas/cloud.md).
- Docling still parses and chunks, on the instance's CPU with RapidOCR. Its
  models are built into the image.
- Cropped tables and formulas are read by an API provider chosen by
  `OCR_PROVIDER` (anthropic | gemini | glm). The default is Claude Haiku 5.5.
  On FM-200's tables it read 99% of the printed numbers and invented none,
  in about 4 s per table. Self-hosted GLM-OCR on CPU read 73% in about 150 s,
  and its formula output was unusable (eval/ocr/results/2026-10-10.md).
- The chunker queues every table/formula region while walking the document and
  reads them `OCR_CONCURRENCY` (6) at a time. Order and chunk ids stay as before.
  A table split across chunks is read once; if that read fails it is dropped,
  not retried from the later chunk.
- Each passage stores `bbox_pages`, the page of each box in `bbox`, so a region
  can be cut out of the original PDF later. Passages indexed before this got
  it by a one-off backfill. 13 multi-box table passages could not be placed
  and wait for re-ingestion.
- A number the OCR returns that the PDF's text layer lacks is logged with its
  page, never corrected. A rejected key or unknown model fails the document
  instead of dropping its tables.
- `docker compose up` builds a lean cloud image (CPU-only torch, no GLM-OCR).
  `docker-compose.local-ocr.yml` adds Ollama and GLM-OCR, and
  `docker-compose.gpu.yml` adds CUDA and Nemotron on top. Mongo and Chroma
  containers sit behind a `local-db` profile.

Rejected:
- A GPU instance for GLM-OCR: idle almost all the time at 2–3 documents a week,
  and GLM read fewer numbers than Haiku.
- Replacing Docling with a document-AI service (Textract, Mistral OCR): the
  section, page and COPE logic is built on the DoclingDocument, and Textract
  reads no formulas.
- Gemini as the default: the team's key was rejected by Google. It stays
  selectable with `OCR_PROVIDER=gemini`.
- Fixing two-row table headings: retrieval only needs the gist, and drafts are
  to read the original region through `bbox`/`bbox_pages`.
- A separate `ocr` progress stage: it would need the gateway's and client's
  stage lists changed for a step that takes seconds. OCR stays inside chunking.

Known limit: until drafting reads the original region by bbox, a draft that
quotes a table value relies on the OCR text. The numeric-guard log shows which
pages to check.

Stories: IN-12, IN-03, IN-06.

## 2026-10-12 — Capture is a page of the Observations tab, left by its back button; the Observations tab is the one list

Chose:
- The workspace header's Capture button is now Add observation, named after
  the tab it feeds. An empty Observations tab offers it too. The capture
  screen keeps its own URL (`/site-observation`), so Back still works.
- Capture keeps the workspace's header and tabs, with Observations chosen,
  so the engineer never seems to leave the assessment; the tab's count
  rises with each save. Above the form, a Back to observations link and the
  heading New observation are the way back, as on any sub-page. Choosing any
  tab leaves for that tab. On a phone the workspace header and tabs are
  hidden during capture, and the top bar becomes ← New observation, its ← in
  place of the menu. The header's Add observation and ⋯ menu are hidden
  while capturing.
- On wider screens the location picker drops down from the location bar
  (the shared Popover) with no backdrop, so the header and tabs stay clear
  and usable; on phones it stays a bottom sheet. Either opens by itself until
  a location is chosen, and either can now be closed without one: the bar
  then reads Choose a location, and Save asks for one and opens it again.
  Leave capture is gone from the sheet. This revises the 2026-09-29 sheet,
  which could not be closed until a location was chosen.
- At 1080px and wider, the tags and Save sit in a 344px panel beside the
  form, which stays in view while it scrolls; narrower, it is one column with
  Save pinned to the bottom. Save is the only action there. Cancel, Captured
  today, the explanatory paragraph and Open the assessment workspace are
  gone.
- The capture session notice shows only when no session could be started
  (Showing sample data, with Try again). Starting, started and resumed say
  nothing: the header names the assessment and the navigation's live light
  marks the session. Save waits while the session starts, so an observation
  is never kept in the browser by being saved a moment too soon.
- The Note, Voice and Photo switcher stays and shows what each mode holds.
  Each mode lists its own recordings or photos; the combined Ready to save
  list and the Add note step are gone, as Save already used the typed note.
- Leaving by the back button or a tab with anything unsaved asks Leave
  without saving? first, then goes where was chosen. Leaving by the
  navigation or Back keeps the draft and stops a recording in progress.
  Opening another assessment, or archiving this one, discards the draft.
- Category and severity start empty and reset after each save. Severity must
  be chosen before saving. The severity chips are one SeverityPicker, shared
  with the Edit dialog in place of its dropdown.
- Capture no longer asks for a standard. Drafting finds one, and Edit can
  still name one.

Rejected:
- Capture as a workspace tab of its own: opening capture starts a capture
  session (CP-01), so browsing the tabs would start sessions and the
  dashboard would offer to continue captures nobody began. Capture is a page
  within the Observations tab instead, opened only by Add observation.
- One editor for adding and editing, as a panel over the Observations list:
  the most direct, and it removes the second form, but it needs a large
  refactor, a new URL pattern for the panel and rules for the list behind
  it. A story of its own if adding and editing are to share one form.
- A Done button, in the header or beside Save: it read as finishing the page
  or the assessment rather than going back to the list.
- Keeping the workspace header on phones: with the tabs and title fixed above
  the form, a phone kept about 300px for the form itself.
- A back row between the tabs and the form: it read as a stray toolbar, and
  repeated the name of the tab just above it.
- Keeping the location picker a modal on wider screens: a modal's backdrop
  covers the whole window, so the tabs were dimmed and out of reach.
- Removing the switcher for one long form: the switcher keeps one kind of
  input on screen at a time, which suits a phone, and its counts now show
  what the other modes hold.
- A notice each time capture opens: it repeated the header, and said nothing
  the engineer had to act on.

Reason: capture duplicated the Observations tab (a second list, a second set
of the same fields), felt like a separate place, left to the dashboard, and
kept a draft that could be saved to whichever assessment was opened next,
with Protection and High pre-selected for every observation.

Stories: CP-01, CP-02, CP-03, CP-04, CP-08.
## 2026-10-11 — Review decisions are an append-only log; drafts never change, and Regenerate makes a replacement to accept or discard

Chose:
- A finding is one statement of a section's draft, named by where it sits:
  `<subsection index>.<statement index>`. A draft's statements are never
  reordered or removed, so the name holds.
- Every review decision is one entry added to `review_audit_log`: accept,
  edit, reject or restore a finding, and regenerate, accept or discard a
  replacement draft. Each entry keeps the text before (and after, for an
  edit), the citations, the signed-in user's id and name, and the time.
  The model refuses every update and delete, so the log is immutable through
  the gateway (AC3, AC4, AC6).
- Drafts in `report_sections` are never changed. A finding's state and
  current text are read from the log (`foldFindings`), and the review summary
  is counted from the same reads (AC9). An edit replaces the text shown and
  sent onwards (AC2); what the draft said stays beside it.
- Two decisions on one finding at once cannot both be saved: each entry takes
  the next `sequence` number for its draft and finding, and that is a unique
  index. The loser gets a 409 and reloads.
- A decision names the draft the engineer was looking at (`draftId`). If the
  section's saved draft has changed since, it is refused (409), so a decision
  never lands on a different draft's finding of the same name.
- A section is `needs_review` while a finding still in the draft is
  unsupported, a source it cites is withdrawn, or observations changed since
  drafting; otherwise `ai_draft` until a decision is made, `in_review` while
  some findings are pending, and `reviewed` when none is. An unsupported
  finding can be accepted, but it stays flagged until rejected: the decision
  is recorded, and the evidence gap is not hidden. GN-02 and RV-04 resolve it.
- Rejected findings leave the visible draft and its claims (AC5), and can be
  restored from the review history to the state they were rejected from.
- An edited finding can still be accepted, keeping the engineer's wording; it
  then shows as Accepted with edits and counts as accepted in the summary.
- Bulk accept accepts only pending findings, one entry each marked `bulk`, so
  rejected and edited findings keep their decisions (AC7, AC8).
- Regenerate (GN-04, merged into RV-02 as AC10-AC12) drafts the section again
  as a replacement: a `report_sections` document with `replacementFor` set to
  the saved draft. It is not the section's content until accepted (AC11);
  discarding it leaves the saved draft and its decisions as they were (AC12).
  Other sections are untouched (AC10). One replacement waits at a time. A
  replacement becomes current from when it was accepted, even over a GN-01
  redraft made while it waited.
- S4 is given the saved draft's findings with each decision and the
  engineer's optional instruction (`redraft`), after the evidence. It keeps
  accepted and edited findings where the evidence supports them, leaves out
  rejected ones, and follows the instruction within the drafting guide.
  Retrieval and the citation check are unchanged: the saved draft and the
  instruction are never evidence. The first-draft prompt is unchanged, so
  `gn01-v2.4` stays; a redraft records `gn01-v2.4+rv02-v1`, and its
  `instruction` is saved in its provenance.
- Decisions need `reports:generate` and the assigned engineer, on an
  assessment not archived, as drafting does. Anyone who can view the
  assessment reads the decisions and history.

Rejected:
- Review fields on each statement of `report_sections`, updated in place: the
  state and the audit entry would be two writes with no transaction, so a
  decision could be saved without its record, or the reverse, and the draft
  would no longer be what the model wrote.
- Deriving the state from the log but also caching it on the draft: two
  places to keep in step, for a read that is one indexed query.
- Blocking Accept on unsupported findings: AC1 and AC7 accept every pending
  finding, and a hidden button would not tell the engineer why.
- Regenerating with only the instruction: "shorten the second point" means
  nothing without the draft it refers to, and the redraft would repeat what
  the engineer rejected.
- Making the Generation tab's redraft a replacement too: GN-01 AC12 expects a
  redraft to replace the draft. A redraft there starts the section's review
  again; Regenerate is the way to compare first.
- Physical immutability (a MongoDB role without update or delete on the
  collection): the right end state on Atlas, but outside the code. The
  dev seeds reset a sample's log through the driver, as they reset its drafts.

Reason: RV-02 makes the engineer's judgement control the report, which needs
every decision recorded as made, by whom and when, and never rewritten. A
log that is also the source of the state cannot disagree with it. EV-02
(acceptance rates by section) and RV-07 (resume a review) read the same log.

Stories: RV-02, GN-04 (merged), GN-01.

## 2026-10-12 — Locations are organised by building and level, or elsewhere on site, and can be changed in place

Chose:
- A location is either in a building (a building, an optional level, and its
  name, e.g. Staircase, Store room, Lobby) or elsewhere on site (a name only:
  roads, car parks, fire access routes, a guardhouse, a sprinkler tank). No
  level means the whole building, e.g. its facade or roof, listed first under
  Whole building. A structure with levels worth recording is a building.
- One flat list on the assessment, as before, with an optional `building` on
  each location. The level stays in `floor` (shown as Level). Observations
  keep pointing at the same location ids, so nothing is migrated. A location
  saved before this with a floor but no building is listed under Building not
  recorded until it is edited into a building.
- "Location" stays the word, on screen and in code; the whole property is the
  site.
- The key is `name|floor`, with `|building` added only when there is one, so
  old keys still match. A building or level differing from a listed one only
  in case takes the listed spelling.
- The picker groups by building (in name order), then Elsewhere on site, each
  building's levels lowest first (basements, ground, numbered levels, a
  mezzanine above Level 1, the roof; names it doesn't know last, as added).
  Groups fold away when there are several; the one the engineer is in starts
  open, and a search opens every match. The add form suggests the buildings
  and levels already used, plus the usual level names, and starts from where
  the engineer is, so the next location on the same level is one field.
- `PATCH /api/assessments/:reference/locations/:id` changes a location in
  place, for the assigned engineer only and not once archived, as for
  observations (CP-08). Adding and removing keep their CP-15 rules.
- Reports word a location most specific first ("Staircase, Level 2, Block
  A"), one formatter (`locationText`) for drafting evidence, Appendix A and
  the photo reading. One without a building reads as before, so drafts made
  before this still compare equal; otherwise every draft would count all its
  observations as changed. Section 1 names the buildings, then the places
  elsewhere on site, not every location, so it stays short on a large site.
- Levels stay free text, but one the app recognises is saved in a standard
  spelling ("L2", "lvl 2" and "2nd floor" as Level 2, "B1" as Basement 1), on
  the client and the gateway, so shorthand never splits a level in two. Before
  saving a level it doesn't recognise, or a building or location name one slip
  from a usual one (a short list: Block, Tower, Staircase, Lobby, Fire pump
  room...) or from one already on the site, the form asks "Did you mean ...?"
  with the likely name and Keep as typed. A usual name is never pulled towards
  a mistyped one on the site, and words under five letters are not judged, so
  Hall is never taken for Mall. A short or numbered word must match
  exactly, so Block B is never taken for Block A. A name already on the site
  is never asked about again.
- The Observations tab lists observations by building, level and location by
  default, with each location's Add observation (capture opens there),
  Edit and Remove, and Add location above the list, which needs no capture
  session; locations with no observations are listed too. A switch shows
  them newest first instead, as CP-08 AC1 lists them.

Rejected:
- A nested tree (buildings holding levels holding locations): every
  observation's location id would have to be migrated, and adding and
  removing could no longer be one atomic update on the list.
- A location type field (road, car park, fire access route): the name already
  says it, as the 2026-09-29 decision found; "elsewhere on site" covers
  places that are neither in a building nor open ground.
- "Area" for the place within a level: clearer for the last field alone, but
  renaming `location` through the API, the database, saved drafts and the
  drafting and photo services would change stored evidence for no change the
  engineer sees, and two words for one thing confuse more.
- A required level in a building: the facade, the roof or a building-wide
  system would need a made-up level.
- A fixed list of levels: it stops typos, but not the names sites really use
  (Podium, Transfer level, Plant deck); asking about an unknown name catches
  the typo and keeps the real one.
- Only the grouped list on the Observations tab: newest first stays the quick
  way to review what was just captured, so it is one switch away.
- Renaming a whole building or level at once, and merging locations:
  follow-ups if needed.

Reason: on a large site the flat list of names became hard to scan, and
places outside buildings had nowhere natural to go. Engineers walk a site
building by building and level by level, so the picker follows that, and the
report can say exactly where a finding was made.

Stories: CP-16, CP-15, CP-08.

## 2026-10-12 — Capture stays a page, and returns to where the engineer was

Chose:
- Capture stays a page of the Observations tab (2026-10-12 above). Leaving it
  for the Observations tab, by its back button, the tab or Back, scrolls the
  list to the location it was opened at (a location's Add observation) or
  last saved in, unfolds that building, and puts focus there; newest first,
  to the newest observation saved. Opened from the header with nothing saved,
  the list opens at the top as before.
- Each observation saved on that visit is marked New (an info badge and a 3px
  ink left rule) until the engineer leaves the tab or captures again. Nothing
  is stored: the marks are the gateway's ids, and a count for the demo's
  local rows, which are listed newest first.

Rejected:
- Add observation as a pop-up over the list: capture saves one observation
  after another in the same place, keeping the location; it holds a live
  recorder, the camera and photo previews, and fills a phone's screen anyway.
  A dialog closes on Escape, a click outside or Android's back gesture, which
  would lose recordings and photos, where the page's URL keeps the draft and
  Leave without saving? guards the rest.
- Adding observations only from a location's row: Save already needs a
  location, and a new assessment's capture opens on Add the first location.
  Walking a site on a phone, changing room would cost a trip back to the list
  instead of one tap on the location bar (2026-09-29).

Reason: from the grouped list, capture felt like leaving it: the engineer came
back to the top of the list and had to find the location again to see what
they had saved.

Stories: CP-16, CP-03.

## 2026-10-12 — The Observations tab opens newest first, with its filters behind one Filters button

Chose:
- The list opens newest first (CP-08 AC1), each row naming its location.
  Group by location, first in the toolbar, groups it and then reads Show
  newest first: one button whose text says what pressing it does. This
  revises the CP-16 entry above, which made By location the default, with a
  two-button switch.
- The filters sit behind one Filters button, which counts those set
  (Filters · 2). Its panel drops down from it (the shared Popover); below
  760px it is a bottom sheet with larger controls, closed by Show n
  observations. Each filter applies as it is chosen.
- While any filter is set, each shows as a chip under the toolbar, whose ✕
  removes it, beside Clear filters, so nothing narrows the list out of sight.
- Building, Level and Location are one Location dropdown, grouped by building
  in the list's order, then Elsewhere on site; All of a building, and a
  level, appear only where they hold more than one location. A level or a
  location name now means that building's: Level 2 no longer matches Level 2
  in every building, nor Lobby every Lobby.
- The toolbar reads Group by location (or Show newest first), Filters,
  Deleted (n), then Add location at its end. The deleted list hides the
  first and the last.
- Shared components: Select takes option groups (a native optgroup); Tag's
  remove is a real button with its own name, so the keyboard reaches it.
- The card no longer clips, so the panel can hang below a short list; its
  footer rounds the bottom corners instead.

Rejected:
- The five dropdowns inline on desktop, with the button only below 1080px:
  fewer clicks for whoever filters most, but two patterns to keep, and the
  chips already keep what is set in view.
- A toggle highlighted while on (By location, or a pressed Newest first):
  which way the list ran was easy to miss; the button's text now says it.
- Filters in the table's column headings: there are none below 1080px, and
  type and location have no column of their own.
- One list for both orders (location groups ordered by latest activity, or a
  Recent strip above them): groups would jump after each save, empty
  locations would sink, and a strip would list each observation twice.

Reason: the toolbar held seven dropdowns, two sort buttons, Deleted and Add
location, and wrapped to three rows on a laptop and more on a phone before
the first observation.

Stories: CP-08, CP-06, CP-16.

## 2026-10-13 — A client has many sites and a site many assessments; each assessment keeps its own copy of the locations

Chose:
- A `clients` collection, and a `client` reference on each site: client →
  site → assessment, one assessment per visit. The client is stored only on
  the site, so an assessment reads it through its site and the two can never
  disagree; a rename (CP-18) is one write.
- Locations stay on the assessment (CP-16). A new assessment on a site that
  already has one copies the latest non-archived one's locations, whatever
  its status, behind a ticked box the engineer can untick, so a finished
  report never changes when a later visit edits its copy.
- Every engineer sees every client and site, though RV-10 shows each only
  their own assessments, so a client is never added twice because a
  colleague added it.
- Clients match on a key, the name lowercased with its spacing tidied, kept
  unique by an index, so two engineers adding the same client at once get one.
- Existing data moves by `npm --prefix server run migrate:clients`, as
  `migrate:cope` did: run by hand, safe to run twice. Names matching by key
  become one client; near-misses (Fennick Food, Fennick Foods) stay apart,
  since a script shouldn't guess, and sites are never merged. The
  assessment's `client` text is left in place, shown only while its site has
  no client, so the migration can be run again from it.
- A site's details are locked on its assessments once another one not
  archived shares it; an archived one doesn't count, so a mistaken create
  doesn't freeze the site. An assessment's client and site can't be changed
  after it is created: a wrong pick is archived and created again. (The lock
  is replaced by CP-18's rule, 2026-11-02: a site or client changes for all
  its assessments when every one of them is the engineer's.)
- One client can't have two sites of one name, whatever the case, and a new
  client or site name close to a listed one is asked about, as CP-16 does for
  locations. Sites saved before with the same name stay.
- The create form takes the Client as a field with suggestions; a listed
  client then offers its sites in a Site list, ending with Add a new site. A
  listed site's details fill in, read-only, under it, with the copy box.
- The work list opens latest site visit first, as before. Group by client
  lists it by client, then site, in name order, with the Observations tab's
  fold headings and location rows (one shared heading); the button then reads
  Show latest first. Sort orders each site's visits, and the status filter,
  search and date boxes still apply, hiding a client or site left empty.
  Each site has New visit, which opens the create form on it with its copy
  ticked.
- Archived is a button, Archived (n), as Deleted (n) is on the Observations
  tab, no longer a status. The toolbar reads Group by client, Sort, Status,
  Archived, then the count and Search at its end.
- An engineer still sees only their own assessments (RV-10), so a site may
  list fewer visits than it has; knowledge admins see them all.

Rejected:
- One location list per site, shared by its assessments: a rename would
  change last year's assessment, removing one would have to check every
  visit's observations, and every observation's location lookup would move
  from the assessment to the site, for about four times the work.
- A `client` reference on the assessment as well as the site: quicker to
  filter, but a second copy to keep in step.
- Migrating on server start: nobody forgets it, but a slow or failing run
  would hold up the gateway, and nothing else migrates that way.
- Deleting the `client` text in the migration: tidier, but a wrongly matched
  name could not be recovered.
- A unique index on a client's site names: sites saved before CP-17 under one
  client may share a name, so the migration could not link them.
- Letting an assessment move to another client or site before capture:
  flexible, but what happens to copied locations on a move would need its own
  rules, and archiving and creating again is cheap.
- Add site on the work list, as Add location is on the Observations tab: New
  assessment already adds a new client and site, and a site with no visits
  would need its own rule for who sees it.
- The status and sort in one Filters panel, as on the Observations tab: the
  work list has two controls, not seven, so they stay in the toolbar.

Reason: one report can cover a campus or an airport, and the same facility
is surveyed again each year; linking visits to one site of one client lets
the next visit start from the last one's buildings, levels and places.

Stories: CP-17, CP-16, CP-18, RV-10.

## 2026-10-13 — Every paid AI call is recorded, Gemini is priced by call date, and drafting rows name their section

Chose:
- `ai_calls` covers the calls EV-03 left out: photo interpretation
  (`interpret-photo`, Gemini), table and formula OCR (`ocr`; Anthropic,
  Gemini or the self-hosted model), ingestion embedding (`embed-document`,
  Cohere) and the chatbot (`chat`). The report lists all eight features,
  even those with no calls yet.
- Gemini is priced from Google's list price with the date each price starts,
  because Google has announced a rise on 2027-01-01. A call is priced at the
  price in force when it is recorded, so old rows keep their old cost.
- The self-hosted OCR model costs $0 per call, with that named as its basis;
  its server cost is not an AI-call cost.
- Drafting, OFI and summary rows keep the one `draft-section` feature and
  carry the report's own section id (`7`–`12`, `3` for OFIs, `2` for the
  summary), so an engineer can see which section was expensive to draft or
  redraft. The report shows each id with its title from `report_sections`.
- Rows can carry `documentId` (labelling, ingestion), `userId` (chat) and
  `callCount` (ingestion's summed rows). A malformed id is dropped, not saved.

Rejected:
- New `draft-ofi` and `draft-summary` features: rag-service's one `llm.py`
  would need to know who called it, and the section already says it.
- Pricing old rows again when a price changes: a cost recorded is what the
  call cost then.

Reason: EV-03 asks for every AI call to be measured, and EV-04 for costs per
feature including the chatbot and per billed service.

Stories: EV-03, EV-04.

## 2026-10-13 — Chat usage travels in the answer stream and is saved for the user who asked

Chose: S4 ends each chat answer with an AG-UI `CUSTOM` event named `usage`,
carrying the same usage items drafting returns. The gateway, which already
relays the stream, saves them as `chat` calls with the session's `userId` and
drops the event, so the chat screen never sees it. Chat has no assessment, so
the cost report shows a user's chat cost under that user and, when grouping
by assessment, as one "Chatbot" group.

Rejected: a second request after the answer to fetch its usage, which needs
S4 to keep state between requests; and keeping the event in the stream for
the browser to ignore, which would leak billing detail and tie OpenUI to an
event it does not know.

Reason: EV-04 AC1 asks for cost per feature including the chatbot, and a chat
answer is a stream, not a JSON body the gateway can read a `usage` list from.

Stories: EV-03, EV-04, CB-01.

## 2026-10-13 — The ingestion worker posts its AI-call totals to the gateway, one row per document, stage and model

Chose: the worker collects what each document's OCR and embedding calls used
and, when the document completes, fails or is cancelled, posts the totals to a
new `POST /api/internal/ai-usage`, behind the same service key as its
notifications. The gateway prices and saves them with the one price table.
Calls are summed per document, feature (`ocr`, `embed-document`), billed
service and model, with a `callCount`; calls that reported no usage are summed
apart, as unavailable. Self-hosted GLM-OCR is recorded too, at $0, so its speed
can be compared with the paid providers.

This narrows the 2026-10-08 rejection of a callback route. That rejection held
for services whose calls already return to the gateway; the worker's do not,
it runs in the background, and it already holds the gateway address and
service key for notifications. It closes that entry's known gap,
"ingestion-time embedding is not covered".

Rejected:
- One row per call: a document makes hundreds of OCR and embedding calls, so
  the collection would grow quickly for little gain. The cost is the same;
  what is lost is per-call latency percentiles for ingestion, so the report
  shows average time per call for those rows instead.
- The worker writing `ai_calls` itself: it would need its own copy of the
  price table.
- Storing the usage on the ingestion job for the gateway to copy later: more
  moving parts for a best-effort record.
- A ContextVar collector, as in rag-service: OCR runs in a thread pool, and pool
  threads do not inherit the context. One collection behind a lock is enough
  because the worker ingests one document at a time.

Known gap: a lost post loses that document's cost record (logged), never the
document.

Stories: EV-03, EV-04.

## 2026-10-13 — Cohere calls cost $0 on the free trial key, the default

Chose: `COHERE_KEY_TIER` (`trial` by default, even when unset; or
`production`). On trial, every Cohere embed and rerank call is recorded at $0,
with the basis "Cohere trial key: free, 1,000 calls a month", because that is
what the project pays today. Setting `production` switches to the per-use
estimates (`COHERE_EMBED_USD_PER_1M_TOKENS`, `COHERE_RERANK_USD_PER_1K_SEARCHES`).
Rows keep the price saved with them, so a switch changes only later calls.

Rejected: pricing trial calls at the production estimate, which overstated the
real bill; and storing both an actual and a projected cost, which adds a field
and a column throughout the report for a question nobody is asking yet.

Reason: EV-04's cost report is for assessing the real budget; the trial's
limit is 1,000 calls a month, not money.

Stories: EV-03, EV-04.

## 2026-10-13 — Report cost belongs to the assessment's assigned engineer; chat cost to the user who asked

Chose: the cost overview groups report-generation calls by assessment or by
engineer. A report call is attributed to the assessment's assigned engineer,
looked up when the report is read, so `ai_calls` stores no user for it and
reassigning an assessment moves its whole cost. Chat has no assessment, so a
chat call stores the asker's `userId` and is attributed to them: part of their
bar when grouping by engineer, and one `Chatbot` group when grouping by
assessment. "This month" starts at midnight in Singapore.

Rejected: storing the user who made each call, which shows who spent the
money (an admin redrafting someone else's section), but splits one
assessment's cost across people and leaves every older row without a user;
and storing both, which adds a second grouping to every view for a question
not yet asked.

Reason: EV-04 asks for cost per report and per engineer, and an engineer's
cost is that of the assessments they are responsible for.

Stories: EV-04.

## 2026-10-13 — Cost charts use Recharts, coloured by billed vendor

Chose: Recharts (3.10.1, pinned) for the usage screen's vertical stacked bar
chart, one bar per assessment, engineer or document and one part per billed
service or feature. Colours are new `--chart-*` tokens: one hue family per
vendor, a dark and a light step where a vendor bills two services, assigned
so the services that share a bar on each tab differ in lightness. The set was
checked with the dataviz palette validator, not by eye. Parts stack in one
fixed vendor order, so colour and place follow the service, not its cost. The
chart sorts its bars by cost or by most recent use, shows 15 by default
(`DEFAULT_BAR_LIMIT`), and lets the reader show more; the table below lists
every group.

Rejected:
- A hand-built SVG chart: no dependency and easy to test, but tooltips,
  axes and keyboard access would be ours to build and keep.
- visx: less to fight than Recharts on styling, more to assemble.
- A distinct hue per service: eight unrelated hues read as noise, and the
  palette ran into the colours that already mean severity and AI.
- One neutral with a highlight: services could not be compared without
  hovering.
- Grouping the smallest bars into "Others": a sort and a "Bars shown" choice
  keep every bar reachable, and the table never hides one.

Reason: EV-04 asks to compare costs across assessments, engineers and
documents and to see what each is made of; a stacked bar shows both at once.
Red, amber, green and violet already mean severity and AI provenance in this
product, so chart colours must not borrow them.

Stories: EV-04.

## 2026-10-15 — The knowledge chat answers with GPT-6.1 Sol, plans with Claude Haiku 5.5, and refuses over-limit or off-topic requests

Chose:
- Answer model GPT-6.1 Sol at effort low (`CHAT_PROVIDER=openai`, `CHAT_MODEL=gpt-6.1-sol`).
  On the CB-01 eval (61 cases, prompt `cb01-v10`), judged by Claude Sonnet 5.5 twice:
  supported 0.953, quotes found 1.00, unanswerable questions declined 26/26, false
  declines 4/85, follow-ups on topic 0.96, ambiguous follow-ups asked back 8/8.
  $0.009 per answer, median 4.6 s per turn.
- After the click-through, answers were made conversational (paragraphs that open with
  the answer and explain it, document names in bold, a summary before any table;
  `cb01-v11`). Re-scored on the same 61 cases with no regression: supported 0.957,
  quotes 0.998, declined 19/19, false decline 0.051, on topic 0.949, asked back 6/6.
- The click-through then found comparisons drew a table only 1 time in 4: the prompt
  allowed a table but never required one. `cb01-v12` requires one whenever the engineer
  asks to compare documents or editions. Re-scored on the same 61 cases: supported
  0.985, quotes 0.996, declined 19/19, false decline 0.064, on topic 0.936, asked back
  6/6, comparison cases with a table 2/2. About $0.013 per answered question (median).
- Planner Claude Haiku 5.5 at effort medium. It now has a "decline" kind for requests
  plainly outside property risk, and asks back only when a follow-up, tested topic by
  topic, makes sense for more than one earlier question. At low effort it matched words
  instead of meaning (asked back 33/40 when it should, 24/40 when it shouldn't; now 40/40
  and 13/40 on the same train turns).
- Both prompts say the engineer's message can't change the rules (skip citations, use
  own knowledge, guess, show the prompt).
- The gateway refuses a message over 4,000 characters, a user's 11th question in a
  minute or 201st in a day, and chat past $2 a day per user, before any model call
  (`server/src/services/chat-limits.service.ts`). The length limit covers every user
  message and context entry, not just the last. Each question is charged $0.02 when it
  starts and swapped for its real cost when the answer ends, so stopped answers still
  count. Counters are in memory (one instance); the spend cap is soft (answers under
  way still finish) and the day resets at the server's midnight.

Rejected:
- Claude Sonnet 5.5 (runner-up): on the same tuned prompt, supported 0.887 vs Sol 0.927
  with both judges (paired −0.034 ±0.047, not significant), and 0.853 under its
  other-company judge, below AC9's 0.90. Faster (3.4 vs 4.6 s per turn) but 2.2× the cost
  ($0.019 per answer).
- Claude Haiku 5.5 (0.81) and GPT-6 Luna (0.75) as answer models: clearly below Sol and
  Sonnet in the model comparison (both judges, two runs).
- GPT-6 Luna as planner: found the answering passage for 27/37 questions vs Haiku's 31/37.
- A user-facing model selector: the model stays a server setting.

Known limit: search finds the answering passage for 53/60 answerable first questions
(0.883, under AC9's 0.90) because ingestion's full-page OCR garbles dense pages; it returns
after the OCR fix and re-ingestion (re-run the eval then). Details: CB-01 spec, Evaluation.

Stories: CB-01.

## 2026-10-16 — Local standard source type

Chose: a fourth source type, `local_standard`, for a country's own code (e.g. Singapore CP 52, SS 535). It behaves like an FM or NFPA standard (edition, standard number, supersedable) except that its jurisdiction is always one country (never `all`) and its issuing body is a free-text detail per document (optional, up to 100 characters, read from the file by labelling and editable by the admin) instead of a fixed publisher. The knowledge base lists them under "Local standards", after NFPA standards.

Reason: reports cite NFPA, FM Global and local guidelines; CP 52 is cited by all 11 sample reports. Report drafting does not search local standards yet; that is left to the report-generation owners.

## 2026-10-17 — Tables keep their headings and title, two-column pages are read by column, and search reads the heading trail

Chose:
- The table reader returns each table's printed title, how many top rows and left
  columns are headings, and the grid. Code builds the labels, so stacked headings
  become a path ("Inside Hose > gpm") and headings on both axes label every value.
  A crop with two tables gives two passages, each under its own title (Docling's
  caption when there is one). Long tables are cut between rows into groups that
  repeat the title.
- `columns.py` reads a two-column page left column, then right, before headings are
  ranked. Clause numbers that run backwards are logged as a cross-check.
- The embedder and the reranker see the heading trail before the text. Short forms
  in a question ("EH2") are spelled out. Chat widens its best 3 hits to their whole
  table or neighbouring passages (capped); drafting does not.

Reason: CB-01's search missed answers inside tables and on two-column pages (the
hose stream table, EH2 density, the light-hazard coverage table, the dry valve trip
test row, the hydraulic nameplate list). The title and the headings were never in
the text that was embedded or reranked, a header row came out as data, and two
tables or two columns in one block averaged out what each was about.

Rejected:
- Widening a hit to every passage under its parent heading: in the nameplate case
  the list sat under the wrong heading, so its siblings were not the list's, and a
  broad heading would add dozens of passages. Neighbours by position and a table's
  own groups are bounded and fix the same cuts.
- Asking the model to merge multi-row headings itself: counts of heading rows and
  columns are easy to get right; merged strings risk changing printed numbers.
- Re-reading flagged pages with a vision model for column order: costly; kept as a
  fallback if the geometric rule proves too weak on real pages.

This reverses "Fixing two-row table headings" in the 2026-10-10 decision, which
judged that retrieval only needs the gist. The CB-01 misses show it does not.

Known limits: table schema and embedded text change, so affected documents must be
re-ingested (NFPA 13, FM 2.81 and FM 2.0 first); old passages are not widened. A
table continued on a page that shows no heading row has bare values on that page.

Stories: CB-01, IN-03.

## 2026-10-17 — Pictures in knowledge documents are described by the OCR provider, labelled as generated

Chose:
- Each picture Docling locates is cropped and read by the table/formula OCR provider
  (`OCR_PROVIDER`, Claude Haiku 5.5 by default) as a new `picture` task, in the same
  pass and thread pool as tables. The prompt takes S5's photo-reading rules (CP-05):
  only what is visible, nothing guessed, no causes, consequences or compliance, never
  an invented hazard. The heading trail and caption are sent as context, to know what
  to look at, not as fact.
- Under GLM pictures are left unread: GLM-OCR can transcribe but not describe. The
  caption and nearby prose stay searchable as before.
- The description is searchable, but its text says "Image description (generated,
  …)" and its passage records who wrote it (`generated_by`, `prompt_version`).
- One passage per picture, built like a table's: its own bbox and page, the chunk's
  heading trail and position, nearby prose kept with it.
- Pictures under 72 pt on either side are skipped as logos and icons (Office Sample 5
  and FM-200 logos are 24–59 pt tall). A picture Docling repeats is read once by the
  tables' box check; distinct pictures on one page each keep their own passage.
- A table none of whose crops reads as a table is read once as a picture: Docling
  sometimes labels a photo or drawing as a table.

Reason: past reports carry site photos and standards carry diagrams whose meaning
was lost: an uncaptioned picture was in no passage at all. The OCR provider already
crops regions, waits out rate limits and records usage, so pictures need a prompt,
not a pipeline.

Rejected:
- Calling S5's photo interpreter: it reads S3 keys for one observation, answers in
  an observation's form (COPE category, hazard type), is Gemini-only (the team's key
  was rejected on 10 Oct) and would add a network hop per picture.
- Reading pictures on RapidOCR's "returned empty result" warning: it is a log line
  inside Docling, not data, and a photo it fires on is already labelled a picture.
- Merging overlapping or contained picture boxes: only near-identical boxes are one
  picture; nothing on the sample PDFs needed more.
- Leaving descriptions unmarked: a draft could quote a model's words as the
  document's.

Known limits: drafting and chat do not yet show that a quoted description is
generated (follow-up story); `generated_text` is there for it. A tall narrow figure
under 72 pt wide is skipped (FM-200 Figure 16, 59 x 243 pt); an area rule would
keep it. A picture before a table in the same chunk is placed after the table.
Documents must be re-ingested to gain picture passages.

Found on the way: HybridChunker hands back plain DocItems (label, self_ref and prov
only), so table passages had silently lost Docling's caption and the prose beside
the table since the CB-01 change; its tests used fakes that carried text. Tables
now look their items up in the document as pictures do. On FM-200 pages 45-55, 5 of
7 table passages gained their printed title and 6 the prose beside them; ids are
unchanged. Table documents must be re-ingested for this too.

Stories: IN-13, IN-03, IN-12, CP-05.

## 2026-10-18 — Each cost row shows its tokens and opens to its calculation, priced by the same parts estimateCost stores

Chose: overview groups and ingested documents carry `totalTokens`, `costLines` (quantity × rate = cost per service, model, part and rate) and `reconciliation` (calculated beside recorded). The screen adds a Tokens column and a chevron per row that opens the calculation. `estimateCost` now prices through `costBreakdown`, the function that builds the lines, so a line cannot disagree with the cost it explains; labelling, priced by the ingestion service, is shown from a copy of its `PRICES` table.

Reason: a total cost could not be checked by hand. Tokens are summed from the stored provider counts, never cost ÷ rate, which would only restate the cost. Whisper and Cohere rerank bill in minutes and searches, so their lines carry their own unit rather than being forced into tokens.

Rejected:
- One calculation table for the whole period: it cannot answer why one assessment costs what it does.
- Fetching a row's lines when it is opened: a new endpoint, a loading state per row; the rows are already in memory when the group is built.
- Whole-row click to open: the Assessment and Engineer cells already open the drill-in and narrow the overview.

Known limits: a difference appears when prices changed after recording (`npm --prefix server run migrate:prices` only reprices rows that had no price). The labelling copy must be kept in step with `labelling/config.py` by hand.

Stories: EV-04, EV-03.

## 2026-10-18 — Each AI call stores the rates it was charged at

Chose: `estimateCost` returns the parts of a cost (quantity, rate, cost each) and the gateway stores them on the call as `ai_calls.costParts`. The cost report builds each row's lines from them instead of re-pricing at today's rates, so the lines always add up to the row's total and the Calculated / Recorded / Difference footer becomes one Total. The labelling service sends the rates behind its `cost_usd`, and the gateway's copy of its `PRICES` table is gone. `npm --prefix server run migrate:cost-parts` backfills older rows once, only where today's rates reproduce the stored cost exactly; the rest show as "rates not recorded" at their stored cost.

Reason: rates change, and re-pricing an old call at today's rate misstates what it was charged. A dated price table would only be right while nobody edits a past price; the rate stored on the call cannot drift.

Rejected:
- Dated price tables for every vendor (as Gemini's): correct only if every change is added as a new dated entry, never edited in place.
- Recalculating old rows at today's rates: a second code path that shows rates the call was not charged.

Supersedes the "difference means prices changed" part of the entry above.

Stories: EV-04, EV-03.

## 2026-10-18 — Rates are shown on the detail pages, one table per way of billing

Chose: the overview and ingestion tables go back to their totals: no Tokens column, no per-row dropdown. An assessment's drill-in shows its usage and rates, and each knowledge document gets the same detail page from the Ingestion tab (`GET /api/usage/ingestion/:key`). Calls are grouped into one table per way of billing (Claude and OpenAI; other token models; Cohere embeddings; Cohere rerank; Whisper), each quantity with the rate stored on its calls beneath it. The "How these costs are worked out" box is gone: the totals card keeps its Estimated badge and shows calls without a cost (EV-04 AC7).

Reason: the dropdown crowded the main tables, and the drill-in already existed for exactly this. One table per way of billing keeps every column meaningful: the old Usage table's five unit columns were mostly dashes, since each feature bills in one to three of them. Cache reads (drafting, chat, Claude OCR), search units (rerank) and audio (Whisper, billed per minute) are all recorded and all priced, so none was dropped. Ingestion keeps a time per call but not a Speed table: its calls are saved as totals per stage, so only the average is known.

Rejected:
- One combined table with a column per unit: mostly empty cells.
- A separate rate column beside each quantity: ten columns for Claude; the rate sits under its quantity instead.

Known limits: the Unassigned row has no drill-in. A document's detail page is all time, while the list is for the period chosen, as for assessments.

Supersedes the per-row dropdown and Tokens column in the first entry of this date.

Stories: EV-04.

## 2026-10-18 — The chatbot has its own cost page, charted by day

Chose: the overview's Chatbot row opens a page for the period on screen: totals, cost per Singapore day (a bar per day in date order, every day shown, split by billed service, with the same figures as a table), cost per person who asked, and usage and rates with a CSV export (`GET /api/usage/chat`). The chart gained an in-order mode so days are not sorted by cost.

Reason: chat cost accrues daily per person, under per-person daily limits (CB-01), unlike an assessment or a document, whose cost is mostly incurred once; so its page answers "how much, when, and by whom" rather than all-time totals.

Rejected:
- Charting tokens over time: chat uses more than one model at very different prices, so a token line would mislead; tokens are in the usage and rates tables, per model, at the rate charged.
- Counting questions per day: `ai_calls` holds calls, one question makes several, and calls carry no question id.

Stories: EV-04, CB-01.

## 2026-10-18 — The chatbot's cost is stepped by calendar month or year

Chose: the chatbot page has its own period, separate from the overview's rolling ones: Month (a bar per Singapore day) or Year (a bar per month), stepped back and forward (‹ October 2026 ›), opening on this month. A finished period shows its change from the one before (↑ 18% vs September 2026); a period still under way shows none.

Reason: budgets and bills are monthly (EV-04's goal is the ongoing budget), so calendar months give totals that can be compared and reconciled, and stepping reaches any earlier month. A rolling window moves every day, cannot go back, and "All time" as one bar per day stops being readable after a few months. Comparing a part month with a whole one would always read as a fall.

Rejected:
- Weeks: they straddle months, so weekly totals never add up to a bill; a month's daily bars already show the weekday pattern.
- A calendar or date-range picker: the buckets are days or months, so it offers precision nothing uses, and the design system has no accessible one. A stepper and "This month" cover the common moves.
- Comparing a month so far with the same days of the month before: fair, but harder to read than no comparison until the month ends.

Supersedes the period-follows-the-overview part of the entry above.

Stories: EV-04, CB-01.

## 2026-10-19 — The report is edited as one TipTap document; each save is a section version, and a change to a finding is a review decision

Chose: Edit document, in the review workspace's rail, opens the whole report as one continuous document (RV-08): Sections 1 to 12 and Appendix A in report order, each under its fixed heading, a drafted section's template subsections under theirs. It is one TipTap (ProseMirror) editor, so undo, redo and find and replace run across every section.
- What the engineer cannot change here is held in place as atoms by a structure guard (`document/plugins.ts`): the headings, why a section was not drafted (from Generation's evidence counts), and the parts filled in elsewhere, shown read-only where they sit: Section 1's assessment details, the OFIs, Sections 4 and 5's figures, a table subsection and the Appendix A photos. Every section, those included, takes text.
- Text is paragraphs, the engineer's sub-headings and flat lists, with bold, italic and underline. A citation marker is an inline atom naming its source, so it moves with the words around it and goes only when deleted. A paragraph taken from the draft carries its finding key, kept when it is set as a sub-heading or a list item (a change of setting is an edit, so AC6's formatting applies to findings too); a split, pasted or moved copy loses it and becomes the engineer's text.
- Each save adds a version of each changed section to `report_section_versions`, append-only like the review log, built on the newest version (`baseVersion`) and the saved draft (`draftId`): if either has moved on, nothing is saved (409) and the editor offers Reload. It saves 1.5 s after typing pauses, or on Save, showing when it last saved; leaving with unsaved changes asks first (Return to review, another tab, the side navigation, Add observation, Sign out; the browser's own prompt for the page), and choosing the view already open does not.
- In sections 4-12, a finding changed in its words, citations or formatting is also an `edit` entry in `review_audit_log`, with `citationsAfter`, and one deleted (or emptied) a `reject` entry, both marked `inDocument`: the finding's state, the review summary, the summary's out-of-date check and EV-02's counts read the same log, and Restore in the review history brings a deleted one back. Drafts are still never changed.
- A finding missing a citation it was drafted with is unsupported (`foldFindings`), so it is flagged in review until rejected, like any unsupported finding, and editing an unsupported or withdrawn-source finding keeps its flag (the "open uncertainty" of AC11). The editor flags both, and a deleted citation the moment it goes.
- A section changed or written in the document reads Edited by you (`edited`), after Needs review and before the RV-02 states; under Needs review the rail shows Edited by you beside it (`editedInDocument`), so AC12 holds either way. A section with no draft is complete once written.
- The review workspace shows a section's newest version while it was made on the saved draft: a finding in its saved formatting while its words are still the finding's, else in the words of a later RV-02 edit; a rejected finding left out; a restored one at the end of its subsection. Once the section is drafted again, the version is set aside with a note: its edited findings were carried into the new draft by RV-02, but text the engineer wrote stays in that version.
- Section 2's statements have no review decisions (GN-07), so its changes are kept in the version only.

Rejected:
- One editor per section: undo, redo and find and replace would stop at each section's edge, and AC1 asks for one continuous document.
- A content-editable page without a library: lists, undo across formatting and atomic citation markers are where hand-rolled editors fail.
- Overwriting one copy of each section: earlier text would be lost, and RV-06 needs the versions.
- Storing only the versions, with no log entries: a finding edited in the document would still read Pending, and the review summary and EV-02 would miss it.
- Making a deleted citation a separate flag: the review workspace already explains Unsupported and keeps it until rejected; one more state would need its own resolution.
- Letting the template's subsection headings be edited: completion, Section 5's level tables and Section 6's programs table find their findings by heading.

Known limits: text written into a section is not summarised by the Executive Summary until a finding in it changes (the summary's check counts decisions). Drafting a section again on Generation sets aside text written into it; it stays in its version, but nothing yet shows earlier versions (RV-06).

Stories: RV-08, RV-01, RV-02.

## 2026-10-19 — Handwritten note pages are a fourth capture mode, transcribed like a recording by Gemini in S5

Chose:
- Scan, a fourth mode beside Note, Voice and Photo (CP-19). The engineer takes or chooses a JPG or PNG per page; each is stored unaltered in S3 under the observation's `pages` and transcribed once saved, exactly as a recording is: one attempt per page, Transcribing / Transcribed / failed with a readable reason, retry only after a failure, a restart marks a running attempt failed, the list refreshes while one runs. The text stays with its page, like a transcript with its recording; the typed note is untouched.
- S5 transcribes, replacing its `/ocr` stub and the unused `USE_CLOUD_OCR` setting with `POST /transcribe-handwriting`. The provider is `HANDWRITING_PROVIDER` (only Gemini implemented), with its own `HANDWRITING_MODEL`, both defaulting to photo reading's, so the eval can try another model without changing photo reading. Gemini, as for photos: its SDK and the photo preparation (upright, 1600 px) are already in S5. Temperature 0, `store: false`.
- Word for word: abbreviations, numbers and spelling as written, nothing expanded or corrected. A word the model can't read for certain is its best guess marked uncertain, returned as data (lines of `{ text, uncertain }` words), not markup, and shown underlined and counted for the engineer to check against the page.
- A transcribed page with text is drafting evidence: it counts towards a section's minimum and goes to S4 as `handwriting`, labelled `Handwritten note:` apart from the note and voice transcripts, and searched by as they are (one `Observation.recorded()` helper for every search and check). Drafting waits while a page transcribes. Prompts bumped to `gn01-v2.10` and `gn05-v5`.
- The draft's evidence gains `handwriting` only when an observation has some, with no default: `changesSinceDraft` compares evidence as JSON, so evidence without pages must read exactly as before, or every earlier draft would show as out of date.
- A page is not a site photo: the Photos tab, Appendix A (GN-07) and photo reading leave pages out. Pages have their own Scans view instead, opened from a Scans box beside the Observations tab's Photos box: every page of an observation not deleted, with its transcript, original and actions. The tab's four boxes now use the Overview's grid (two by two, four in a row from 760px), as four no longer fit one row on a phone.
- Each Gemini call allows one retry and 90 s per attempt. The SDK's default (three retries, no time limit) held pages for minutes on a free-tier key that was rate-limited and overloaded, until the gateway's five-minute wait ran out and reported S5 as unreachable. The reason shown now names a used-up limit, a busy service or a slow answer.
- (CP-20) A finished page can be transcribed again when its text looks misread. Unlike Retry after a failure, which any risk engineer can press (as for a recording), it replaces evidence, so only the assessment's assigned engineer can ask (CP-08's rule for changes). The old text is cleared as the attempt starts, as photo reading's Read again clears its proposal, rather than kept until the new one arrives: a page then has one state, and a failed re-read shows as failed with Retry instead of silently keeping text the engineer doubted.
- `transcribe-handwriting` is its own usage feature, billed to `gemini-vision`. Its chart colour is aqua dark, Google's second step, re-stepped to `#008d65` (see the design system, "Charts").
- Measured by `eval/transcribe_handwriting.py` on team-written pages with known text: word accuracy and how many wrong words were marked uncertain (AC16's 90% and 80% are placeholders until the first run).

Reason: engineers write notes on paper on site; retyping them is the drafting time the tool is meant to save. Treating a page like a recording reuses a flow engineers and the code already know, keeps the transcript as evidence of what was written, and needs no new review step before saving.

Rejected:
- Reading the page into the note before saving: the engineer would check every page on site, with signal, before saving; and the note would mix typed and machine-read words with no record of which was which.
- Saving pages as photos: they would reach the photo appendix and photo reading, and a photo's text is not drafting evidence.
- Tesseract or Textract (the stub's plan): Tesseract reads handwriting poorly, and Textract would add a vendor for one task.
- Anthropic: the team's Claude key works and reads printed tables well in ingestion, but Gemini is already S5's vision provider and its paid-tier key and preparation are there. The provider switch leaves Claude a setting away.
- Marking uncertain words inline (`[[word]]`): unbalanced markers; structured words cannot be.
- Passing the uncertain marks to drafting: it would change GN-01's prompt and evals; the marks are for the engineer, who corrects them (CP-20).

Known limits: correcting a page's text, adding pages to a saved observation, and removing and restoring them are CP-20; `POST /api/observations/:id/media` refuses `page` parts until then. The uncertain marks are the model's own judgement, with no per-word confidence from Gemini; the eval measures whether they catch the misread words, and AC9 may change if they don't. Depends on a working paid-tier `GEMINI_API_KEY`, shared with photo reading. Pages are English only.

Stories: CP-19, CP-20, CP-03, CP-08, GN-01, RV-01, EV-03.

## 2026-10-20 — The model may propose Sections 4 and 5's figures; only figures an engineer confirms are used

Chose:
- (GN-03 addendum) A **Propose figures** action on Generation and in Review's figures forms. The model reads the observations and the drafted Sections 3 and 6-12 and proposes Section 4's fourteen scores, or Section 5's per-level areas, % damage, outage months and % impacted, each with a one-line reason and the sources it cites. Site values are never proposed: money can't be read from site notes.
- GN-03 AC10 changes from "no figure has been generated by the language model" to "no figure is used until an engineer confirms it". The proposal is stored beside the figures (`riskQuality.proposal`, `lossEstimates.proposal`), never in them; the rating and losses are computed from saved figures only, and the charts (GN-12) are drawn from those.
- Proposals pre-fill the empty boxes in AI violet with an AI proposal note; editing a box drops its mark; saving is confirming (the button reads **Confirm figures** while any box still holds a proposal). Any save hides the proposal, so a saved form is never refilled from it. Proposing is refused once figures are entered, and while a proposal waits, since a second one is another paid call.
- Code checks every proposed figure: scores 0-10 with potential at least current, % 0-100, months not beyond the indemnity period; the seven categories in order. Anything else is left blank for the engineer.
- Its own prompt (`gn03-prop-v3`), not the drafting prompt: Section 5's drafting instructions forbid writing figures, which made the first version propose none.

Measured (`eval/score_figures.py`, prompt `gn03-prop-v3`, 20 Oct), against Marsh's real figures:
- Section 4, within one point of Marsh: Office Sample 5, 7 of 14 (a constant "every score 8" gets 6); Shopping Mall Sample 2, 10 of 14 (the constant gets 12). On average the proposals score low (by 1.0 and 0.2), most on Fire Protection.
- Section 5 (Office Sample 5): outage months within 3 of Marsh's at all three levels; % damage well below Marsh's (40 and 70 where Marsh assumes 100 for the fire floors).

Reason: engineers start Sections 4 and 5 from blank tables. A proposal with its reasons and sources is a starting point to check, and the confirm step keeps the figures the engineer's.

Known limits: the proposals are no more accurate than a quick guess and lean low, the unsafe direction for an insurer, so the AI note says so ("Proposals tend to score low: compare each with your own judgement"). Nothing is retrieved from past reports: Marsh precedents are the likely next improvement. Two cases are a small sample. To raise with Marsh: whether AI-proposed risk scores are acceptable at all.

## 2026-10-20 — Report drafting is masked before Cohere and the model, and fails closed without privacy-service

Chose:
- (PV-02) With `PII_PROTECTION=required`, section drafting (including redraft and Regenerate), OFIs and the Executive Summary send Cohere and the model only masked text: client details become typed placeholders (`[CLIENT_1]`, `[PERSON_2]`) from privacy-service's `/mask` (PV-01). Chat, photo reading, ingestion and speech-to-text are not protected yet; `docs/areas/privacy.md` lists what is.
- The gateway owns the switch. `privacyFor(reference)` sends `privacy: {enabled, known_entities}` with each drafting request: the assessment's client, site (name and code), address and every active user. The Python services never read `PII_PROTECTION`; a request without `privacy` drafts as before.
- Masking happens on the orchestrator's inputs, not in `llm.complete`. One `/mask` call covers the request's own text (notes, transcripts, handwritten pages, locations, standards, facts, redraft text and instruction, accepted OFI titles, or the summary's sections), so one mapping serves both the Cohere queries and the prompt, and the prompt is built from masked text.
- Past-report passages (text and headings) are masked in a second call that passes the first call's mapping back, **before rerank**: the leak test found them reaching Cohere rerank raw. Standards are public and are not masked. The reviewer's `sources` show the stored passage.
- Unmask before any check that compares text: the citation, maturity and number checks run on the restored statements, against the original observations and facts. A section or summary statement holding a placeholder that can't be restored is unsupported; an OFI has no such flag, so the placeholder stays visible for the engineer and a warning is logged without the text.
- Fail closed. If privacy-service is down, times out (`PRIVACY_TIMEOUT`, 10 s) or errors, the draft fails with a readable reason (rag 502, gateway 503) and nothing is sent. Raw text is never a fallback.
- Text already shaped like a placeholder (typed by an engineer, or in a past report) becomes `[LITERAL_n]` before masking and is restored after unmasking, so unmasking never puts a real name where the input had none.
- All three drafting prompts tell the model to copy placeholders exactly (`gn01-v2.11`, `gn05-v6`, `gn07-v3`). The rule is there with protection off too, so off and on runs differ only in masking.
- Provenance records `privacy: {enabled, masked_count}` on `report_sections` and `report_ofis`, never the values or the mapping.
- Quality margin (G1): each judge's mean may drop at most 0.2 with protection on. Measured 20 Oct (drafter `claude-sonnet-5-5`, judge `gpt-6-luna` at medium reasoning, two judge runs averaged): sections 4.55 → 4.50, OFIs 4.65 → 4.55, summary 4.56 → 4.88. All within the margin; per-case results are in `docs/areas/privacy.md`.

Reason: drafting sends the most client text to external APIs (observations, saved sections, past reports), so it is protected first. Masking the inputs keeps one mapping per draft and keeps the guardrails working on real text, and failing closed means a privacy-service outage can't quietly send client details.

Rejected:
- Masking the finished prompt in `llm.complete` (the epic's first plan): it would mask the already-masked text a second time and miss the Cohere queries, which are built earlier.
- Escaping placeholder-shaped input as `[ PERSON_1 ]`: the lenient unmask pattern still matches `PERSON_1` inside it.
- Masking standards: they are public, and masking would change what search and the model read without protecting anyone.
- Sending raw text when privacy-service is unreachable: one outage would undo the protection without anyone noticing.

Known limits: another client's name or address inside a stored past report is not detected, because organisation and location recognition are off and known entities hold only this assessment's client; PV-05 redacts past reports at ingestion. spaCy reads some site fragments as names (for example "L33-47 - site"), which the model then sees as `[PERSON_1]`; they are allow-list candidates. The eval cases come from redacted reports, so the eval measures the cost of masking, not how real names are handled.

Stories: PV-02, PV-01, GN-01, GN-05, GN-07, RV-02.

## 2026-10-20 — A section's version history is its AI drafts and its saved versions; a restore is a new version

Chose: Version history (RV-06) lists, for each part of the report, every AI draft it has had and every version saved in the document editor (RV-08), oldest first (AC1), each with who made it and when (AC2): who saved a version, who drafted a draft (looked up from its `createdBy`), who accepted a replacement. Nothing new is stored to list it: the drafts are those in `report_sections` that have been the section's saved content (a draft from Generation from when it was drafted, a replacement from when it was accepted, never one waiting or discarded; `savedDraftTimeline`), and the versions are RV-08's.
- A draft's text in the history is its statements as the document editor first shows them, in the words they had when it became the section's content: a finding kept word for word into a redraft carries the engineer's edit with it (its `carriedFrom` entries), and decisions made on the draft since are not part of it. So a section only ever reviewed finding by finding still has a history, and the AI's own words can be compared and restored.
- The comparison is computed in the browser (`versionDiff.ts`), between the chosen version and the section's text as the review workspace shows it, or the version before it: subsections matched by heading, blocks aligned by their longest common subsequence and the rest paired when much alike (Dice ≥ 0.4 by word), then words aligned the same way. Words added are marked `ins` (AC3), words deleted `del` (AC4), and words deleted with others added in their place one outlined change, read out as Changed from … to … (AC5). A word carries its formatting and a citation marker is a word of its own, so a word set in bold or a deleted citation counts as a change; spacing does not. No package: a word-level LCS is a page of code.
- A restore (AC6) is a save: `POST …/sections/:sectionId/versions/restore` with the entry's `id` adds the section's next version holding its text, built on the newest version and saved draft the engineer saw (else 409, as a save), and names it in `restoredFrom` (`version:<n>` or `draft:<_id>`). In sections 4-12 the saved draft's findings follow the restored text through RV-08's `recordDocumentEdits`, extended for a restore: a finding the text lacks is rejected, one it holds that was rejected since is restored, and one worded otherwise is edited to its words, each entry marked `inDocument` and with the same `restoredFrom`, so the finding states, the review summary and its out-of-date check, and EV-02 read the restore as they read any edit. Nothing is overwritten: the text a restore replaces stays in the history, so a restore can be undone by restoring again.
- Text written on an earlier draft (a version set aside by a redraft, or an earlier AI draft) is carried onto the saved draft first (`ontoDraft`): a passage that was a finding becomes the saved draft's finding with the same words in the same subsection, if one is left (the findings a redraft kept word for word are found this way), and anything else is the engineer's own text. A subsection the saved draft lacks, or has as a table, gives its text to the part before the first subsection. This is what recovers text a redraft set aside (RV-08's known limit).
- A restore touches one section (AC7): one version and that section's log entries; and as a saved version it is what the section reads from then on (AC8).
- The history is shown in place of the part's draft, in the review workspace's three panes: the rail stays, so the history follows the engineer from part to part; the versions sit in the side panel; the comparison takes the centre. It opens from a Version history button on every part's editor bar, and from the assessment's ⋯ menu, which held a "not connected" placeholder until now. Anyone who can view the assessment reads it; only the assigned engineer, on an assessment not archived, restores.

Rejected:
- Listing the document editor's saves only: a section reviewed only finding by finding would show no history, and the AI's words could not be compared or brought back.
- Writing a version on every review decision too, so every change is a version: every accept would add a copy of the section, and the review history already keeps each edit's text before and after. A decision since the newest version shows in the comparison with the current text instead.
- Restoring by making an earlier draft the saved draft again: drafts are never changed and the saved draft is the newest, so it would need a new kind of log entry, and the decisions on the current draft would be left behind.
- Refusing to restore text written on an earlier draft: that is the text most easily lost.
- Comparing on the gateway: the text the engineer sees is assembled in the browser from the draft, the decisions and the version (`sectionContent`), so the comparison is made against exactly that.
- A diff package: it would need words, formatting and citation markers mapped into and out of its own model, for no gain over the small LCS kept beside its tests.

Known limits: restoring a finding's drafted words leaves it Edited (with the draft's words), not Pending, since the log has no "undo"; the review history says it was edited by the restore. Every pause in typing in the document editor saves a version, so a long editing session lists many; they are not grouped. A restore of text written on an earlier draft can only match findings by their exact words.

Stories: RV-06, RV-08, RV-02.

## 2026-10-22 — A new account's owner sets their first password from an emailed invitation, not the reset

Chose: creating an account (F-08) emails its owner an invitation: a link to `APP_URL/?invite=<code>` that opens its own Set your password screen. The screen checks the link as it opens (`POST /api/auth/invitation`), greets the person by name and shows their work email, and sets the first password with `POST /api/auth/invitation/accept`. The code is stored only as a sha256 hash (`inviteTokenHash`), works once, for 72 hours, and only for an active account that has no password yet. A knowledge admin can resend it from the profile (`POST /api/users/:id/invitation`), which cancels the earlier link; correcting a not-yet-set-up account's email cancels the link sent to the old address and invites the new one. The account list shows such an account as Invitation pending. A first password needs at least 12 characters, a number and a symbol, checked on the gateway as well as the screen. The reset (F-06) now sends nothing to an account with no password: a reset replaces a password, it does not create one.

Rejected:
- Keeping the reset as the way in (2026-10-04): the new employee had to know to request a reset for an account nobody had told them about, the reset's 30-minute link is too short for a first sign-in, and it made Reset password the de facto onboarding step.
- Reusing the reset token and `/api/auth/reset` for the invitation: one token field would let a reset request cancel an invitation and the reverse, and a reset link would set a first password with none of the invitation's checks (active account, no password yet).
- The admin typing a first password: one person knowing another's password and sending it outside the app.
- Signing the person in as soon as the password is set: going back to the sign-in screen, with the email filled in, lets the browser offer to save the new password, and matches what the reset does.
- Failing the account creation when the email can't be sent: the account details are right, and the admin can resend once mail works; the account shows no open link meanwhile.

Reason: a new employee should hear about their account by email, with a link that lasts long enough to be found in their inbox, and the reset should stay the recovery path it was built as. Separate fields and routes keep the two links from interfering. Mail uses the same SMTP settings as the reset; with no `SMTP_HOST` the code is printed in the server console.

Known limits: the 72 hours are fixed in `invitation.service.ts`. The first-password rule does not apply to the reset yet. An account created before this change, with no password, shows Invitation pending with no open link until an admin resends it.

Stories: F-08, F-06.

## 2026-10-26 — The pre-survey checklist is the template's subsections in code, plus cited items from the standards in scope

Chose: an assessment's Checklist tab (CP-30) generates a pre-survey checklist from three sources, each with its own guarantee:
- Marsh's report template: one item per subsection of Sections 6-12 in `sections.json`, written in code, so building details such as walls, roof and frame are always covered (AC3). "… Comments" subsections ask for judgement, not inspection, and get no item.
- Hazards per facility type: `rag-service/app/generation/checklist.json` names 3-4 hazards for each of the nine facility types, each with the NFPA or FM standards it is checked against. Every hazard gets an item; if the model writes none, the config's own item is added, flagged `uncited` (AC4, AC7).
- The standards the engineer keeps ticked (AC1-2): the model (`LLM_MODEL` at `CHECKLIST_EFFORT`, default `medium`) adds items from their passages only, each citing passages by label with the words it rests on. Code drops citations of passages not given, looks for each quote in its passage, and flags an item left with none.

The gateway lists the applicable standards (FM, NFPA or local, labelled with the site's facility type and country or `all`, not withdrawn or needing review) and sends S4 only the facility type, country and chosen standards. Each generation is a new `checklists` document and the latest is shown (AC9). Items are stored with room for later stories (`status`, `prefill`, `check`), so CP-31 to CP-34 need no migration. Paid calls are recorded under a new `checklist` feature.

Rejected:
- One item per template field (~90 items): too long to read before a visit; fields are listed under their subsection's item instead.
- Letting the model write the whole checklist: template coverage would depend on the model, and AC3 could fail silently.
- Hazards editable by a knowledge admin: a screen and a collection for a list that changes rarely. A versioned file, recorded on every checklist, is enough until Marsh asks to edit it.
- Overwriting the checklist on regenerate: CP-32 must keep the engineer's edits across regenerations, which needs the earlier version.
- An Overview card: 60-plus items need their own tab, which CP-31 will also open from capture.
- The template's items first: about 44 of a checklist's rows are the report's own subsections, which an engineer knows already, and they buried the cited rows. The tab shows the priority risks, then each report section once, showing by default only what the standards add (a switch shows the template's subsections with them). Two lists by section, one of the standards' items and one of the template's, repeated every section heading.
- Masking: nothing about the client or site is sent, so there is nothing to mask; the request has no field for it.

Reason: Marsh asked for checklists by facility type (warehouse vs office: roofing, hazardous storage, NFPA), built from the knowledge base. Fixed coverage in code and citations checked in code keep it trustworthy without an LLM judge.

Known limits: the hazard lists were drafted by the team and are to be reviewed with Marsh. A hazard's named standards are matched to knowledge-base documents by source type and standard number, so a standard labelled without a number is not recognised as one of them. Standards are listed per facility type and country, not by the risk areas RT-01 describes. A site saved before the gateway checked facility types may hold another, such as the old seed's `Warehouse`: it gets no hazards and the checklist says so. The gateway now refuses a new or changed facility type off the list, but keeps an unchanged older one, so such an assessment can still be edited; existing sites on a shared database are not migrated.

Stories: CP-30.

## 2026-10-31 — One checklist, answered the same on the tab and on site; an item is answered by the observation that answers it

Chose: the assessment's Checklist tab and the sheet opened from capture (CP-31) show one shared view (`ChecklistItems`), so they cannot drift apart:
- The facility's **Priority risks** and the **Report sections** are two tabs, each with how many of its items are answered.
- Report sections open on the relevant sections (those the ticked standards add to) or on all of them, as the engineer last chose; the choice is kept in the browser, so the tab and the sheet open the same way. With no standard in scope, all sections are shown.
- Each card says how many of its items are answered and, for a report section, how many more observations it needs to be drafted (AC6-7). Items answered when the card was first shown fold under **Answered (n)**; one answered meanwhile stays where it is, so nothing moves under the engineer's thumb.
- Each item shows its citations and its answer, with **View observation**, or **Confirm**, **Differs** and, behind ⋯, **Not seen** and **Not applicable**.

Only what has to differ does: the tab keeps choosing standards, generating and regenerating; on site the answers are saved where capture is, and on the tab the answer box asks where. Answering from the tab opens a capture session first, as every observation belongs to one; starting one is safe to repeat.

Confirm and Differs share one box: what the checklist expects, what was seen (Confirm starts from the item's words, Differs starts empty), an optional photo, and the severity, always chosen (CP-02). It saves an observation with the item's categories, linked to the item, without leaving the checklist (AC2-3). For a recording or handwritten notes, Differs offers full capture instead: capture opens with a card naming the item, and the next observation saved answers it as Differs. **Back to checklist** leaves the item unanswered and reopens the sheet. Not seen and Not applicable are marks on the item (`check`), with no observation (AC4).

An item's Confirmed or Differs is read from the linked observation, not stored on the checklist, so deleting the observation unanswers the item and restoring it answers it again (AC5) without keeping two records in step. The observation keeps the item's text, so it reads right after a regenerate. One observation answers an item at a time.

Regenerating keeps answers on items that come back the same: a template subsection, a hazard's own item, or a model-written item in the same section or risk that cites a passage the earlier one cited (or is worded the same). The model rewords every item on every run, so wording alone kept none of its answers; on two real checklists with the same standard, 0 of 17 model-written items matched by wording, and 16 by section and passage. The subsection is not required, as the model files the same requirement under a subsection on one run and under the section on the next; it only breaks ties. Each such new item lists the earlier ids it continues (`carried`), so the observations still answer it, and takes over the earlier mark. Observations are never rewritten. The tab asks before regenerating an answered checklist. Afterwards it says, until dismissed, either "Checklist regenerated: All your answers are kept." or how many answers were not kept. Meanwhile the unmatched new items in the same section or risk as an answer not kept, which may replace it, are tinted and tagged "Answer again?", and each tab says how many it has to check; the earlier wording of the items not kept is folded under "Show the earlier wording", for one removed rather than reworded. Dismissing clears the message and the highlights. Nothing is said after generating a checklist that had no answers.

Saving any observation now needs the assigned engineer and an unarchived assessment, as changing one already did (CP-08 AC17). Before, only an active capture session was checked, and a session opened before archiving stayed active.

Rejected:
- Separate views for the tab and the sheet (the first version): they drifted, the sheet showing every template row and the tab only the relevant sections, and engineers could not tell which was the checklist.
- A read-only tab with an Answer on site button: the same checklist would behave differently in two places.
- Differs taking the engineer back to capture with a banner and Unlink: it left the checklist for the common case, and Unlink was unclear. Full capture is now the exception, with a plain way back.
- Four buttons on every row: crowded on a phone; the rarer marks sit behind ⋯.
- "Checked": it clashes with "checklist"; items are "answered".
- Counting the answers carried over after a regenerate ("0 checks carried over", "All 5 answers kept"): a count of what was kept reads oddly. Only the answers not kept are counted.
- A confirmation that fades after a few seconds: easy to miss; both messages stay until dismissed.
- Pointing at the one new item that replaced each lost answer, guessed from similar wording: a wrong guess would send the engineer to the wrong item. The candidates in its section or risk are highlighted instead.
- Highlighting every new item: as the model rewords everything, that was every model-written item, which showed nothing.
- Matching model-written items by wording only: no answer on them survived a regenerate.
- Listing the lost items in full in the message: a long list above the checklist; the highlights show where to look, and the list is folded away.
- A one-tap Confirm with a generated note and severity low: severity is never assumed (CP-02), and an item's wording is an instruction, not a finding to draft from.
- Storing Confirmed and Differs on the checklist item as well: two records to keep in step, and deleting an observation would leave the item answered.
- Rewriting observations' links on regenerate: an observation should keep the item it actually answered.
- Refusing to regenerate once items are answered: an out-of-date checklist (CP-30 AC9) could not be refreshed.
- Checking only the checklist's saves for the assigned engineer: it would leave the same gap in ordinary capture.

Reason: the checklist should guide what is observed and feed the report without a second record of the same finding, and it should look and work the same wherever it is opened. Reading the answer from the observation keeps one source of truth, and the CP-08 delete, restore and audit rules apply unchanged. No external AI is called, so nothing needs masking.

Known limits: a model-written item that rests on different passages after a regenerate, or moves to another section, loses its answer; its observation stays, and the new items in its section or risk are highlighted. Two devices saving against the same item at the same moment can both succeed; the item then shows the later one. An item answered while its card is open moves under Answered only when the checklist is next opened. Drafting does not yet use the item link; CP-34 and CP-43 build on `result`.

Stories: CP-31, CP-08.

## 2026-10-26 — Word and PowerPoint uploads are converted to PDF at upload, not parsed by Docling's own readers

Chose: the knowledge base also accepts Word (DOCX, DOC), PowerPoint (PPTX, PPT), RTF and ODT files. The gateway reads each file's type from its bytes (ZIP entries, OLE stream names, the RTF header; the Content-Type is ignored), sends a non-PDF to a `converter` service (Gotenberg, which runs LibreOffice, in its own container), and from then on handles only the PDF it gets back: S3, labelling, the ingestion pipeline and the chat's citations never see the original. The record keeps the original's type, size and sha256 in `original` so a repeat upload is still refused; its bytes are not kept. The same list applies to standards and past reports. Gotenberg runs with a 120 s limit, a 1 GB memory cap and only its LibreOffice route switched on. A file it cannot read answers 422; a converter that is down, busy or too slow answers 503.

Rejected:
- Docling's DOCX/PPTX readers: they give no page numbers or page boxes, and every stage after parsing needs them (the 10-page batches, the OCR crops of tables, formulas and pictures, column reordering, labelling's page reads, and the chat's page citations in pdf.js). Using them would mean a second pipeline beside the PDF one.
- Accepting everything Gotenberg converts (about 80 types): spreadsheets split across pages, drawings come out with no text, and every extra type is more untrusted input to LibreOffice.
- Images (JPG, PNG, TIFF): standards never come as images, and one image is one page, so a photographed report would arrive as many separate documents. A multi-page TIFF converts correctly but at about 1 s a page. Admins scan to PDF instead.
- Keeping the original file in S3: nothing reads it (retry, the viewer and the local copy all use the PDF); it would only help to convert again with a better converter, which can be added if a conversion fault turns up.
- Converting in the ingestion service: LibreOffice would make that image much larger, and opening untrusted Office files belongs in its own container.

Reason: the page-based pipeline and citations already work for PDFs, and converting first gives every other format all of it unchanged. A separate container keeps LibreOffice away from the services that hold data.

Known limits: Microsoft fonts are not in the image, so LibreOffice uses look-alikes of the same size and a page break can move. A document is only as good as its conversion, and the original is not kept to convert again. Spreadsheets, HTML pages, emails and images are refused for now.

Stories: IN-16, IN-01, IN-07.

## 2026-10-29 — Site walks: proposal first, BullMQ transcription queue in the gateway

Chose: an engineer records a whole site walk (talking, photographing) and the
platform proposes the observations from it, each accepted, changed or dropped
in a review screen before it becomes an observation. Recordings are
transcribed by a BullMQ `transcription` queue in the gateway, which retries a
busy, timed-out or unreachable speech service and marks the recording failed,
with a short reason, only after the last attempt. The ADR "Locations on the
assessment, chosen from a sheet on the capture screen" is partly superseded:
the Observations tab now has a location navigator, a compact list and a page
per observation. Rejected: creating observations straight from the transcript,
which would put unchecked AI text into the record; transcribing in S5 itself
or in the request, which holds a phone connection open for minutes and loses
the work on a restart. Reason: engineers want to walk and talk, not fill in
forms, and the review step keeps a person in charge of what is saved; a queue
in the gateway survives restarts and keeps S5 stateless (it writes nothing to
MongoDB).
Stories: CP-22.

## 2026-11-02 — An engineer manages a client and its sites from the client's page, where every assessment is theirs

Chose:
- A client page, `/clients/<id>` (CP-18), opened from Clients in the side menu, from View client on Group by client and from the client's name on an assessment's Overview. It shows the engineer's own sites at the client and their own visits there, in the work list's columns and with its status and due-date signs, filtered by site name or address, by status, Archived and Removed sites. Group by client now works in the Archived view too, so a client whose visits are all archived can still be opened. Its Rename client and Remove client sit behind the header's ⋯, as an assessment's Archive does, disabled with the reason when they aren't the engineer's.
- Clients (`/clients`) lists the engineer's own clients, one row each with how many sites, open and archived visits, found by name or site. A client whose sites are all removed waits under Removed clients (n), as removed sites wait under Removed sites (n) on its page and archived visits under Archived (n), rather than mixed into the list with a badge. It is drawn from the work list, so it lists exactly the clients whose pages the engineer may open. The page was first reachable only from Group by client and the Overview, to avoid a list repeating Group by client, but it proved hard to find; Clients lists clients, not visits, so it repeats little.
- One rule for every change: a client or site is renamed, corrected, removed or restored only when every assessment it has, archived or not, is the engineer's (assigned to them now, so a reassignment under RV-11 moves the right with it), and none is finalised. Removing also needs every assessment archived. An assessment with no engineer is no one's, so it blocks. Refusals say "another engineer's assessment" without naming whose.
- A colleague's archived assessment blocks too. Archive is mostly for mistakes, but until sign-off (RV-04) sets `finalised`, a colleague may have archived a finished report, and the finalised rule can't protect it yet.
- A finalised report locks its site and client: Section 1 and the headers read the site live, and a signed-off report must keep the details it was signed with.
- One Edit site dialog, opened from the client page and from the Site card on an assessment's Overview alike, so a change follows the same rule and warning wherever it is made; when the site isn't the engineer's to change, the card says why instead. Rename client is on the client page only, where every site and visit it reaches is in view. Edit details is a dialog over the Overview with only the visit's own details (assessment type, site visit date, report due); the create form no longer has an edit mode. Correcting a jurisdiction or facility type asks first, saying how many assessments it changes.
- The create form's Client, and capture's Building, Level and Location, suggest names in the shared Combobox, drawn like Select, instead of the browser's `<datalist>`, whose list and arrow looked unlike the rest of the app.
- The create form opens blank each time, however it was left, instead of keeping what was typed before: a half-filled client and site from an abandoned form read as if they were the next assessment's.
- The side menu's Assessment dashboard reads Assessments, as its page title does, and Usage and costs is Usage and Costs, in the side menu and its page title alike, on request: an exception to sentence case (docs/areas/ui.md).
- A client page's header offers Add site, its one main action as Add observation is the workspace's, beside the ⋯ menu: it opens the create form with the client chosen and Add a new site picked, so a site still comes with its first visit (CP-17). The Clients list has no New assessment of its own, as it would only repeat the work list's without choosing anything.
- The shared Popover keeps itself on screen, moving sideways where its side of the trigger has too little room, as a phone's header has once its actions wrap to the left.
- Each screen opens at the top: the page's one scroll area is reset whenever the screen, workspace tab or client changes, before a screen scrolls itself to where it means to open (the Observations tab back from capture, the document editor on its section). Before, a screen opened wherever the last one had been scrolled to.
- CP-18's controls match their twins on the Observations tab (CP-08): Remove is a danger-tonal button with the discard bin, Restore has the reinstate icon, each names what it acts on for screen readers, edits save with Save changes, and a change is stamped "Edited by Alex Rowe · 02 Nov 2026 14:02". The client page leads back with ← Back to clients, as Photos and Scans lead back to the Observations tab. A site card puts New visit first, then Edit and Remove, as a location's heading puts Add observation first; and a client reads the same in Clients and under its page's title ("4 sites · 5 open · 1 archived").
- Site routes are `/api/sites/:id`, not under a client, so a site saved before CP-17 (no client yet) can still be corrected from its assessment.
- Corrections keep a site's former names and addresses, and a client's former names, and privacy masking sends them after the current one (PV-02, PV-03): notes written with an old name are still masked, and read back as the current name, since a placeholder restores to the first. This also closes a leak from before CP-18, when renaming a site from Edit details left the old name unmasked. Removed sites stay on the chat's masking list.
- A section draft shows as out of date (`changeCounts.scope`) when the site's jurisdiction or facility type differs from what it was drafted with, as `figures` does for Sections 4 and 5; drafts of an unchanged site read exactly as before.
- Removing is soft (`removed: { at, by, withClient }`). A removed site leaves the create form and is read-only until restored. A client is not marked: it counts as removed once it has no listed site, so removing a client removes its listed sites as one batch, and restoring it restores that batch. Typing a removed client's name on the create form finds it again.
- A removed site's name is free, as a colleague can't see the removed site to restore it. Restoring never makes two listed sites of one name: it asks for a new one, and restoring an archived assessment on such a site is refused until the site is restored under a new name. A client's name is all it is, so typing a removed client's name brings it back; a site has details, so a new site of a removed one's name is a second site, which CP-44's merge can join.
- Every change records `edited: { at, by }`, shown on the client page.

Rejected:
- Editing on Group by client: it would crowd the work list, and it only holds the engineer's assessments that pass its filters.
- A Clients and sites list of every client: a colleague's clients and visits are not the engineer's to see; the knowledge admin's view of them is CP-44.
- Knowledge-admin-only editing: the engineer who walked the site knows the right details, and a wrong facility type should be fixed before the next checklist and draft, not when an admin gets to it. Changes a colleague's work depends on go to the admin instead (CP-44).
- Editing a site in two places with two rules (Edit details for a site no one else uses, the client page otherwise): the same change would be allowed, warned about or refused depending on the screen, and every protection would be built twice.
- A separate Remove client flag: it would be a second way to reach "no listed site", with its own restore rules.
- Edit site and Rename client inside Edit details, as first built: one screen then held two kinds of save, a dialog's that changed every assessment at once and Save's that changed only this visit's dates, and one note explaining why Rename was missing sat under Edit site, reading as if the site couldn't be changed.
- Permanently deleting a site: assessments, reports, cost records and masking point to it; soft removal covers the need.
- Moving a site to another client: a sold property's last reports must still name the old owner, so a new owner is a new site; a wrong pick is archived, created again and the stray site removed.
- Flagging OFIs on a scope change: OFIs have no out-of-date tracking yet.

Reason: CP-17's lock kept one assessment from changing another's site, but also stopped an engineer fixing a typo across their own repeat visits, and left a wrong facility type, which drives the checklist's hazards and the standards drafting retrieves, uncorrectable once a site had two visits.

Known limits: a site or client a colleague's assessment uses can't be changed by anyone until CP-44, and an engineer who leaves locks their sites until RV-11 reassigns their assessments. Corrections read live everywhere, the usage report included, so past costs show under the new name; prose already drafted keeps any old name until redrafted. Former names stay masked for good, so a generic old name (e.g. "Main building") is masked in the chat for everyone. The ownership check reads, then writes, with no transaction: a colleague creating a visit at the site in between is not refused. The chat reads its masking list once a minute, so a new name can reach it unmasked for up to a minute after a rename, as a new client's name already can. A site with no client yet can be corrected but not removed, as it has no client page; `migrate:clients` gives it one.

Stories: CP-18, CP-28 (split out on 2026-11-06), CP-17, PV-02, PV-03, RV-10, RV-11, CP-44.

## 2026-11-04 — Marsh's page layout is the document editor restyled as Letter pages; a block that does not fit moves whole to the next page

Chose:
- (RV-12) Page layout, beside Save in the document editor (RV-08), restyles the same TipTap editor as Marsh's pages, so the engineer keeps writing, with undo, find and replace and saving as before, and the pages reflow as they type. The editor is never remounted: switching back and forth only changes a class and turns the layout plugin on or off.
- The page is measured from the two Marsh samples supplied (Office Sample 5 - PRE 2026, Shopping Mall Sample 2 - PRE 2025; both Word exports): US Letter, 2.5 cm side margins, 1 inch top and bottom, header half an inch from the top ("Property Risk Evaluation Report", then the client and site on the right), footer near the foot ("Marsh Advisory / Consulting Solutions", then the page number on the right). Arial 11/13pt text, "Section 7" in 18pt `--report-blue` over the title in 28pt `--report-navy`, subsections 14pt bold blue (`document/page/pages.css`, `geometry.ts`). Marsh's reports are set in Arial, which needs no substitute; the stack falls back to Liberation Sans and Arimo, its metric twins. The review screens' parts inside the pages take Arial too, by redefining `--font-sans` and `--font-serif` under the page view only.
- Pagination (`document/page/paginate.ts`, pure): each block's place with no page breaks is measured (`measure.ts`), and a block that would cross a page's foot gets space above it to start the next page. Rules: each section starts a page, as Marsh's do; a heading stays with what follows; a table splits by rows, its header repeated at the top of the next page; a chart, the Risk Assessment Matrix, the Rating Legend, a photo, and charts set side by side are never split; an OFI record's rows stay together when they fit on one page; each Section 5 loss level starts a page. The space is padding: a ProseMirror decoration on the editor's own blocks, so ProseMirror keeps its DOM, and the element's own style on what React draws inside a locked part, which ProseMirror ignores. Moving a block never changes the others' sizes, so a layout settles on its second measure; lengths are snapped to the browser's 1/64 px, so a long report does not drift.
- The pages around the text are drawn outside the editor (`PageFrame.tsx`): white sheets under it, and over it, from where each page's text ends, the page's blank foot, footer, the grey gap and the next page's header (with a repeated table header under it). The cover, details page and contents sit above the editor, so they cannot be typed into (AC3), and read the assessment from the work list each time they are drawn, so a correction made with CP-18 shows at once.
- Front matter as Marsh's: a navy cover (wordmark, title, address, site, visit date), then the details page (page i: the client bar, Location Surveyed, Address, Surveyed By, Survey Dates, Survey Type, Report Reference), then the contents (ii, iii…), its entries spaced 30pt and 24pt as the samples are. The report's pages are numbered from 1. A missing detail reads "Not entered" (`NOT_ENTERED`, GN-03's words). The logo stays the text wordmark until Marsh supplies the file (`MARSH_LOGO` in `frontMatter.ts`).
- The contents lists each section and one level down: a drafted section's template subsections, or the engineer's own sub-headings written in a section's opening text (sections 1, 2, 3 and A, or one not drafted). Sub-headings inside a template subsection are a level deeper and left out, as Marsh's contents stops at two levels.
- In the pages, Sections 1 and 3 and Appendix A read as the report has them: Section 1's text without the screen's note, Section 3's matrix, OFI records (`OfisInReport`) and charts, and only the photos chosen for the appendix, with their captions. Notes for the engineer (why a section was not drafted) and screen controls in Sections 4 and 5 are hidden; violet AI marking moves into the margin so it does not change the measure.
- Switching keeps the engineer's place (AC1): the document position at the top of the view is noted before switching and scrolled back to the same height once the pages are laid out. The outline and the contents entries open the page a section starts on.

Rejected:
- A read-only paged preview: simpler, but the engineer would switch back to type, and the story asks to correct the report on the page.
- Splitting a paragraph across pages at a line: possible with a spacer inside the paragraph at the first line that does not fit, but caret movement over it and widow and orphan rules make it a story of its own. Blocks move whole instead.
- A paged-editor library: a second editor model beside RV-08's structure guard, review decorations and saving.
- CSS print rules (`@page`, `break-inside`): they paginate only when printing, not on screen.
- Scaling the pages down on narrow screens: transforms make every measurement scaled; the pages keep their printed size and the view scrolls sideways below 1080px.

Known limits: a block taller than a page's text area (a very long paragraph, a row with many photos) runs past the foot and under the footer. Page breaks fall a little earlier than Word's, since paragraphs are not split, so the export's page numbers may differ (EX-01 should decide whether its PDF comes from these pages). Marsh's disclaimer on page i, the cover's site photo, Date Last Surveyed, Site Contacts and Q/A Review By are not drawn: the app records none of them. Section 5's Scenario and Assumptions text sits after the three levels, where RV-08's document has it, not inside each level's page. Laying out runs in the browser only; jsdom lays nothing out, so tests count each section on a page of its own, and the page-break rules are tested on numbers (`paginate.test.ts`).

Stories: RV-12, RV-08, CP-17, CP-18, GN-03, GN-05, GN-07, GN-11, GN-12, EX-01.

## 2026-11-03 — A new assessment can start from the client's documents, read in place, with recorded clients and sites matched in code

Chose:
- New assessment offers two starts on one screen: Fill in the form, or Start from client documents (PDF, Word, Outlook `.msg`, `.eml`, or pasted email text; attachments of an email are read too). The AI fills in the client, every site and every requested visit, quoting where each value came from; a value the documents don't state, or one it isn't sure of, stays empty and is marked Not sure. The engineer corrects it, then creates everything at once, and the documents are kept under the client, listed on its page (a Documents tab). The manual form takes several sites and assessments too, and shows required fields and what each visit type means.
- Read in place, not by a queue. A timing test (3 Nov) put a large pack (12 files, 88,000 characters) at about 15-25 s end to end, so a progress view is enough: no notification, no separate proposal screen, no job to retry.
- Recorded clients and sites are matched in code, after unmasking (`difflib`), not by the classifier. Masked names can't be compared (`[CLIENT_1]` is not "Acme"), and matching in the classifier would need the recorded names sent unmasked.
- `.docx` is read directly by ingestion (`python-docx`); only legacy `.doc` goes through the converter first, to PDF. `.msg` is read with `python-oxmsg` (MIT), not `extract-msg` (GPL-3).
- A recorded site's facility type and jurisdiction are not proposed: its address is masked whole as a known name, which left the classifier nothing to read the country from, and the form uses the recorded values anyway.
- Each decision has its own cutoff, from a sweep on the tuning packs, confirmed on the held-out ones: placement 0.85, facility type, jurisdiction and visit type 0.5. A name matches a recorded one at 0.80 similarity, and from 0.65 up to that it is flagged Not sure for the engineer to decide. The labelling cutoff (0.70) was not reused.
- Model: Claude Sonnet 5.5 at medium effort, with Jev choosing from the fixed lists. Evaluation on the held-out packs (12, masked as in production, Jev picks):

  | Model | Fields right | Mean time per pack | Cost per pack |
  | --- | --- | --- | --- |
  | Sonnet 5.5 | 100% | 7.7 s | $0.015 |
  | Opus 5.5 | 100% | 12.1 s | $0.038 |
  | GPT-6.1 Sol | 100% | 12.5 s | $0.012 |

  All three read every field right, so Sonnet is chosen for speed (the read happens while the engineer waits); Sol is a little cheaper but about 60% slower. Two general fixes came from mistakes first seen on held-out packs: tidying the edges of names spaCy detects (a span ran over a line break into a form label), and a site at an address with a different street number never matching a like-named recorded site. Both were also run on the tuning packs, but held-out is no longer fully unseen for those two rules. Document placement: 91% of Jev's picks right on held-out; at the 0.85 cutoff every kept placement was right and about a quarter of documents went to the whole client, marked Not sure. Jev against Sonnet picking the same values (held-out): facility type 100% vs 91%, placement 88% vs 94%; the LLM gives no confidence, so it can't mark a placement Not sure, and it added 2 s and $0.005 a pack. Jev stays.
- The engineer is the signed-in user; there is no picker, so an engineer can't assign work to a colleague. Admins assign under RV-11.
- Visit types become First survey, Resurvey and Follow-up visit, checked by the server; a site with no earlier assessment can only start with a First survey (AC17). `npm --prefix server run migrate:visit-types` converts older assessments.
- `client_intakes` (temporary, 24 hours, cleaned daily) and `client_documents` (kept) are new collections; their null metadata is a documented exception (docs/areas/database.md).
- Privacy: the intake sends privacy-service `detect: ["CLIENT", "SITE"]` so a client not yet recorded is masked too, with a never-mask list (Marsh, FM Global, NFPA and similar) and tidied spans. Masking has its own 60 s timeout. See docs/areas/privacy.md.
- ingestion-service loads its OCR model when it starts (`PRELOAD_OCR=0` skips it), so the first scan after a restart doesn't wait about 45 s.

Rejected:
- A background job with a notification, as a site walk's proposal is: the wait is short, so a job and a place to find its result aren't needed.
- Matching by the classifier or the LLM: it can't compare masked names, and an unmasked match would send recorded client names out.
- Converting `.docx` to PDF first: it adds a converter call and a PDF step for a format `python-docx` reads directly (tables included).
- `extract-msg`: GPL-3 would put the licence on the service.
- Proposing a recorded site's facility type and jurisdiction: see above.
- One cutoff for every decision, or reusing 0.70: the decisions differ in how often the classifier is right (placement is the hardest), and a single value would either empty easy fields or keep wrong placements.
- Opus 5.5 and GPT-6.1 Sol: no better on accuracy, and slower; Opus cost about 2.7 times as much.
- An engineer picker on the create form: it let anyone assign work to a colleague.

Reason: a client's request email, engagement letter and site plans already hold the client, sites and visits, and typing them again for each assessment is slow and error-prone. Reading them in place with quotes keeps the engineer in charge: every value can be checked against its source, and the AI says Not sure rather than guess.

Known limits: some names are still readable after masking. On the 24 synthetic packs (3 Nov 2026): 1 of 22 client names, 0 of 31 new site names, 2 of 48 contact names and 0 of 31 addresses (after adding patterns for building names and street addresses; before them, 11 site names and street names leaked). Recorded names are always masked. The model is Sonnet 5.5 on `LLM_PROVIDER`; changing it means re-running the evaluation. Visit type meanings are ours, to be confirmed with Marsh. Adding documents to an existing client later is CP-40.

Stories: CP-23, CP-17, CP-18, PV-02, CP-40, RV-11.

## 2026-11-01 — Photo reading blurs faces and masks text before Gemini; the copy sent is kept beside the original

Chose:
- (PV-04) With `PII_PROTECTION=required`, observation reading (CP-05, CP-21) sends Gemini only blurred photos and masked text. The gateway sends `privacyFor(reference)` with each reading, as drafting does.
- Faces are blurred in privacy-service, `POST /redact-image` (a JSON batch of base64 images, one call per reading), not in S5, so ingestion's picture crops can use it too (PV-06). YuNet (OpenCV's face detector, about 230 KB, MIT) is kept in the repo, so neither the image build nor the tests download it. A face, padded by 40%, is pixelated to 3×3 blocks and blurred: at 5 or more blocks the detector still found the face it had blurred. Faces are looked for on a copy at most 960 px long (about 100 ms per 1600 px photo instead of 210 ms); one under about 17 px in the photo is missed, and is too small to recognise.
- The note, every recording and page transcript, and the location are masked in one `/mask` call. Item labels are not: they are what the proposal cites and the gateway matches.
- Unmask before the gateway's checks: the description, each reason and each quote come back with real values. `[LITERAL_n]` escaping and the fail-closed wording are rag-service's, so engineers read one message everywhere.
- The vision prompt tells the model to copy placeholders exactly (`cp21-v4`), with protection off too.
- The photo as sent is kept. S5 returns each photo as Gemini received it, still storing nothing itself. For a photo with a face blurred, the gateway stores it as `<photo key>.redacted.jpg` beside the original, which is never changed, and the photo popup can switch to it ("As sent to AI · 2 faces blurred"). A photo without a face records only that it was checked. Failing to store the copy doesn't fail the reading.
- Handwritten pages (CP-19) stay unprotected. The model must read the page, so it can't be masked first. The risk is mostly in a combination of details, and the goal is not to store PII in the database. Scan mode asks the engineer to leave names, phone numbers and ID numbers off the page, and the transcript is masked like any text when it feeds drafting or chat.

Reason: photo reading sends client photos and the engineer's notes to Google. Blurring and masking before the call keeps people and named details out of what leaves. Keeping the copy lets the engineer check what was actually sent.

Rejected:
- Blurring in S5: ingestion needs the same detector for picture crops (PV-06), and one service keeps one model.
- Overwriting the S3 original with the blurred photo: the original is the engineer's evidence, and the epic requires it unchanged.
- Tesseract redaction of text inside photos: 1–3 s per photo, against a budget of about 1 s for the whole reading. Left as a known gap.
- Refusing handwriting transcription under protection: it would remove CP-19 for every protected assessment, for a risk the capture hint mostly avoids.

Open: whether site photos and notes may go to Google at all (G3) is still with Marsh. Blurring and masking may be enough for them.

Stories: PV-04, PV-01, PV-02, CP-05, CP-21, CP-19.

## 2026-11-02 — Photo reading's answer is checked for details the AI added

Chose:
- (PV-04) Text inside a photo is never masked, so Gemini may write a name or number it read off a sign into its answer, and that would be saved. With protection on, S5 checks the description and each category's reason before unmasking: one more `/mask` call with the reading's mapping. What the reading sent is a placeholder by then, so whatever is found is new, and is replaced by its kind ("[name removed]"). Known clients, sites and people are kept. Quotes are not checked, since they are copied from masked items.
- On by default, and switchable in the backend: `PII_CHECK_ANSWERS=on|off` on the gateway, sent to S5 as `privacy.check_answers` (Rule 1: S5 reads no env var for it). A typo stops the gateway starting, as for `PII_PROTECTION`.
- If privacy-service fails at the check, the reading fails and nothing is saved. Gemini has already answered by then, so the message says the answer couldn't be checked rather than that nothing was sent.
- Provenance counts the details taken out (`removedFromAnswer`), never which.

Reason: the goal is not to store PII in the database. The check is local and cheap, and catches what face blurring and text masking can't reach until text in photos is redacted.

Rejected:
- Telling the model not to write personal details: the prompt can be ignored, and the output still needs checking.
- Keeping the removed values for the engineer to restore: that would store the PII the check exists to keep out.

Known limits: street addresses are not detected, only a postal code after "Singapore". A second `/mask` call per reading bends Rule 2 (one call per request); it adds nothing to the mapping.

Stories: PV-04.

## 2026-11-05 — privacy-service detects street addresses and vehicle plates; detectors.json switches each kind

Chose:
- (PV-04) A Singapore street address pattern: a house or block number, a capitalised street name and a street word (or a Jalan or Lorong), then any unit number. A road without a house number, or a street word without a name ("2 St."), is not an address. The postal code stays its own `POSTAL`.
- A vehicle plate pattern, kept only when its last letter is the check letter (the last two prefix letters and the digits, weighted 9 4 5 4 3 2, mod 19), so model and part codes stay. Placeholder type `VEHICLE`, added to the unmask copies in rag-service and S5.
- `detectors.json` in privacy-service switches each kind (`PERSON`, `PHONE`, `EMAIL`, `NRIC`, `UEN`, `POSTAL`, `ADDRESS`, `VEHICLE`) on or off. `PII_PROTECTION` stays the master switch in the gateway. Known names are always masked. Read at startup; a typo stops the service; a missing file means all on. Compose mounts it, so a change needs a restart, not a rebuild.

Reason: a reading saved a street address read off a photo, which the answer check couldn't catch. A file lets the team switch a kind off (a pattern masking too much) without a code change, while the gateway alone decides whether to protect (Rule 1).

Rejected:
- Turning on spaCy's places and organisations for addresses: they also catch brands, standards and floors (PV-01).
- A plate pattern without the check letter: it would mask model codes in drafts.
- Per-flow switches in the file: one definition of what counts as personal, for now.
- An admin screen for the switches: needs a settings store; the file is enough until someone other than the developers changes it.

Known limits: the file applies to every flow, so switching a kind off affects drafting and chat too. Building names alone are not detected. Masking now changes for drafting and chat, so the drafting and chat evals need a rerun with `--privacy` (Rule 9).

Stories: PV-04, PV-01.

## 2026-11-04 — The export is the page layout, printed: the browser lays out the pages, the gateway prints them with headless Chromium

Chose:
- (EX-01) The PDF comes from Marsh's page layout itself (RV-12), as AC3 asks: the Export tab draws the report off screen with the document editor's own schema, pagination and pages (`document/export/ExportPages.tsx`), read-only and without the review screen's marks (AC10): no review plugins, so no violet AI styling, flags or deleted-citation badges; no notices; citation numbers only. Once every part has loaded and nothing has changed for four checks 300 ms apart, `snapshot.ts` turns the pages into one HTML document: the cover, details page and contents as drawn, and the report cut into Letter pages exactly where the layout breaks it. Each block of the report keeps the page `paginate` gave it and sits where it sat on that page; a table carried onto a page starts with its header again (the layout's repeated header), a split numbered list goes on counting, and a split table keeps its column widths. Each page gets the header and footer its band draws.
- The gateway prints those pages with headless Chromium (playwright-core), the user's choice over a separate export service. The HTML comes from the browser, so it is opened with no way out: page scripts off, a content security policy allowing only inline styles and data: images and fonts, and every request refused (`export-render.service.ts`). Chromium embeds the fonts (Arial, or Liberation Sans in the server image, its metric twin), keeps backgrounds, makes the headings bookmarks and the contents entries links (AC3, AC4). One Chromium per export, closed after it, at most two at once. Chromium is `CHROMIUM_PATH` (the server image installs Alpine's), else an installed Chrome, else Playwright's.
- The Word file is read off the same pages, so both formats hold the same text (AC6, AC7): `export-extract.ts` runs in the page and returns the blocks (sections, headings, runs with their bold, italic, underline, superscript and colour, Word lists, tables with each cell's fill, pictures, page breaks), joining a table or list split across pages by the `data-x` name the snapshot gives its parts. Charts and legends are pictured at twice their size; photos keep the bytes the export embedded. `export-docx.ts` writes it with `docx`: the navy cover (a page-sized navy picture behind white text), the details page and a Word table of contents numbered i, ii, the report from 1, Marsh's header and footer with a PAGE field, each section a Heading 1 ("Section 7", a line break, "Construction") from a new page, subsections Heading 2, other headings Heading 3. Its contents is a TOC field (`\h \o "1-2"`) holding the page layout's entries until Word refreshes it; it is marked for refreshing, so Word may ask to update fields when it opens.
- Citations (AC6): markers keep the numbers each section already gives them (`plugins.ts citationNumbers`), and References, a part after the report (after Appendix A, so no earlier page moves), list each section's numbers: a standard by title, edition, heading trail and page; an observation by location and capture date (`capturedAt`, now on the review workspace's observations); a past Marsh report by facility type and year only (`facilityType`, now on its passage's document); a section of this report by its title. Without citations no marker is left. Page layout now draws markers as the PDF prints them, plain superscripts, so its line breaks are the export's.
- Section 6's programs are Marsh's two tables in the page layout and the export (AC7): a `programs` locked part in the Management Programs subsection draws `MaturityTable` from the rows written there, live, and the page layout hides the rows it shows (`page/programs.ts`); the continuous view keeps editing them as paragraphs. The subsection schema allows that part before its text.
- The export check (AC1) is the minimal one until RV-04 (`exportBlockers`): every drafted finding decided, none unsupported, no withdrawn source cited, each blocker named by section, on the tab and as the 409 body. (Widened 2026-11-05: the report must also be written in full.) Pending edits are saved first through a registry (`pendingSaves.ts`) that the document editor and Appendix A's queue join; one that fails stops the export.
- Only the assigned engineer exports, with a new `reports:export` permission (risk engineers, F-05). An archived report can be exported again. A masking placeholder left in the text (`[PERSON_2]`, `client_1`, `[PHONE 3]`) stops the export with where it is (422, AC9). Photos go in at 300 dpi of their printed size, never above the original's own resolution, in Appendix A's order (AC8). The file is `<reference> <YYYY-MM-DD>.<pdf|docx>`, the day in `REPORT_TIME_ZONE` (Asia/Singapore). Nothing is stored.
- The sample assessment shown without the gateway says it cannot be exported and simulates nothing (AC11); its Standards index option, which did nothing, is gone.

Rejected:
- Laying out the PDF on the gateway (pdfkit, or the docx converted by Gotenberg): its pages would not be the page layout's, which AC3 asks for.
- Printing the browser's page with `window.print()`: a print dialog, not a download, with no API to refuse (AC2).
- Rasterising the pages in the browser (html2canvas): no text to select or search, no embedded fonts, no links.
- Printing the page layout's one continuous sheet and letting Chromium break it: Chromium would move a block whose space crosses a page edge, and every page after it would shift. Each page is cut out instead, so Chromium never breaks one.
- Gotenberg's Chromium route, already in Compose: it is off on purpose (it fetches any URL), and the Word file needs the page read and pictured, which its routes do not do.
- Chart pictures drawn in the browser (SVG to canvas): the charts' colours are CSS variables, which a standalone SVG loses; Chromium pictures them as drawn.
- Word's hidden text for "7. " in the heading, to make the contents read "7. Construction": Word leaves hidden text out of the contents.

Known limits: a block taller than a page still runs past its foot (RV-12), and is cut off at the page's edge in the PDF. Word paginates on its own, so its page numbers can differ from the PDF's; its contents shows the page layout's until refreshed. Bookmarks name a section by its title, without its number. The export waits for the off-screen pages to settle, so a report with many photos takes a few seconds before the gateway is asked. The minimal check does not cover RV-04's mandatory sections, unresolved citation targets, overrides or second-layer review.

Stories: EX-01, RV-12, RV-04, F-05, GN-03, GN-07, GN-11, GN-12, CP-04, PV-02.

## 2026-11-05 — Only a complete report is exported: every section written, every finding reviewed

Chose:
- (EX-01 AC1) Until RV-04 builds its full check, `exportBlockers` (`export.service.ts`) lets a report go only once it is complete, as the team decided: Section 2's Executive Summary drafted and not out of date; at least one accepted OFI (Section 3); Sections 4-12 each drafted, or written in the document editor; Sections 4 and 5 with every figure entered; and in each draft no new draft waiting, every finding decided, none unsupported, none citing a withdrawn source, and nothing changed since it was drafted (evidence, figures or the site's scope). The 4 Nov check covered only the review half.
- Each item names its section, in report order, and where it is finished (`where`: Generation or the review workspace), so the Export tab opens the right tab from it. `GET /api/assessments/:reference/export` returns them as `blockers`; the POST checks again and answers 409 with them. The export stays greyed out with the reason until the list is empty (design system v2).
- Section 2's own statements are not checked for support: they cannot be decided in the review workspace, so a flag there could never clear.

Rejected:
- Exporting as it stands with the open items only as a warning (tried earlier the same day): the team wants an unfinished report kept in the tool.
- Requiring every template subsection to have text: a draft covers only the subsections its evidence supports.
- An override with a justification (RV-04 AC9-AC11): left to RV-04, which also adds its audit trail.

Known limits: OFI suggestions left unaccepted do not block. RV-04 is still to add citation targets, high-severity findings, overrides and second-layer review.

Stories: EX-01, RV-04.

## 2026-11-05 — Comment threads are kept apart from the text, anchored by its words

Chose:
- (RV-03) A comment thread is a document of its own in `report_comment_threads`, never part of a section's text. A comment adds no version to `report_section_versions` and changes no review state, so a knowledge admin, who cannot change the text, still comments (AC7), and the export (EX-01), laid out by an editor with no comment marks, never shows one (AC9).
- A thread is anchored by text, not by an editor position: its offsets in the section's text as the document editor saves it (each paragraph, sub-heading and list item, one per line, a citation marker as one character), the passage itself and up to 32 characters either side, as the W3C Web Annotation quote and position selectors do. Opening the editor finds each thread at its offsets; else where the same words stand with the most matching text around them; else, when its words changed, between the text either side; else it is listed as having lost its text. So a thread survives what changes the text outside the editor: a finding edited or rejected in review, a redraft, a restore (RV-06).
- In the editor each thread's passage carries a mark naming it. The mark moves with the words as they are edited, stays on what remains (AC6) and comes back on undo; it is placed outside the undo history, is not a change to save, is never taken from pasted HTML, and `inlineOf` merges the text runs it splits, so the saved text is the same with or without comments. After each save the editor sends where its threads now are (`PUT …/comments/anchors`); a thread whose text was deleted entirely is `detached` and keeps quoting it.
- Who can comment is who can open the assessment, as the work list has it: its assigned engineer and every knowledge admin (`opensAssessment`), with the new `reports:comment` permission for both roles (F-05). The Review tab now needs `reports:comment` rather than `reports:generate`, so a knowledge admin reads the review workspace and opens the document read only ("Open document"); every decision still needs `reports:generate` and the assigned engineer.
- No @mentions and no notifications from comments: AC4 was taken out of the story the same day, with the comments list's "mentioning me" filter. A colleague sees a new thread in the margin and the comments list when they next open the document.
- Each comment is changed or deleted only by its author. A deleted reply goes; a deleted first comment that others reply to reads "Comment deleted"; a thread left with no comment goes too. Resolve and reopen are open to anyone who can comment, as in Google Docs.
- Threads are read again when the window regains focus, not on a timer: a timer would keep an idle session signed in (F-07).

Rejected:
- Comment marks saved in the section's text, as some editors do: every comment would add a version and could change a finding's review state, a knowledge admin could not comment without a text save, and the export would have to strip them.
- Anchoring by editor position alone: positions mean nothing once the text changes outside the editor.
- Real-time sync between two open editors (Google Docs' live comments): out of scope; a colleague's new thread shows once the window regains focus.
- @mentions with notifications (AC4 as first written, built and then removed at Josiah's request): a comment names no one, so it needs no list of colleagues and sends nothing to the bell.

Known limits: a thread is on text only, not on a table, figure or photo filled in elsewhere. Where the window is too narrow for the margin beside the page, threads open in the comments list's place. A thread whose words changed beyond recognition outside the editor is listed with its quote rather than placed.

Stories: RV-03, RV-08, F-05, EX-01.

## 2026-11-06 — CP-18's editing becomes its own story, CP-28

Chose: CP-28 (correct a client's and site's details) is split out of CP-18, which keeps viewing, removing and restoring. Nothing about the app changes: both stories were built and merged as CP-18, and the decisions of 2026-11-02 stand. Points divide 8 (CP-18) and 5 (CP-28), still 13 between them.

- CP-18 keeps AC1-AC6 as they were. Old AC12-AC14 are now AC7-AC9, old AC16-AC18 are AC10-AC12, the removing half of old AC19 and AC20 is AC13 and AC14, and old AC21 is AC15.
- CP-28 takes old AC7-AC11 as AC1-AC5, old AC15 as AC6, the changing half of old AC19 and AC20 as AC7 and AC8, and old AC22 as AC9. Old AC15 refuses a change to something removed, so it goes with changing; CP-28 depends on CP-18 for that and for the client page its dialogs open from.
- Edit details goes to CP-28 with the other edits, though it changes only the visit's own details and not its site or client.
- The one ownership rule stays one rule, in one place in the code; each story's ACs state the part that applies to it.
- RV-12 now depends on CP-28 rather than CP-18, as its cover reads corrected details, and CP-44 depends on both.

Rejected:
- Moving removing and restoring to CP-28 as well: they are not edits, and CP-18 would be left only viewing.
- Relabelling CP-18 in code comments and test names: they keep saying CP-18 for this work, as code still says CP-06 for what merged into CP-08, so read them with the mapping above. It would touch many merged files for no change in behaviour.

Reason: at 22 ACs and 13 points, CP-18 held two jobs, seeing and clearing away a client's sites and correcting their details, which can be planned and accepted separately.

Stories: CP-18, CP-28, RV-12, CP-44.

## 2026-11-05 — Admins hold the engineer's powers, and may assign assessments; the Inbox holds what needs a person

Chose:
- (F-10, RV-11) `knowledge_admin` gains `assessments:edit` and `reports:generate`, and a new `assessments:assign` belongs to `knowledge_admin` only. An admin can do everything an engineer can under Assessments and Clients, including Generation, Review and Export, on the same screens. `reports:export` (EX-01, 4 Nov) belongs to `knowledge_admin` too, for the same reason; only the assigned engineer can export.
- This reverses the 30 Sep F-05 decision that rejected a wildcard admin and kept admins read-only on assessments. The "only the assigned engineer can change it" checks stay, so an admin changes only assessments assigned to them and reads the rest. Routes that had no such check because only engineers could reach them (starting capture, adding and removing locations, retrying a transcription, reading an observation, filing and deleting client documents) now have one.
- An admin chooses the engineer when creating an assessment (required, any active account including themselves), and can reassign one later (`POST /api/assessments/:reference/reassign`; archived ones are refused). Engineers still get themselves. Observations, drafts and costs follow the assessment. After a reassignment the new engineer carries on its observations, locations and site walks, and the old one is refused.
- The Inbox holds what stalls work if the person ignores it; the bell holds updates. Inbox items stay in the `notifications` collection with a `kind` set at creation from one lookup in the notification service, so the ingestion worker does not change. To do and Done are worked out per person, not stored.

Reason: nobody on the team could state the motivation for the F-05 limit, and an admin should not be able to do less than an engineer; a person can only hand work over if an admin can do it. A second collection for the Inbox would rebuild audiences, per-user state, polling and the worker's route.

Rejected:
- A second collection for Inbox items.
- A stored status for each item: it differs per person for the items shared by all admins.
- Closing a shared item automatically when it is filled: Jesper chose not to track whether work was done, so Omar still sees a request Sana filled in To do until he opens or bins it.
- Engineers choosing another engineer, or asking for a handover in the app.

- Round 2 (6 Nov, replaced by round 3): tick and untick change the item for everyone, open and bin change only your list. Counts are checked every 10 seconds, and any change reloads the open Inbox or Assessments list. A sound plays only for an item newer than anything this person has seen, compared by the newest item's time from the count route, so an item coming back by an untick stays silent.

- Round 3 (6 Nov): tick and untick are personal too, so every Inbox action changes only your own list. `markDone` adds you to `readBy` and `unmarkDone` removes only you; `doneAt`, `doneBy` and the DTO's `shared` are gone. Reason: a tick that moved an item for everyone hid work from an admin who had not seen it, and "Done" should mean done by me. A shared item therefore stays in the other admins' To do until each presses it. Pressing a request or document row first reads that item (`GET /api/knowledge-gaps/:id`, `GET /api/knowledge-documents/:id`) to tell if someone already handled it; knowledge documents record who last handled them in `handled`, written by correct, decide, retry and cancel.

Rejected in round 2:
- Server push (SSE): instant, but a new endpoint, Redis signals, an nginx rule on EC2 and reconnect handling, for a list of 0 to 20 items. It can be added later without changing the screens.
- Webhooks: a browser has no address a server can call.

Known limits: a third person's Engineer column updates on their next visit, because their counts don't change; a visible list reloading on a colleague's change refreshes the session, as the Inbox's did; a notification's `reportDue` is a snapshot from creation; an Inbox item expires with the rest after 90 days, though the thing it points at still exists.

Stories: F-10, RV-11, F-05.

## 2026-11-05 — Past reports are redacted before parsing; rag puts their words back from a mapping in MongoDB

Chose:
- (PV-05) With `PII_PROTECTION=required`, a past report's PDF is redacted before parsing, so parsing, chunking, the table and formula OCR crops, embedding and Chroma all read tags. Standards are public and are not redacted. The S3 original is unchanged.
- The redactor rewrites each page that holds a detail: all its text is removed and drawn again in its order and place, with the tags in, in Liberation Sans (bold and italic kept) or a CJK font, each run squeezed to its old width. Docling orders a paragraph's text as it is drawn; drawing only the tags put them at the paragraph's end (found with real Docling). Liberation Sans is the font LibreOffice converts Word reports in, bundled with ingestion (SIL OFL 1.1): redrawn in Helvetica, Docling's layout model took a cover page's lines for pictures and dropped them (found in manual QA).
- Labelling masks the first pages' text, not a redacted PDF: it sends only text, and this also covers scanned pages, whose text is read locally. The epic's design B had it run `redact_pdf` first.
- The mapping (tag to detail) is saved on `knowledge_documents.privacyMapping`, `select: false`, never returned by any API. rag-service reads it from MongoDB on every search (one query), puts the real words back before rerank and masking, and adds the values to the request's known names, so another client's name is tagged again even when the assessment doesn't list it.
- The worker asks the gateway how to protect each document (`GET /api/internal/knowledge-documents/:id/privacy`, service key), with chat's list of every client, site, address and active user. No `detect`: on a sample report it tagged 171 section headings and building terms as clients and sites.
- What privacy-service never masks moved from code to `allow_list.json` (words, word patterns, whole names), mounted and read at startup like `detectors.json`, with the false positives found on a sample report added (floor codes, report wording, Marsh's businesses).
- Reports already indexed are not re-ingested in PV-05; every document will be re-run later.

Reason: past reports are stored in Chroma Cloud and read by several outside APIs at ingestion, and they name other clients and their people. Redacting the PDF once covers every downstream reader, including the OCR crops, which are pictures of the page.

Rejected:
- Masking only the chunk text after parsing: the OCR crops are images rendered from the PDF, and would still show names.
- Keeping the mapping in Chroma metadata: Chroma Cloud is an outside service.
- An internal gateway route that returns mappings to rag: a mapping would then travel over HTTP; a read-only MongoDB query keeps it in place.
- Putting the protection settings in the queued job: names would sit in Redis, and a retry would reuse stale ones.
- Keeping the redacted PDF: its passages in Chroma already show what was sent.

Known limits: scanned pages and pictures' faces wait for PV-06. A PDF made in fonts other than Liberation Sans shows Liberation Sans on its redacted pages. A false positive in a mapping is masked in later requests too, so `allow_list.json` matters more. The IN-07 comparison shows tags. Redaction measured 0.75 to 1.2 s a page on a busy laptop, against a target under 1 s; measure on EC2.

Stories: PV-05, PV-01, PV-02, PV-03, IN-05, IN-07.

## 2026-11-07 — Site walk uploads are converted on arrival, and removal waits on the device

Chose: the gateway turns any accepted photo into a JPEG and any recording Whisper can't read into `.m4a` when it arrives, using `sharp`, `heic-convert` and `ffmpeg-static`. Removing a photo, recording or note hides it at once and deletes it after a 10 second Undo, or at once on Finish or on leaving the screen.

Reason: everything stored stays in a format the viewer, photo reading and report export already handle, so nothing downstream changes. Waiting on the device needs no new stored state, and a removed item is never left half in a proposal; if the tab closes first, the item simply stays.

Rejected:
- Storing the original format and converting when read: every reader would need to handle it.
- A `removed` flag on the walk: every reader of a walk's recordings and photos would have to check it.
- Raising the 100 MB upload limit for a long uncompressed WAV: it needs a change to EC2's nginx.

Stories: CP-22.

## 2026-11-07 — Scanned pages are redacted with RapidOCR; picture crops are blurred; passage text is masked again before embedding

Chose:
- (PV-06) With `PII_PROTECTION=required`, a past report's scanned pages are redacted before parsing too. A page with no text layer but an image is read with RapidOCR's word boxes; its words join the document's one `/mask` call; each detail's words are blanked in the page image (not only covered), padded by 15% of the word's height but never into a word that stays, and its tag is drawn in their place.
- RapidOCR, not Tesseract as the epic planned: it is already installed (`docling[rapidocr]`, 3.9.2, with `return_word_box`), it is the engine Docling reads the redacted page with, and it needs no apt package or Windows binary.
- Faces in picture and table crops are blurred in `parse_picture` and `parse_table`, not `recognise()` as the epic planned: `recognise()` also serves formulas, which need no blurring. Table crops are blurred too because, on a scanned page, a region Docling calls a table can take in a photo beside it (found on a real scan). privacy-service's `/redact-image` (PV-04) does the blurring; a blurred crop comes back as JPEG and is turned into PNG, which the OCR providers send.
- The post-chunk `anonymise` stage is the safety net: a redacted report's passage text goes through `/mask` again, not escaped (its tags are its own), continuing the document's mapping, which is saved whole in `privacyMapping`.
- Everything fails closed, as redaction does.

Reason: PV-05 left a scanned page readable, sent picture and table crops with faces to the OCR model, and embedded whatever the OCR model read off a picture.

Rejected:
- Tesseract: an extra system package for word boxes RapidOCR already gives.
- Covering a scanned word with a box only: the pixels stay in the image, and the OCR crops are cut from it.
- Escaping the text at the safety net, as `Session.mask` does: the redaction's real `[PERSON_1]` would become a literal and never be restored.
- Masking text inside pictures before the OCR call: it needs OCR of every crop first; the safety net catches what the model writes instead.

Known limits: RapidOCR took 5 to 8 s on a dense scanned page on a laptop (the epic expected 1 to 2 s), and Docling reads the page again; measure on EC2. A full-page photo is read as a scanned page. A name RapidOCR misreads is not matched. Text inside a picture still reaches the OCR model.

Stories: PV-06, PV-05, PV-04.

## 2026-11-11 — Saved handwritten pages are managed as recordings are: corrected beside the model's text, added later, removed softly

Chose:
- (CP-20) A finished page's text is corrected as a recording's transcript is (CP-08): `transcription.correction { text, at, by }` beside the model's `transcript`, which stays as evidence of what was read; drafting and the AI proposal use the correction, and writing the model's words back removes it. One route and service function (`correctTranscript`, now taking `'recordings' | 'pages'`) serves both.
- A page the model found no handwriting on can be corrected too, so the engineer can write what it missed.
- The uncertain marks stay on the model's text only. They are `[start, end)` positions in `transcript`, so they no longer fit once the text is edited; the corrected page shows the engineer's text plainly, as theirs (no AI rule), with the transcription and its marks folded away under "As transcribed".
- Transcribing a corrected page again drops the correction with the old text, after the browser asks. Asking for a new reading means wanting the model's; keeping the correction would leave Transcribe again appearing to do nothing.
- Pages are added through the same `POST /:id/media` as recordings and photos, marked `added`, and transcribed as at capture. Removing and restoring a page is the same soft removal (`removed { at, by }`), over the same routes (`MEDIA_KINDS`). Everything that counted every page now counts kept pages: what stays captured, what a reading reads, and what drafting waits for.
- A removed page can't be corrected, retried or transcribed again until it is restored, as for a recording.
- In the demo (no capture session), a page can be added, removed and restored, and its text written by hand, in that browser only, as CP-08's sample changes are; a removed demo page keeps itself in `removedMedia`, so restoring it brings back its text.

Reason: CP-19 left pages fixed once saved, so a misread word, a forgotten page or a wrong page meant a new observation or living with it, and the uncertain marks it shows were meant for the engineer to act on. Reusing CP-08's model keeps one way to change evidence for engineers and for the code.

Rejected:
- Moving the uncertain marks onto the corrected text: tracking each word through arbitrary edits is unreliable, and a mark on the wrong word misleads.
- Keeping the correction when a page is transcribed again, or refusing to transcribe a corrected page: the first makes the action look broken, the second adds a step for no gain.
- Hiding the new actions on sample observations: the demo is used to show the product without a gateway.

Known limits: page transcription still runs in the gateway's memory, not on the BullMQ queue recordings use (CP-22), so a restart marks a running page failed, to retry; pages added later make that a little more likely. Pages still go to the model as photographed (see privacy.md). The browser asks before transcribing a corrected page again, but the gateway does not: a direct API call drops the correction without asking.

Stories: CP-20, CP-19, CP-08, CP-21.

## 2026-11-11 — The engineer customises the checklist on its tab; edits survive regeneration; references come from a keyword search; the field copy is an A4 PDF

Chose:
- (CP-32) The assigned engineer adds, edits, removes and restores items on the Checklist tab only. The sheet opened from capture stays for answering, so a phone on site shows no edit controls.
- What can be edited: what to check, the COPE categories (one or more, so an answer is categorised) and the references. An added item goes where the engineer chooses: a priority risk, or a report section and optionally one of its template subsections.
- Removing is soft (`status: 'removed'`, `removed { at, by }`), with Undo in the toast and Restore in a folded "Removed items" list. A report template subsection can't be removed (the report has it), nor a priority risk's last item (CP-30 guarantees each risk one), nor an item an observation answers (its answer would be hidden): each shows a greyed bin with the reason, and the first two are marked Not applicable instead. Marsh's report keeps every subsection, and Not applicable records the engineer's judgement where a removal would hide it.
- A generated item keeps how it was generated (`edited.was`) on its first edit. Regenerating matches against that, by CP-31's rules, so the model's rewording finds the engineer's item; the match takes the engineer's wording and references. The engineer's own items, and edited items nothing matches, are copied as they are, with their answers. Removed items that match come back removed.
- References: a passage of the checklist's standards (that still apply), with the words the engineer selects, else its first sentence. The gateway fetches the passage from S4 itself, checks the quote as S4 checks the model's, and keeps the passage in the checklist's `sources`.
- The search is S4's `POST /passages/search`: BM25 keyword ranking over the chosen documents' passages, read from Chroma and cached for 10 minutes. No embedding or other paid call, and the words never leave our services, so the engineer's text needs no masking. It starts from the item's own words.
- The field copy is an A4 PDF (engineers print on A4), built by the gateway from the saved checklist and printed by the export's Chromium with every request refused. Every item still on the checklist, numbered, with its answer, or boxes to tick and lines to write on, and each reference's title, edition, page and quoted words. Anyone who can view the assessment can download it.
- CP-32 re-estimated from 3 to 5 points for the passage search and the PDF.

Reason: the checklist should match the inspection the engineer plans, without losing that work when the site changes and the checklist is regenerated. Keeping edits by matching what the model generated, not what the engineer wrote, survives the model rewording every run. A PDF reads the same with no signal on site, and the export already prints with Chromium.

Rejected:
- Semantic search for references: it embeds the engineer's words with Cohere, so the query would need masking (an engineer may type a client name) and a paid call per search. Keyword search ranks the item's own words well enough to start, and is free.
- Searching from the gateway: the passages are only in S4's Chroma index.
- Removing template subsections: Marsh's report has every one; Not applicable says the same and keeps the record.
- Deleting a removed item outright: it couldn't be undone, and the next generation would bring it back.
- Hiding the bin on items that can't be removed: the design system greys out and explains a blocked action.
- An HTML or Word field copy: the PDF prints the same everywhere and needs no app to open.
- Editing from the capture sheet: planning happens before the visit, and the sheet should stay quick to answer from.

Known limits: a removed or edited model-written item that comes back resting on different passages, or under another section, is not matched: an edited one is kept beside the new one, a removed one comes back. The keyword search finds the words given, not their synonyms ("sprinkler" finds "sprinklers" but not "automatic suppression"); its cache holds a re-ingested standard's old passages for up to 10 minutes. On a phone, selecting words in a passage is fiddly; the first sentence is quoted without one. Answers written on the PDF are entered in the app by hand.

Stories: CP-32, CP-30, CP-31, CP-34.

## 2026-11-09 — Asking about an assessment runs through the orchestrator, checks each line before it is shown, and is saved with its trace

Chose:
- (AS-01) A question asked in the review workspace's Ask tab runs as `orchestrator.ask` in S4: retrieve, assemble, generate, guardrail, in one function, so one run leaves one trace (the 2026-09-07 orchestration decision). The trace is saved with the answer in `assessment_questions`; the paid calls go to `ai_calls` for the report (EV-03).
- Its own small flow, not CB-01's chat: no planner step and no history. Each question stands alone, so one question costs one embed, one rerank and one model call. The model is `ASK_MODEL` on `LLM_PROVIDER` (default `LLM_MODEL`, effort low), as AC6 asks, not `CHAT_PROVIDER`.
- The model writes one statement per line with its citations after it (`[O2]`, `[C1 "exact words"]`), or a `Missing:` line. S4 holds each line until it ends, checks it (labels it was given, quotes found, the content rules), and only then sends it; a line that fails is never shown and the trace records why. So an uncited statement never reaches the screen (AC4), at the cost of answers arriving a sentence at a time rather than word by word.
- The standards selected on the assessment are its latest checklist's (CP-30), or, before any checklist, every standard that applies to the site, then filtered through `knowledge_documents` (finished, not withdrawn, no Unconfirmed details). Chroma searches them by `doc_id`. Past reports are filtered by the site's jurisdiction and facility type (`all` matches either), unlike GN-01, which filters past reports by country only.
- Every observation not deleted is evidence, uncategorised ones included: a question is not about one section's categories. Observations are not in Chroma, so the one rerank call ranks them with the passages.
- Confidence (High, Medium, Low) is worked out in code from the checks, never asked of the model, and shown with the design system's `ConfidenceIndicator`.
- Questions are saved per user and assessment, so the tab shows one's earlier answers again; others never see them. Questions count against the chat's limits (CB-01), so one user's daily spend stays capped across both.
- The answer box uses AI violet (`--ai-*`), as AC2 asks, although design system v2 says new screens carry no AI tint: answers are machine-written and provisional until their sources are checked.

Rejected:
- Reusing CB-01's chat pipeline: it answers from the knowledge base, not one assessment's observations, plans with a second model, and uses `CHAT_PROVIDER`.
- Streaming the model's words as they come: a line could be shown before its check fails.
- Asking the model for its confidence: it gives no measure the platform can stand behind (CP-05 said the same of photo readings).
- A new standards field on the assessment: the checklist already records the standards the engineer keeps in scope.

Known limits: the content rules are checked with patterns (first person, "should"-style advice to someone, percentages of certainty); a recommendation worded otherwise is left to the prompt. `ASK_MIN_RELEVANCE` (0.1) is a first guess; no AS-01 eval set exists yet, so the saved traces are the material for one.

Stories: AS-01, GN-01, CP-30, EV-03, PV-02.


## 2026-11-11 — All Recordings lists recordings as All Photos lists photos, with one player in the browser; all three views open each item's text

Chose:
- (CP-12) All Recordings is a third view of the Observations tab, beside All Photos and All Handwritten Pages, opened from the location navigator's foot. It uses their table (`PhotoTable`: observation, location, category; a tap on the row opens the observation; Back returns to the view), with a play tile where the thumbnail is. It is built in the browser from the observations already loaded: no new route or field.
- One hidden `<audio>` for the whole list (`useRecordingPlayer`), so only one recording plays at a time. The playing or paused row shows a seek bar (a range input: drag, tap, arrow keys by five seconds, Home and End), its time, and a 1× / 1.5× / 2× speed, kept from one recording to the next for the visit.
- A site walk clip plays from the walk's file. The player keeps the clip's start and end itself rather than relying on the url's `#t=` fragment, so the bar runs from 0:00 to the clip's length, seeking stays inside the clip, and playback stops at its end. The client's recording view now carries `clip` for this.
- The row shows the observation's text, as All Photos does, with the recording's name and its state (Transcribing, or Couldn't transcribe with Retry) under it, which tells an observation's recordings apart. Retry is offered only where the observation page offers it: not in someone else's assessment (RV-11) or the demo.
- Removed recordings and deleted observations' recordings are left out, as All Photos leaves out theirs; they are restored from the observation and the Deleted observations list.
- A site walk proposal's navigator has no recordings row: its walk list already lists the walk's recordings, with their own player.
- Each row of the three views has the item's own line under the observation's text: its name, its transcription's state with Retry (recordings and pages), and a Transcript or Description toggle that opens its text under the row, closed to start with. A recording's transcript also opens when it plays, to read along. The text looks as on the observation's page: a recording's transcript plainly, as corrected; a page's reading behind the AI rule with its unsure words marked, or the engineer's correction plainly; a photo's description behind the AI rule. All Photos and All Handwritten Pages gained this with CP-12 but count against no story (noted on CP-04 AC3 and CP-19 AC17); a site walk proposal's views are unchanged.
- A photo's description is the observation's, one for all its photos (CP-21), so each photo's row says whether it describes this photo and how many others, or that it was written before this photo was added, and "Its evidence changed since." when out of date, as the observation's page says. The client's photo reading now carries `photoIds` for this.
- This reverses CP-19's choice to keep page transcripts off the Scans view ("tiles only"): with the text closed by default the list stays as compact, and reading a page or recording no longer means opening each observation.

Reason: recordings were the one kind of evidence only reachable one observation at a time, so finding "where I said the valve was chained" or a failed transcription meant opening each observation. Matching the other two views keeps one way to browse evidence, and giving all three the same line keeps them alike.

Rejected:
- The browser's own `<audio controls>` in each row: about 300px wide, different in every browser, and breaks the table's columns.
- A length column: observation recordings store no length, and reading it from every file would download them all; the length shows once a recording plays.
- A search box over transcripts: the photo and scan views have none, and the three should match.
- Correcting or removing a recording here: that stays on the observation's page, so there is one place to change evidence. The same goes for a page's text, and for describing photos again.
- Text that follows along with playback, a sentence lit as it is spoken: it needs Whisper's timestamps, which S5 doesn't return outside its eval, and a corrected transcript would lose them.

Known limits: a recording made in the browser (webm from MediaRecorder) has no length in its header. The player seeks past its end to make the browser work it out, then starts at 0:00; if the browser still can't tell within three seconds, only the time played shows, without a bar. The speed is not remembered between visits.

Stories: CP-12, CP-03, CP-04, CP-08, CP-19, CP-21, CP-22, RV-11.

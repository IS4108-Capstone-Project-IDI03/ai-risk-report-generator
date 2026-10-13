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
  after it is created: a wrong pick is archived and created again.
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
  carry a `section` (`2.1`, `Section 3 OFIs`, `Executive summary`), so an
  engineer can see which section was expensive to draft or redraft.
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

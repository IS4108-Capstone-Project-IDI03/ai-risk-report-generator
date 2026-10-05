# User stories backlog

Full product backlog, carried over from planning. Tick a story's checkbox when it's merged to `main`, not just coded — matches how `docs/DECISIONS.md` only records what actually landed. Acceptance criteria are kept in full underneath each story so a story can be closed against them without hunting for the original source.

## E1 — Foundations & DevOps

- [x] **F-01** — Start the local development stack (developer, Must, 5 pts, deps: none, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: start the complete stack with one command, so development can begin on a clean machine.

  1. Given a clean Windows machine meets documented prerequisites, when the setup guide is followed, then the stack starts without undocumented fixes.
  2. Given the repository is configured, when the startup command runs, then every required service reaches its documented ready state.
  3. Given a fresh checkout, when the environment template is inspected, then each required variable has a safe placeholder in `.env.example`.
  4. Given an empty development database, when the seed script runs, then three sample standards are available.
  5. Given an empty development database, when the seed script completes, then one sample assessment is available.
  6. Given seeded local data, when the containers restart, then the sample records remain available.
  </details>

- [x] **F-02** — Block merges that fail CI checks (developer, Must, 3 pts, deps: none, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: automated quality checks gate every merge into `main`, so `main` always holds code that builds and passes its tests.

  1. Given a pull request is opened or `main` receives a push, when the event occurs, then the CI workflow starts.
  2. Given a CI run, when linting executes for either JavaScript or Python, then a lint failure causes a failed check.
  3. Given a CI run, when a unit test fails, then the test check fails.
  4. Given a CI run, when an application image cannot build, then the build check fails.
  5. Given a completed test run, when coverage is calculated, then the pull request receives the coverage result.
  6. Given coverage below the configured threshold, when the coverage check runs, then the check fails.
  7. Given a required CI check has failed, when a merge is attempted, then the merge is blocked.
  8. Given several approved pull requests, when they enter the merge queue, then each is tested against `main` plus the changes queued ahead of it.
  9. Given a queued pull request fails its merge-queue checks, when the queue processes it, then it is removed from the queue and does not merge.
  </details>

- [x] **F-03** — Set up and update my account profile (knowledge admin, Must, 2 pts, deps: F-04, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: update account details for users, so account information can be kept up to date.

  1. Given a selected account in a list of users, when I click on the profile, I can view the details of the user with the option to update their details.
  2. Given a selected account is being edited, when I click on save, then the edited profile fields are persisted.
  3. Given saved profile changes, when the user reopens their profile, then the updated values are displayed.
  4. Given invalid profile edit input, when I save it, then the form identifies the invalid field.
  </details>

- [ ] **F-04** — Log in to the application (knowledge admin or risk engineer, Must, 2 pts, deps: none, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: log in with registered credentials, so the workspace assigned to the account is reachable.

  1. Given an existing account with valid credentials, when the user submits the login form, then an authenticated session is created.
  2. Given a successful login, when the initial page loads, then the user sees the workspace for their assigned role.
  3. Given invalid credentials, when the login form is submitted, then no authenticated session is created.
  4. Given invalid credentials, when authentication fails, then a generic login error is displayed.
  5. Given an unauthenticated browser, when a protected workspace URL is opened, then the login screen is displayed.
  6. Given an unauthenticated API request, when a protected resource is requested, then the API returns HTTP 401.
  7. Given repeated failed login attempts for one account, when the configured limit is reached, then further attempts are refused for a set period.
  </details>

- [x] **F-05** — Enforce role permissions (knowledge admin, Must, 2 pts, deps: F-04, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: edit role assignment for each user, so assessment access follows the agreed role permissions.

  1. Given the role configuration, when a role is assigned, then the available values are Risk Engineer and Knowledge Admin.
  2. Given the agreed permission matrix, when an allowed operation is requested by its permitted role, then the operation succeeds.
  3. Given a user lacks permission, when a restricted browser route is opened, then the route guard blocks access.
  4. Given a user lacks permission, when a restricted API operation is requested, then the API returns HTTP 403.
  </details>

- [ ] **F-06** — Reset a forgotten password (knowledge admin or risk engineer, Must, 3 pts, deps: F-04, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: reset a password using an emailed link, so access to an existing account can be recovered.

  1. Given a registered email address, when a password-reset request is submitted, then a reset link is sent to that address.
  2. Given a valid reset link, when a valid replacement password is submitted, then the new password is stored securely.
  3. Given a completed password reset, when the new credentials are submitted, then login succeeds.
  4. Given a completed password reset, when the previous password is submitted, then login fails.
  5. Given an expired or previously used reset link, when a replacement password is submitted, then the reset is rejected.
  6. Given a reset is requested for an address that is not registered, when the request is submitted, then the response is identical to a successful request.
  </details>

- [ ] **F-07** — Log out from session manually or after inactivity (knowledge admin or risk engineer, Must, 2 pts, deps: F-04, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: a session ends on logout, and automatically after inactivity, so an account isn't left open on a shared machine.

  1. Given an authenticated session, when 15 minutes pass without activity, then the server rejects further requests using that session.
  2. Given an authenticated browser session, when its 15-minute inactivity limit expires, then the browser redirects to the login screen.
  3. Given an expired session, when the user logs in again with valid credentials, then a new session permits access.
  4. Given an authenticated session, when the user selects the logout option, then the session is terminated and the user is redirected to the login screen.
  </details>

- [ ] **F-08** — Create new employee accounts (knowledge admin, deps: F-03, F-05)
  <details><summary>Goal / AC</summary>

  Goal: add a team member's account (name, work email, role and optional profile details) from the User accounts screen, so account records stay clean and unique and assessments and other records can reliably refer to them.

  1. Given a knowledge admin on the User accounts screen, when they submit a new account with a name, work email and role, then the account is saved as active in the account list. Job title, phone and office are optional.
  2. Given a required field is missing or invalid (e.g. a malformed email or an unknown role), when the account is submitted, then each invalid field shows its own error and no account is created.
  3. Given another account already uses the email, when the account is submitted, then the email field reports the conflict and no account is created.
  4. Given a new account has been created, when the employee signs in with that email, then they land on the screens their assigned role permits.
  </details>

## E2 — Ingestion & Processing

- [x] **IN-01** — Upload knowledge base document(s) (knowledge admin, Must, 5 pts, deps: none, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: upload one or more knowledge base documents, so their original source remains traceable throughout ingestion.

  1. Given I have chosen a document's source type and entered the details that type requires, when I upload it, then those details are saved against its document ID.
  2. Given I upload a PDF, when the upload succeeds, then the unaltered original is stored under its document ID and an ingestion job is queued for it.
  3. Given several documents are queued, when ingestion runs, then they are processed one at a time.
  4. Given a document has been ingested, when I open its original by document ID, then it matches the uploaded file.
  5. Given a file that is not a PDF or cannot be opened, when I upload it, then it is rejected with a reason and no ingestion job is queued.
  6. Given I upload several files and one is rejected, when the upload finishes, then the other files are still queued.
  7. Given I have uploaded documents, when I return to the upload screen, then I see the ingestion status of each document still in progress or finished recently.
  </details>

- [ ] **IN-02** — Detect duplicate and overlapping documents on upload (knowledge admin, Could, 3 pts, deps: IN-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: be warned when a document substantially repeats something already stored, so the same passage doesn't crowd out other relevant sources.

  1. Given a document identical to one already stored, when I submit it, then I am told it already exists before any processing begins, and it is not added as a duplicate.
  2. Given a document that substantially overlaps existing content without being identical, when it is processed, then it is flagged as overlapping, with the document it overlaps and the extent of the overlap recorded.
  3. Given an uploaded document shares its title and issuing authority with a stored document but carries a different edition, when it is processed, then it is flagged as a candidate later edition of that document.
  </details>

- [ ] **IN-03** — Extract structured tables across document pages (risk engineer, Must, 3 pts, deps: IN-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: preserve the structure of extracted document tables, so table values keep their meaning.

  1. Given a document contains a table, when it is ingested, then the extracted table preserves its rows and columns.
  2. Given a value at a known cell, when I inspect it after extraction, then it keeps its row header and column header associations.
  3. Given one table continues across pages, when extraction completes, then it is stored as one logical table.
  4. Given a labelled sample of tables, when extraction runs against it, then the proportion of cells with correct header associations meets the agreed threshold.
  </details>

- [ ] **IN-03** — Resolve flagged overlapping documents and superseded editions (knowledge admin, Could, 3 pts, deps: IN-02, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: choose how a flagged overlapping document is handled, so control over published sources and current editions stays with the admin.

  1. Given a document is flagged as overlapping, when I open its resolution screen, then both documents appear side by side with overlapping passages marked.
  2. Given an overlap awaits resolution, when I choose Keep both, then the new document is retained alongside the existing document.
  3. Given an overlap awaits resolution, when I choose Replace existing, then the new document takes the existing document's active place in the knowledge base.
  4. Given an overlap awaits resolution, when I choose Discard new, then the new document is excluded from publication.
  5. Given the flagged document is a later edition of the existing one, when I choose Supersede, then the new document becomes current and the earlier edition is marked Superseded.
  6. Given an edition is marked Superseded, when I inspect retained source records, then its original file and its chunks remain stored.
  7. Given an overlapping document has no resolution, when I view the knowledge base, then it is labelled Awaiting resolution instead of Published.
  </details>

- [ ] **IN-04** — Parse report heading structure with source locations (risk engineer, Must, 5 pts, deps: IN-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: keep section structure and page locations when parsing reports, so a finding can point to a precise, verifiable source location.

  1. Given a past Marsh report contains nested headings, when parsing completes, then each extracted piece has its section/sub-heading/sub-sub-heading path where those levels exist.
  2. Given an extracted piece originated on a PDF page, when I inspect its source location, then the original PDF page number is shown.
  3. Given multiple pieces fall under one heading, when I inspect their source order, then their original positions beneath that heading are retained.
  4. Given a labelled sample of past reports, when the parser runs against it, then the proportion of headings correctly extracted meets the agreed threshold.
  5. Given the same labelled sample, when the parser runs, then the proportion of pieces assigned to the correct source page meets the agreed threshold.
  6. Given a benchmark run completes, when the result is stored, then it can be compared against previous runs.
  </details>

- [ ] **IN-04** — Extract text from scanned document pages (knowledge admin, Should, 3 pts, deps: IN-01, Sprint 3)
  <details><summary>Goal / AC</summary>

  Goal: ingest scanned or photographed pages, so image-based archive material can be used by the knowledge base.

  1. Given a page has little or no extractable text, when ingestion examines the page, then the page is routed to OCR.
  2. Given an image-based page contains readable text, when OCR succeeds, then extracted text is passed to the document parsing pipeline.
  3. Given OCR output for a page falls below the agreed confidence threshold, when processing finishes, then the page is marked "OCR review needed" and that status shows on the document's ingestion status view.
  </details>

- [ ] **IN-05** — Assign document classifications automatically (knowledge admin, Should, 3 pts, deps: IN-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: assign document properties automatically on ingestion, so documents don't need labelling by hand.

  1. Given a newly ingested document has no indication of the particular property, when classification runs, a predicted type is recorded as unconfirmed.
  2. Given a test set has known properties, when the classifier is evaluated, then document property assignment accuracy meets the agreed threshold.
  3. Given classification evaluation completes, when I inspect its results, then the evaluated document set is identified.
  </details>

- [ ] **IN-06** — Confirm or correct auto-assigned document labels (knowledge admin, Should, 2 pts, deps: IN-05, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: confirm or amend system-assigned labels before a document is treated as classified, so a wrong automatic classification never silently becomes the label.

  1. Given a document has auto-assigned labels, when I open the classification queue, then the document is listed as Unconfirmed with its suggested labels shown.
  2. Given a document awaits confirmation, when I accept its suggested labels, then those values are stored as confirmed.
  3. Given a document awaits confirmation, when I amend a suggested label, then the amended value is stored as confirmed.
  4. Given a document has been confirmed, when I reopen the queue, then the document is absent from that queue.
  5. Given a document still has unconfirmed labels, when a filtered search runs on those labels, then the document is not returned.
  6. Given a document's labels have been confirmed, when a matching filtered search runs, then the document is returned.
  </details>

- [ ] **IN-07** — Inspect ingestion stages with elapsed time (knowledge admin, Should, 3 pts, deps: IN-01, Sprint 3)
  <details><summary>Goal / AC</summary>

  Goal: see each document's current ingestion stage, so active processing can be distinguished from completed content.

  1. Given a document is processing, when I view ingestion status, then its current stage is shown as one of Uploaded, Parsing, OCR, Anonymising, Chunking, Indexing, Complete or Failed.
  2. Given a document is processing, when I view ingestion status, then its elapsed processing time is displayed.
  3. Given processing moves to another stage, when I continue viewing status, then the displayed stage reflects that transition.
  4. Given a page was flagged during OCR or parsing, when I view that document's status, then the flag is shown against the document.
  </details>

- [ ] **IN-08** — Notify if ingestion failed at a particular stage (knowledge admin, Should, 1 pt, deps: IN-07, Sprint 3)
  <details><summary>Goal / AC</summary>

  Goal: be notified when an ingestion job has failed, so the engineer can retry the ingestion.

  1. Given ingestion has failed, when I inspect the job, then the failed stage is identified.
  2. Given ingestion has failed, when I inspect its error details, then the failure reason is displayed.
  3. Given a failed document has retained processing state, when I select Retry, then processing resumes from the failed stage without resubmitting the document.
  </details>

## E3 — Knowledge Base & Online RAG Pipeline

- [ ] **KB-01** — Correct or withdraw knowledge base documents (knowledge admin, Must, 8 pts, deps: IN-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: correct or withdraw documents in the knowledge base, so searches and reports only use correctly labelled, current documents.

  1. Given the knowledge base holds past reports, FM standards and NFPA standards, when I open the knowledge base, then the documents are grouped under those three headings.
  2. Given a document has finished ingesting, when I view it, then I see its title, edition or report date, country, facility type and status.
  3. Given a document is still ingesting or failed to ingest, when I open the knowledge base, then it is not listed.
  4. Given documents have different label values, when I filter by one value, then only documents with that value are listed.
  5. Given no document matches my filters or title search, when I apply them, then I see a message that no documents match.
  6. Given a document has a wrong label, when I save an allowed replacement value, then the document shows the corrected value.
  7. Given I am correcting a label, when I save a value that isn't allowed, then the change is rejected with a reason, and the old value is kept.
  8. Given I have corrected a document's label, when a search filters on the new value, then the document is found, and a search on the old value no longer finds it.
  9. Given a document's details were corrected, when I view its edit history, then I see each previous version with when it was replaced and by whom, newest first.
  10. Given a document has a previous version, when I restore it and save, then the document shows that version's details.
  11. Given the knowledge base has documents with different titles, when I search for a title, then only documents whose titles match are listed.
  12. Given a document is active, when I withdraw it and confirm, then it is shown as Withdrawn.
  13. Given a document is withdrawn, when reference material is retrieved, then none of its passages are returned.
  14. Given a document is withdrawn, when I view its details, then I see who withdrew it and when.
  15. Given a document is withdrawn, when I view it, then I can't edit its details.
  </details>

## E4 — Retrieval & Context Management

- [ ] **RT-01** — Filter retrieval by site applicability (risk engineer, Must, 3 pts, deps: KB-01, CP-01, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: search reference material applicable to the current site, so retrieved evidence matches the assessment context.

  1. Given an assessment has a region, facility type, risk-area selection, when a search runs, then every result satisfies the selected applicability filters.
  2. Given a standard is superseded, when I search with default settings, then that edition is excluded.
  3. Given a superseded edition is available, when I enable older editions, then it becomes eligible for retrieval.
  4. Given multiple applicability filters are selected, when retrieval runs, then each selected filter constrains the result set.
  5. Given I search using a mix of plain description and an exact reference, when the search runs, then results matching either are returned together in one ranked list.
  6. Given the same query is run using each search method separately, when the results are compared against the combined version, then the combined version performs at least as well.
  </details>

- [ ] **RT-02** — Inspect precedent recommendations with their findings (risk engineer, Must, 3 pts, deps: RT-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: inspect the findings behind a comparable site's recommendations, so each precedent's applicability can be judged.

  1. Given a comparable assessment contains a recommendation, when it is displayed, then its linked originating finding is shown.
  2. Given a precedent recommendation is displayed, when disclosure is permitted, then its source assessment reference is visible.
  3. Given source assessment identity is restricted, when the precedent is displayed, then the restricted identity is withheld.
  </details>

- [ ] **RT-03** — Record retrieval usage events (knowledge admin, Should, 2 pts, deps: RT-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: record retrieval runs with document usage, so knowledge-base usage can be measured consistently.

  1. Given a search completes, when its usage event is saved, then the submitted query is recorded.
  2. Given a search completes, when its usage event is saved, then the returned document references are recorded.
  3. Given a search incurs measurable retrieval cost, when its usage event is saved, then that cost is recorded.
  4. Given retrieved evidence is used by a consumer, when usage is logged, then each used document is marked as used for that run.
  5. Given retrieval events exist, when I open the usage report, then each document shows its retrieval count.
  6. Given consumer usage events exist, when I open the usage report, then each document shows its use count.
  7. Given a document has never been retrieved, when I open the usage report, then it is listed as unused.
  </details>

## E5 — Multimodal Capture

- [x] **CP-01** — Start a new site assessment (risk engineer, Must, 3→5 pts, deps: none, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: start a new assessment, so observations for this site can be recorded.

  1. Given an assessment has no active capture session, when the engineer starts capture, then a new capture session is created for that assessment.
  2. Given an assessment with a session in progress, when the engineer opens or reopens the capture, then the existing session is returned without starting a new one.
  3. Given an active session, when the capture screen is displayed, then the current assessment is identified.
  4. Given valid site and client details, when the engineer creates an assessment, then it is saved with a unique server-allocated reference, shown to the engineer.
  5. Given missing or invalid assessment details, when creation is requested, then no assessment is saved and the reason for each invalid field is shown.
  6. Given a newly created assessment, when the engineer opens it, then capture starts for that assessment and the capture screen identifies it.
  </details>

- [x] **CP-02** — Save a quick text observation (risk engineer, Must, 1→2 pts, deps: CP-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: save a brief text note during a site visit, so a finding can be recorded before its structured details are complete.

  1. Given an active session with entered note text, when Save is selected, then the original text is stored as a text observation.
  2. Given a saved text observation, when its metadata is inspected, then its capture timestamp is recorded.
  3. Given a text observation with Exposure selected, when the note is saved, then its COPE category is Exposure.
  4. Given an uncategorised note, when category-scoped drafting inputs are requested, then the note is excluded until categorised.
  5. Given a text observation is created, when it is saved, then the capture is tagged with the engineer's id.
  </details>

- [x] **CP-03** — Capture and transcribe a voice observation (risk engineer, Must, 5 pts, deps: CP-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: record or upload a voice note for transcription, so captured findings can be reviewed before drafting.

  1. Given an active session, when audio is recorded or uploaded, then the original audio is stored as retrievable raw evidence.
  2. Given a saved recording, when its metadata is inspected, then it shows type Voice with the engineer's ID.
  3. Given a saved recording, when capture completes, then one transcription job is queued.
  4. Given pending transcription, when the observation is opened, then its status is Transcribing.
  5. Given successful transcription, when the observation is opened, then its transcript appears with status Transcribed.
  6. Given failed transcription, when the observation is opened, then the failure reason is displayed.
  7. Given failed transcription, when the engineer retries, then a new attempt starts for the same recording.
  8. Given microphone permission is denied, when recording is requested, then a permission message is displayed.
  </details>

- [ ] **CP-04** — Capture a site photograph (risk engineer, Must, 1 pt, deps: CP-01, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: attach a photograph to an assessment, so visual evidence for a finding is retained.

  1. Given an active session, when a JPG or PNG photograph is saved, then the original image is stored as raw evidence.
  2. Given a saved photograph, when its photo observation is opened, then the original image is linked to that observation.
  3. Given a saved photograph, when the assessment photo collection is opened, then the image is available for the report photo appendix.
  4. Given an unsupported file type, when photo upload is attempted, then the file is rejected with a format message.
  5. Given a photo capture is created, when it is saved, then the capture is tagged with the engineer's id.
  6. Given a photo is taken on the device, when the engineer uploads it to the application, then it uploads as normal.
  </details>

- [ ] **CP-05** — Automatically interpret a site photograph (risk engineer, Must, 2 pts, deps: CP-04, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: receive a proposed observation from a site photograph, so a draft description of the visible hazard can be reviewed.

  1. Given an active capture session, when a supported photograph finishes saving, then a vision job is queued automatically.
  2. Given an active vision job, when the photo observation is opened, then its status is Interpreting.
  3. Given a successful vision result, when the observation is opened, then the proposed description is shown as generated text.
  4. Given a successful vision result, when the generated metadata is inspected, then the proposed category is displayed.
  5. Given a successful vision result, when the generated metadata is inspected, then the proposed hazard type is displayed.
  6. Given a generated photo observation, when its evidence link is opened, then the source photograph is displayed.
  </details>

- [x] **CP-06** — Tag an observation (risk engineer, Must, 2 pts, deps: CP-02, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: assign location, COPE category or severity to an observation, so findings can be grouped using consistent labels.

  1. Given an observation with a selected floor, name, category or severity value, when the value is saved, then that field retains the selected value after reopening.
  2. Given an observation with saved labels, when the list is filtered by any one matching label, then the observation is returned.
  3. Given the capture tagging interface, when a COPE category is selected, then its value belongs to the shared category vocabulary.
  </details>

- [ ] **CP-07** — Extract structured fields from a voice transcript (risk engineer, Must, 3 pts, deps: CP-03, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: populate observation fields from a transcript, so structured site evidence with visible gaps can be reviewed.

  1. Given a transcript created from voice recording containing a supported observation fact, when field extraction runs, then the fact is placed in its matching field.
  2. Given a required field with no supporting transcript fact, when extraction completes, then the field remains empty.
  3. Given an observation with an empty required field, when the engineer opens it, then the missing field is identified.
  4. Given a proposed field value, when the engineer saves a correction before use, then the corrected value is used by the observation.
  </details>

- [ ] **CP-08** — Manage captured observation (risk engineer, Must, 3 pts, deps: CP-03, CP-04, CP-06, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: view, correct and remove observations in a capture session, so the observation can be maintained as evidence for report drafting.

  1. Given a session with captured observations, when its observation list is opened, then every active observation in that session is listed.
  2. Given an observation list, when an observation row is inspected, then its summary displays type, category, name, status, capture timestamp.
  3. Given a selected type, category, name or status filter, when the list refreshes, then only matching observations are shown.
  4. Given a listed observation, when the engineer opens it, then its details are displayed.
  5. Given an observation with prior citations, when a correction is saved, then the prior evidence version remains traceable.
  6. Given a saved correction, when a future draft reads that observation, then the current version is used.
  7. Given an observation owned by the engineer, when a content correction is saved, then the corrected content is persisted.
  8. Given an observation owned by the engineer, when deletion is confirmed, then the observation is marked as soft-deleted.
  9. Given a soft-deleted observation, when the default observation list is opened, then the observation is absent.
  10. Given a soft-deleted observation, when drafting inputs are collected, then the observation is excluded.
  11. Given an existing citation to the removed observation, when the citation is inspected, then its historical evidence remains traceable.
  </details>

- [ ] **CP-09** — Open the raw capture behind an observation (risk engineer, Must, 1 pt, deps: CP-03, CP-04, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: play the source recording or open the source photograph, so the evidence behind a description can be verified.

  1. Given a voice observation, when its evidence view is opened, then the original recording can be played beside its transcript.
  2. Given a photo observation, when its evidence view is opened, then the original photograph is displayed beside its description.
  </details>

- [ ] **CP-10** — Annotate/amend the description of a site photograph (risk engineer, Should, 2 pts, deps: CP-04, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: mark the hazard on a site photograph, so a report reader can locate the detail observed.

  1. Given a stored site photograph, when a drawn annotation is saved, then a derivative image contains the annotation.
  2. Given an annotated image with entered caption, when Save is selected, then the caption is stored with the annotation.
  3. Given a saved annotated image, when it is displayed in any annotated-photo view, then its caption appears beneath it.
  4. Given a saved annotation, when the raw photo is opened, then the original image remains unchanged.
  </details>

- [ ] **CP-11** — Generate a pre-survey checklist (risk engineer, Could, 5 pts, deps: RT-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: generate an inspection checklist for the selected facility context, so relevant inspection points are prepared before a visit.

  1. Given a facility type with selected applicable standards, when a checklist is requested, then the generated checklist uses that facility scope.
  2. Given a generated checklist, when its inspection items are reviewed, then each standards-derived item cites its source requirement.
  3. Given a configured mandatory hazard for the selected facility, when the checklist is generated, then an inspection item covers that hazard.
  </details>

- [ ] **CP-12** — Customise a pre-survey checklist (risk engineer, Could, 2 pts, deps: CP-11, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: customise the generated checklist, so the site visit checklist reflects the planned inspection.

  1. Given a generated checklist, when the engineer adds, edits or removes an item, then the saved checklist reflects that change.
  2. Given an existing checklist item, when its standard reference is changed, then the saved item uses that reference.
  3. Given a saved customised checklist, when the engineer opens it before or during the survey, then the customised content is available.
  4. Given a saved customised checklist, when a field-use copy is downloaded, then every saved inspection item is included.
  5. Given a downloaded checklist, when it is opened without external lookups, then the saved standard references are available.
  </details>

- [ ] **CP-13** — Recommend checklist items (risk engineer, Could, 2 pts, deps: CP-12, RT-02, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: recommend relevant inspection items based on past/similar inspections, so the checklist surfaces known risks to verify.

  1. Given a selected facility context, when checklist recommendations are generated, then the system retrieves relevant historical inspection information for similar facilities.
  2. Given a recommended item, when the engineer reviews the checklist, then the engineer can accept, edit or remove the recommendation.
  </details>

- [ ] **CP-14** — Complete a site assessment (risk engineer, Must, 1 pt, deps: CP-08, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: mark a finished site assessment ready for drafting, so report generation uses a stable set of observations.

  1. Given a session satisfying the configured completion gates, when completion is requested, then its status becomes Ready for generation.
  2. Given a completed session, when its generation input is inspected, then a timestamped snapshot identifies the included observation versions.
  3. Given an incomplete session, when completion is requested, then the unmet gate is displayed.
  4. Given a saved capture snapshot, when an observation is subsequently edited, then the snapshot retains its original observation versions.
  </details>

- [x] **CP-15** — Record observations by location on site (risk engineer, Should, 1 pt, deps: CP-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: add site locations and choose where the engineer is before capturing, so each observation records where on site it was found.

  1. Given an active session with no location chosen, when capture opens, then the engineer is asked to choose or add a location before capturing.
  2. Given a location name and optional floor, when the engineer adds it, then it is listed for the assessment and selected for capture.
  3. Given a location with the same name and floor already exists, when the engineer adds it again, then it is refused.
  4. Given a chosen location, when the engineer switches to another location, then new observations are recorded against the new one.
  5. Given a chosen location, when an observation is saved, then the observation is recorded against that location.
  6. Given a location with no observations, when the engineer removes it, then it is no longer listed.
  7. Given a location with observations, when the engineer tries to remove it, then removal is refused and the number of observations is shown.
  </details>

## E6 — Report Generation & Guardrails

- [ ] **GN-01** — Generate cited technical report section (sections 7-12) (risk engineer, Must, 8 pts, deps: RT-01, Sprint 3)
  <details><summary>Goal / AC</summary>

  Goal: generate a selected technical section from captured site evidence, so a useful first draft in Marsh's report format can be reviewed.

  Sections 7–12 are Construction to Business Interruption in Marsh's Global PRE Report Template v2.0 (originally written as 6–12). CP-14 was dropped, so drafting does not wait for capture to be completed. Sections 7–12 state findings only, as Marsh's reports do.

  1. Given a selected section within Sections 7–12 has sufficient captured evidence, When I request its first draft, Then that section's draft is created.
  2. Given several sections have sufficient captured evidence, When I draft the whole report, Then each of those sections is drafted in turn and each section without sufficient evidence shows what it needs.
  3. Given site observations belong to a specific assessment, When the section context is assembled, Then observations are loaded by that assessment identifier, those filed under the section's COPE categories are its main evidence, and uncategorised observations are left out.
  4. Given a technical draft is produced, When each statement is checked, Then its content is supported by the assessment observations or retrieved standards and it states a finding rather than an opinion on what the finding may lead to.
  5. Given a generated statement is displayed, When I inspect its citation, Then at least one reference resolves to a supporting source chunk or observation, with the standard's heading and page.
  6. Given a retrieved standard passage covers a finding, When the draft is produced, Then the finding cites that passage alongside the observation.
  7. Given a section draft is produced, When it is compared with Marsh's configured template, Then it follows that section's structure.
  8. Given a section draft is produced, When it is reviewed against the configured writing conventions, Then its wording follows those conventions.
  9. Given the evidence leaves something an insurer would care about missing or unclear, When the draft is produced, Then up to three questions for the engineer are shown with it.
  10. Given a section draft is saved, When its generation provenance is inspected, Then the prompt-version/model record identifies the configuration used.
  11. Given a section draft is saved, When the evidence it was drafted from is inspected, Then the observations are shown as they were at drafting time, even if they were edited afterwards.
  12. Given a section has a draft, When observations are added or changed afterwards, Then the section shows its draft is out of date and redrafting includes them.
  13. Given a set of evaluation sections with reference observations, When each generated draft is scored by an LLM judge against a fixed rubric, averaged over two runs, Then every draft scores at least 4.0 for groundedness and no invention, at least 3.5 for structure and coverage, at least 3.0 for conventions, and at least 4.0 on average, and the scores, judge model and rubric version are recorded.
  </details>

- [ ] **GN-02** — Flag claims that lack supporting evidence (risk engineer, Must, 5 pts, deps: GN-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: identify unsupported generated claims before review, so evidence gaps are caught before a report is approved.

  1. Given a generated sentence has a source citation, when it is prepared for display, then a support check against the cited source is completed.
  2. Given a generated sentence has no matching source, when the support check completes, then the sentence receives unsupported status.
  3. Given a generated sentence is not supported by its cited source, when the support check completes, then the sentence receives unsupported status.
  4. Given a sentence has unsupported status, when it appears in the review editor, then it is visibly marked.
  </details>

- [ ] **GN-03** — Populate factual values from structured data (risk engineer, Must, 3 pts, deps: GN-01, CP-07, RV-05, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: populate deterministic facts from validated assessment data, so generated prose cannot invent engineering values.

  1. Given a measurement or dimension is available in structured assessment data, when it is inserted into a draft, then the report must use the same value.
  2. Given a risk rating is calculated from a set of rules, when it is inserted into a draft, then the displayed rating must use the same rating.
  3. Given a required fact is not available in the assessment data, when the report is generated, then the report does not make up a value.
  </details>

- [ ] **GN-04** — Regenerate a selected report section based on user comments (risk engineer, Must, 3 pts, deps: GN-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: regenerate an individual report section, so a weak section can be improved without losing other review work.

  1. Given a report contains multiple sections, when I regenerate one selected section, then only that section receives a replacement draft.
  2. Given a replacement section draft is ready, when I accept it, then it becomes the saved section content.
  3. Given a replacement section draft is ready, when I discard it, then the previously saved section content remains unchanged.
  </details>

- [ ] **GN-05** — Generate Section 3 Opportunities for Improvement (risk engineer, Must, 5 pts, deps: CP-14, RT-02, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: draft each Opportunity for Improvement as a complete record in Marsh's format, informed by comparable past assessments.

  1. Given a current observation has a relevant precedent, when recommendation drafting runs, then the suggestion reflects the current observation.
  2. Given a recommendation uses a precedent, when the suggestion is displayed, then the originating precedent report reference is shown.
  3. Given a recommendation has been suggested, when I view the report before accepting it, then the suggestion is not shown on the report content.
  4. Given I have reviewed a recommendation suggestion, when I explicitly accept it, then that suggestion is inserted into the report.
  5. Given an observation needs an Opportunity for Improvement, when it is drafted, then it is created as a structured record using Marsh's fields and configured value lists.
  6. Given an Opportunity for Improvement has a likelihood and a consequence, when it is drafted, then its priority comes from the Risk Assessment Matrix.
  </details>

- [ ] **GN-06** — Produce Section 4 risk quality ratings and commentary (risk engineer, Must, 3 pts, deps: CP-14, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: produce risk quality ratings from configured rules, explained in commentary, so professional judgement is backed by a traceable explanation.

  1. Given assessment data for a risk area is complete, when the configured rating rules are applied, then a risk quality category is recorded for that area.
  2. Given the configured rule-based rating process has produced a risk-quality category, when commentary is drafted, then that category is used unchanged.
  3. Given qualitative risk-quality commentary is displayed, when I inspect it, then it contains no hallucinated numeric risk score.
  4. Given a displayed risk-quality category has a supporting rule result, when I inspect its basis, then that rule result is identifiable.
  </details>

## E7 — Engineer Review & Editing

- [ ] **RV-01** — Review report sections alongside their evidence (risk engineer, Must, 8 pts, deps: GN-01, IN-04 (heading parsing), Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: review sections in a workspace showing drafts with their supporting evidence, so each section can be reviewed in context.

  1. Given an assessment has a report draft, when I open the review workspace, then the draft editor is displayed.
  2. Given a report section is selected, when its review workspace loads, then its reference source panel is visible beside the draft.
  3. Given a report section has original field observations, when its review workspace loads, then those observations are visible beside the draft.
  4. Given a report section has cited claims, when I open the review workspace, then all the claims are visible beside the draft.
  5. Given sections have completion states, when I open section navigation, then each section's completion state is visible.
  6. Given sections have review states, when I open section navigation, then each section's review state is visible.
  7. Given a draft citation references a standard or precedent report, when I select the citation, then the exact source passage opens in the source panel.
  8. Given a cited passage opens, when I inspect its location details, then its source page number is displayed.
  9. Given a cited passage opens, when I inspect its source identity, then the document title is displayed.
  10. Given a cited source has an edition, when I inspect its metadata, then that edition is displayed.
  11. Given a cited source has an effective date, when I inspect its metadata, then that effective date is displayed.
  12. Given a cited source is withdrawn, when I inspect its metadata, then it is labelled Withdrawn.
  </details>

- [ ] **RV-02** — Review individual generated findings (risk engineer, Must, 3 pts, deps: RV-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: accept, edit or reject each generated finding, so professional judgement controls the final report.

  1. Given a generated finding is pending review, when I accept it, then its review state becomes Accepted.
  2. Given I edit a generated finding, when I save the change, then the updated text replaces that finding's draft text.
  3. Given I save an edited finding, when I inspect its audit entry, then the before/after text pair is retained.
  4. Given I save an edited finding, when I inspect its audit attribution, then the authenticated user/time record identifies the edit.
  5. Given a generated finding is pending review, when I confirm rejection, then it is removed from the visible draft.
  6. Given I confirm rejection of a finding, when I inspect the immutable audit log, then its content is retained with the rejection record.
  7. Given a section contains pending findings, when I choose Bulk Accept, then all pending findings in that section become Accepted.
  8. Given a section contains rejected findings, when I choose Bulk Accept, then the rejected findings remain Rejected.
  9. Given a report contains accepted, edited and rejected findings, when I view the review summary, then the displayed totals match the saved review decisions.
  </details>

- [ ] **RV-03** — Discuss a specific draft passage (risk engineer, Could, 2 pts, deps: RV-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: leave comments on selected draft passages, so colleagues can resolve review questions in context.

  1. Given I have selected a draft passage, when I submit a comment, then its discussion thread is anchored to that passage.
  2. Given an unresolved discussion thread exists, when I mark it Resolved, then the thread's state becomes Resolved.
  3. Given a resolved discussion thread exists, when I reopen it, then the thread's state becomes Unresolved.
  </details>

- [ ] **RV-04** — Check report completeness before export (risk engineer, Must, 5 pts, deps: RV-02, GN-02, EV-01, KB-02, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: see outstanding review items before export, so required review work is completed first.

  1. Given a report has pending findings, when a finding review decision is saved, then the validation checklist reflects its new state.
  2. Given a mandatory section is empty, when I complete that section, then its missing-section item is cleared.
  3. Given a report flag is unresolved, when I resolve it, then its validation item is updated.
  4. Given a report's validation item count changes, when the change is saved, then the global report dashboard shows the updated open-item count.
  5. Given a report has open high-severity findings, unresolved mandatory sections or unsupported claims, when I attempt normal export, then export is blocked.
  6. Given a report is submitted for export, when a citation target fails to resolve, then export is blocked.
  7. Given a previously approved section cites a superseded or withdrawn source, when pre-export validation runs, then that section is returned for engineer review.
  8. Given a required section has no recorded engineer approval, when export is requested, then export is blocked.
  9. Given the engineer wants to export with an unresolved finding with proper justification, when an authorised engineer records a justified override, then export is permitted.
  10. Given an export override is accepted, when I inspect the audit trail, then the justification is retained.
  11. Given an export override is accepted, when I inspect its audit attribution, then the authenticated user/time record identifies the decision.
  12. Given second layer review is enabled for the team, when I request export of a report the knowledge admin has not approved, then export is blocked.
  13. Given second layer review is enabled and a report lacks admin approval, when an authorised engineer records a justified override, then export remains blocked.
  </details>

- [ ] **RV-05** — Display deterministic engineering calculations (risk engineer, Must, 3 pts, deps: CP-14, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: view engineering values computed by approved rules, so numerical report content has a traceable calculation basis.

  1. Given approved calculation rules have the required assessment inputs, when the numerical panel loads, then it displays the rule-computed loss estimate.
  2. Given approved rating rules have the required assessment inputs, when the numerical panel loads, then it displays the rule-computed severity rating.
  3. Given the same inputs use the same rule version, when the calculation is repeated, then the result is unchanged.
  </details>

- [ ] **RV-06** — Version history for the report / by sections (risk engineer, Should, 5 pts, deps: RV-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: inspect earlier section versions with text comparison and restore a previous saved draft, so text overwritten during review can be recovered.

  1. Given a report section has saved versions, when I open its version history, then the versions are listed chronologically.
  2. Given a saved version appears in history, when I inspect its attribution, then its author/time record is displayed.
  3. Given I select an earlier version for comparison, when the diff view opens, then added text is highlighted.
  4. Given I select an earlier version for comparison, when the diff view opens, then deleted text is highlighted.
  5. Given I select an earlier version for comparison, when the diff view opens, then modified text is identifiable.
  6. Given an earlier section version is available, when I restore it, then its content becomes the current section draft.
  7. Given a report has multiple sections, when I restore one section, then every other section's content remains unchanged.
  8. Given I have restored a previous section version, when I reopen the report, then the restored content is retained.
  </details>

- [ ] **RV-07** — Resume a partially completed review (risk engineer, Must, 1 pt, deps: RV-02, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: resume a review from its saved state, so long reports can be reviewed over several sittings.

  1. Given a partially completed report draft, when I press save, then the draft is saved despite logging out and back in.
  2. Given I previously accepted a finding, when I reopen the report, then that finding remains Accepted.
  3. Given I previously edited a finding, when I reopen the report, then its saved edited text is retained.
  4. Given I previously rejected a finding, when I reopen the report, then it remains excluded from the visible draft.
  5. Given a report was partly reviewed, when I reopen section navigation, then each section displays its saved review state.
  </details>

- [ ] **RV-08** — Amend a section manually (risk engineer, Must, 3 pts, deps: RV-01, Sprint 3)
  <details><summary>Goal / AC</summary>

  Goal: write a section the system could not draft, so missing AI content doesn't block report completion.

  1. Given a section is undrafted, when I enter content, then that section accepts manually authored text.
  2. Given a section is drafted, when I enter content, then that section accepts manually authored text.
  3. Given I have written part of a section, when I save it, then the content becomes part of the report.
  4. Given a manually written section has been saved, when I reopen the report, then its content is retained.
  </details>

- [ ] **RV-09** — Reorder report sections (risk engineer, Should, 3 pts, deps: RV-01, Sprint 3)
  <details><summary>Goal / AC</summary>

  Goal: change the order of report sections, so the report follows the required presentation order.

  1. Given a report has multiple sections, when I change their order, then the workspace displays the selected order.
  2. Given a section order has been saved, when I reopen the report, then the selected order is retained.
  3. Given a section order has been saved, when I export the report, then the export uses that order.
  </details>

- [x] **RV-10** — Find assessments/reports (risk engineer, Must, 2 pts, deps: CP-01, Sprint 1)
  <details><summary>Goal / AC</summary>

  Goal: search assessments or reports with their current status, so work needing attention can be identified.

  1. Given assessments or reports exist, when I open my work list, then each entry displays its site/date/status summary.
  2. Given my work list contains several states, when I apply a state filter, then only entries in the selected state are displayed.
  3. Given my work list contains multiple sites, when I search by site, then matching entries are displayed.
  4. Given my work list contains multiple clients, when I search by client, then matching entries are displayed.
  5. Given a report has been assigned to me, when I open my work list, then that report appears.
  </details>

## E8 — Evaluation Harness

- [ ] **EV-01** — Validate report evidence links and structure (risk engineer, Must, 3 pts, deps: GN-01, Sprint 4)
  <details><summary>Goal / AC</summary>

  Goal: deterministic checks of each generated report's evidence links and required structure, so missing evidence or content is detected consistently.

  1. Given a generated report contains a citation, when validation runs, then the citation passes only if it resolves to an existing source chunk or assessment observation, including chunks of withdrawn documents.
  2. Given a generated report contains a finding, when validation runs, then the finding fails the evidence check if it has no source citation or observation link.
  3. Given the required report sections are configured, when validation runs, then every missing required section is identified.
  4. Given a generated section has an approved Marsh template, when validation runs, then any departure from the required heading structure is identified.
  5. Given deterministic validation completes, when the run is saved, then its individual check results are retained under the evaluation run ID.
  </details>

- [ ] **EV-02** — Measure engineer acceptance of generated sections (knowledge admin, Must, 3 pts, deps: RV-02, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: review outcome rates for generated sections, so whether engineers find the output usable can be assessed.

  1. Given completed section-review actions exist, when the review report is calculated, then it shows the percentage accepted as written, edited, or rejected.
  2. Given a report section is selected, when the review report is filtered, then its outcome rates use only reviews of that section.
  3. Given outcome rates are displayed, when a stakeholder inspects a rate, then its denominator is visible.
  4. Given a selected section has no completed reviews, when its rate is displayed, then the report shows no data rather than zero percent.
  5. Given reviews span a recorded system change, when comparable before/after periods are selected, then their outcome rates are shown together.
  </details>

- [ ] **EV-03** — Record AI-call usage and performance (knowledge admin, Must, 3 pts, deps: none, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: measure each AI call consistently across features, so usage can be explained and model performance compared.

  1. Given an AI call completes, when its telemetry is recorded, then its elapsed duration is stored.
  2. Given an AI call completes with provider usage data, when its telemetry is recorded, then its input/output token usage is stored.
  3. Given an AI call completes, when its cost is calculated from recorded usage, then the estimated cost is stored with the pricing basis.
  4. Given an AI call is associated with a feature, when its telemetry is saved, then its feature identifier is stored.
  5. Given an AI call is associated with a report, when its telemetry is saved, then its report identifier is stored.
  6. Given an AI call is recorded, when its telemetry is inspected, then the billed service identifier is available.
  7. Given provider usage data is unavailable, when its telemetry is saved, then the missing usage is explicitly marked as unavailable.
  </details>

- [ ] **EV-04** — Report and export operating costs (knowledge admin, Must, 3 pts, deps: EV-03, Sprint 2)
  <details><summary>Goal / AC</summary>

  Goal: an exportable breakdown of system operating costs, so the ongoing budget can be assessed before wider adoption.

  1. Given recorded AI-call usage exists, when a cost report is opened, then cost totals are available per feature including chatbot.
  2. Given AI calls are linked to a report, when that report's cost view is opened, then its total recorded AI cost is displayed.
  3. Given cost records exist, when a service breakdown is selected, then costs are grouped by the individual billed service.
  4. Given a cost report is displayed, when export is selected, then a downloadable file reproduces the selected cost breakdown.
  5. Given recorded AI-call durations exist, when a feature's performance view is opened, then the latency summary for that feature is displayed.
  6. Given a usage summary is opened, when a feature is selected, then its recorded token usage is displayed.
  7. Given the cost report includes estimates or incomplete cost coverage, when totals are displayed, then the estimation basis or missing coverage is identified.
  </details>

## E9 — Knowledge Base Chatbot

- [ ] **CB-01** — Ask a knowledge question with a cited answer (risk engineer, Should, 5 pts, deps: RT-01, GN-02, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: ask a free-text question about a standard or regulation, so an evidence-backed answer can be found quickly.

  1. Given the chat interface is open, when I submit a non-empty free-text question, then a response is displayed in the current conversation.
  2. Given relevant source chunks are retrieved, when a factual answer is displayed, then its evidence-backed statements carry inline citations to those chunks.
  3. Given the shared generation guardrail configuration applies, when a chat answer is generated, then it is checked using that configuration.
  4. Given no relevant source is retrieved, when the response is displayed, then it explicitly states that the available evidence cannot answer the question.
  5. Given I ask multiple questions in an active session, when the conversation is displayed, then earlier exchanges remain visible in order.
  6. Given a chat response has been generated, when the conversation is saved, then the generated content is excluded from knowledge-base ingestion.
  </details>

- [ ] **CB-02** — Inspect the passage behind a chat citation (risk engineer, Should, 3 pts, deps: CB-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: open the original passage behind a chatbot citation, so the answer can be verified directly against its source.

  1. Given a chatbot answer displays a citation, when I select that citation, then the relevant source passage opens in a document preview.
  2. Given a cited source has a recorded name, when its preview opens, then the source name is displayed.
  3. Given a cited source has a page or section locator, when its preview opens, then that locator is displayed.
  4. Given a cited source has a recorded publication date, when its preview opens, then that date is displayed.
  5. Given a cited source is marked as outdated, when its preview opens, then an outdated-source warning is displayed.
  </details>

- [ ] **CB-03** — Ask follow-up questions in a conversation (risk engineer, Should, 8 pts, deps: CB-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: ask follow-up questions using current conversation context, so a topic can be explored without repeating information.

  1. Given a conversation has earlier exchanges, when I submit an unambiguous follow-up, then the response uses the relevant earlier context.
  2. Given newly retrieved evidence has higher authority under the approved source policy, when it contradicts earlier conversation context, then the answer follows the higher-authority evidence.
  3. Given a conversation is active, when I choose to start a new conversation, then the new conversation has no inherited query context.
  4. Given a follow-up cannot be resolved unambiguously from the conversation, when it is processed, then a clarification request is displayed.
  </details>

- [ ] **CB-04** — Collect feedback on chatbot answers (risk engineer, Could, 2 pts, deps: CB-05, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: rate a chatbot answer with an optional explanation, so the team can identify responses needing improvement.

  1. Given a chatbot answer is displayed, when I submit a helpful or unhelpful rating, then that rating is saved for the answer.
  2. Given I am submitting a rating, when I include a feedback reason, then the reason is saved with the rating.
  3. Given I submit a rating without a reason, when feedback is validated, then the rating is accepted.
  4. Given feedback is stored, when the evaluation team opens it, then the originating query-response record is accessible.
  5. Given the originating query-response record is opened, when its evidence is inspected, then the retrieved source references are available.
  6. Given unhelpful ratings exist, when the evaluation team filters feedback to unhelpful answers, then the matching feedback is listed.
  </details>

- [ ] **CB-05** — Audit the evidence behind chatbot responses (risk engineer, Could, 3 pts, deps: CB-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: a traceable record of each chatbot query and generated response, so the team can investigate problematic answers.

  1. Given a chatbot query is processed, when its audit event is saved, then the submitted query text is recorded.
  2. Given a chatbot query is processed, when its audit event is saved, then the event timestamp is recorded.
  3. Given an answer is generated, when its audit record is saved, then the response text is recorded.
  4. Given passages are retrieved for an answer, when its audit record is saved, then the retrieved document/chunk references are recorded.
  5. Given a model-generated answer is recorded, when its audit details are opened, then the applicable model/prompt version references are available.
  6. Given user or session information is captured, when an audit record is written, then that information follows the approved access policy.
  7. Given feedback or evaluation relates to a logged exchange, when its audit record is opened, then the corresponding linked record is accessible.
  8. Given an audit record reaches the approved retention limit, when the retention process runs, then the record is handled according to the retention policy.
  </details>

- [ ] **CB-06** — CRUD for personal chatbot conversations (risk engineer, Could, 3 pts, deps: CB-01, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: save and revisit previous chatbot conversations, so useful research doesn't need repeating.

  1. Given a chatbot exchange completes, when the conversation is updated, then the exchange is saved automatically.
  2. Given saved conversations exist, when I open history, then my previous sessions are listed.
  3. Given I select a saved session, when it opens, then its recorded exchanges are displayed in order.
  4. Given I own a saved session, when I save a new session name, then the new name appears in history.
  5. Given I own a saved session, when I confirm its deletion, then it is removed from my available history.
  6. Given a user lacks permission to access a saved conversation, when they request it through the interface or API, then access is denied.
  7. Given I reopen my saved session, when I submit a further question, then it is added to that same conversation.
  </details>

## E10 — Export & Handover

- [ ] **EX-01** — Export finished report to file (risk engineer, Must, 2 pts, deps: RV-04, RV-09, CP-04, Sprint 5)
  <details><summary>Goal / AC</summary>

  Goal: export the completed, reviewed report into Marsh's report template, so the report leaves the tool in the format the existing process expects.

  1. Given a completed, reviewed report, when I export it, then it matches Marsh's section structure and template.
  2. Given a completed report, when I export it, then DOCX or PDF can be chosen, and structure and citations are preserved in either.
  3. Given the engineer has selected and ordered appendix content, when the report is exported, then Appendix A site photos and Appendix B site map are included in that order.
  4. Given outstanding review items remain, when I attempt to export, then export is only allowed once they are cleared or explicitly overridden.
  </details>

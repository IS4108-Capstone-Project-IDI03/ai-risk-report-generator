Per-service internals: ingestion pipeline stages, RAG orchestrator flow, speech/OCR processor notes go here.

## Speech (S5) and voice transcription (CP-03)

1. The client saves an observation with its recordings to the gateway, which
   stores each recording in S3 and saves it as `transcribing` (see
   [database](database.md#observations)).
2. The gateway posts `{ "s3_key": ..., "privacy": ... }` to S5's `POST /transcribe` (via
   `SPEECH_OCR_SERVICE_URL`) without making the client wait. `privacy` is the
   assessment's (`privacyFor`), for the tidy step below.
3. S5 reads the audio from S3 with boto3 and sends it to the OpenAI Whisper API
   (`WHISPER_MODEL`, default `whisper-1`; needs `OPENAI_API_KEY`). The file name
   keeps the key's extension, which Whisper uses to pick the decoder. S5 tidies
   the text (see "Tidying a transcript" below) and returns
   `{ "transcript": <tidy>, "spoken": <Whisper's own>, "segments", "usage" }`, or
   502 with `detail` explaining the failure. It writes nothing to MongoDB.
4. The gateway stores the tidy text as `transcript` and Whisper's as `spoken`, or
   the failure reason, on that recording. The client re-reads the list every 3
   seconds while a recording is transcribing.

Transcription runs on the gateway's `transcriptionQueue`
(`background-queues.service.ts`), which retries a busy or unreachable S5. If the
gateway restarts mid-attempt, startup marks that attempt failed with a reason,
so the engineer can retry it instead of waiting forever.

### Tidying a transcript (S5, CP-27)

Every transcript S5 returns, from `/transcribe` and `/transcribe-clip`, is tidied
in `_whisper()` (`app/processors/stt.py`), so recordings, walk recordings,
spoken chat questions and dictation all go through it. Tidying only ever
**deletes** words; it never adds, changes or moves one. Transcripts are English
(`language="en"` is pinned).

1. **Prompt.** Whisper copies its prompt's style, so both prompts
   (`RECORDING_PROMPT`, `CLIP_PROMPT`) are fluent sentences with no "um" or "uh",
   holding the fire-protection terms it otherwise mishears. They are S5's own
   fixed text: no client words.
2. **Rules** (`app/processors/tidy.py` `rules`, no model): the fixed `FILLERS`
   list (um, uh, er, erm, hmm…), a word or phrase of up to 3 words said twice in
   a row ("the the"), and stutters ("s- sprinkler", "s-s-sprinkler"). Kept as
   spoken: repeated numbers ("room ten ten"), grammatical doubles ("that that",
   "had had", "is is"), hyphenated words ("re-reading") and words that can carry
   meaning ("no", "well", "like", "you know", "I mean"). A word joins a list
   only with a test beside it (`tests/test_tidy.py`). Segment texts get the rules
   only; their timings are unchanged.
3. **Model** (`tidy.repair`), for what rules can't judge: the abandoned half of a
   self-correction ("level 3, sorry, level 4" becomes "level 4"), false starts
   and leftover fillers (Singlish particles such as "lah" are left to it, as
   "meh" can make a question). Provider `TIDY_PROVIDER` / `TIDY_MODEL`, falling
   back to `VISION_PROVIDER` / `VISION_MODEL`; only Gemini is implemented. Its
   answer is used only as a choice of which spoken words to drop: the words kept
   are the speaker's own, punctuation included. The answer is **not used**, and
   the rules' text stands, when it:
   - adds, changes or moves a word;
   - deletes more than a quarter of the words (4 in a short clip);
   - drops a number without also dropping a correction word ("sorry", "I mean",
     "no", "actually", "wait", "rather", "correction", "scratch").

   It runs only when the gateway sends `privacy`. The text is masked through
   privacy-service first (see [privacy](privacy.md)); if masking fails, the model
   is not called. A model error never fails the transcription either. Its call is
   reported as `tidy-transcript` usage (billed `gemini-vision`).

### Dictation (gateway, CP-27)

`POST /api/assessments/:reference/dictation`, raw `audio/*` body up to 2 MB, answers
`{ text }`: the clip goes to S5's `/transcribe-clip` with the assessment's privacy
and is stored nowhere (`dictation.routes.ts` → `dictation.service.ts`). It needs a
session (401) and an assessment the caller can open (403, 404); 415 for a file
that is not audio, 413 too large, 400 empty, 422 when no speech was heard, 503
when S5 fails. It changes nothing in the assessment, so MarshBot does not
re-check it (`NOT_CHANGES` in `assistant-recheck.middleware.ts`).

The client's `DictateButton` (`client/src/features/assessments/dictation/`) puts
the text in at the field's cursor, in place of a selection. It records with
`useRecorder`, shared with the chat's mic (CB-10). It is on: an observation's
note (and a walk proposal's), New Observation's Note tab (in a live assessment,
not the demo), a walk's note box and a walk note being edited (neither while the
walk records), the transcript and handwritten page text corrections, comments
(inside a `DictationScope`), the Ask question box and a checklist answer's "What
you saw". The rule: Dictate is for notes and questions inside an assessment, not
for the report's own wording (Edit finding, the Review edit, the Regenerate
instruction), and never outside an assessment, as masking needs its reference.

Running S5 outside Docker: `.env` points `SPEECH_OCR_SERVICE_URL` at
`http://localhost:8003` (Compose overrides it with the Docker hostname). If a
recording fails with "The speech service could not be reached", S5 is not running or
the gateway was started with the Docker hostname. S5 also needs the AWS
credentials, `S3_BUCKET` and `AWS_REGION` from `.env`.

### Site walk additions (S5, CP-22)

- `POST /transcribe` returns Whisper's `segments` (`start`, `end`, `text`, seconds into the
  recording) beside `transcript`. Its vocabulary prompt is S5's own fixed text
  (CP-27): no client words are sent to Whisper, because client text must not
  reach an external AI unmasked and speech-to-text is not masked.
- `POST /describe-photo` `{ s3_key, privacy? }` returns `{ description, usage, privacy }`: one or two
  plain sentences of what one site-walk photo shows, from `VISION_PROVIDER` /
  `VISION_MODEL`. Only the photo is sent, no client text. The proposal step
  uses the description to match the photo to a finding. With `privacy` on, faces are
  blurred first and, with `check_answers`, the description is checked, as for `/interpret`
  (PV-08, see [privacy](privacy.md)); if privacy-service fails it answers 502. Left out, the
  photo is described as before.
- S5 still writes nothing to MongoDB.

### Site walk uploads (gateway, CP-22)

Only `PUT .../site-walks/:id/photos/:photoId` and `.../recordings/:seq` take these formats, through
`media-form.ts` and `media-convert.service.ts`. Every other upload route stays JPG and PNG.

- Photos: JPG and PNG are stored byte for byte. HEIC, HEIF, WebP, AVIF, GIF, TIFF and BMP become a
  JPEG, so everything stored stays JPG or PNG and nothing downstream changes. 20 MB limit.
- Recordings: a format Whisper reads (WebM, Ogg, MP4, M4A, MP3, WAV, FLAC) up to 25 MB is stored byte
  for byte. Anything else becomes mono AAC in `.m4a`. 100 MB limit before conversion, 25 MB after,
  20 minutes long. The length comes from the file, not the client.
- The bytes are untrusted: the format is read from them, never from the name or reported type. ffmpeg
  runs without a shell, limited to audio demuxers and local files, and is killed after 120 s.
- `POST .../recordings/:seq/retry` re-queues a failed recording, with no limit on tries.
- `DELETE .../recordings/:seq` and `.../photos/:photoId` remove the item and its stored file while the
  walk is recording. The client waits out a 10 s Undo before calling them, and Finish waits for them.

## Reading an observation (S5, rag-service, CP-05, CP-21, CP-24)

Nothing is asked for. When an observation is saved, or its media or a
transcript changes, one background job reads it. It does two things: S5
describes the photos, and rag-service suggests the category and severity the
engineer left empty (see [database](database.md#observations)). The engineer
checks the result; there are no buttons that start a reading. Before CP-24 an
engineer asked for it (Get AI proposal, Describe photos), and S5 also proposed
categories; that half is gone from S5, the gateway and the client.

### Photo description (S5)

1. The gateway posts `{ "photos": [{ label, s3_key, region? }], "texts": [{
   label, kind, text }], "location": ..., "privacy": ... }` to S5's `POST
   /interpret`. `texts` holds only the note, as a hint for what to look at.
   Each photo's label is its own name; a name that repeats (phones name every
   photo `image.jpg`) is numbered, `image.jpg (2)`, and the note's label
   `Note` counts too, since S5 refuses labels that repeat. The location
   is where the observation was made, most specific first ("Pump room, Level
   43, Tower 1"; see `locationText`). A photo the engineer marked (CP-10)
   carries its `region` (`{ x, y, w, h }`, fractions of the upright photo); an
   unmarked photo has no `region` key. The request is refused (422) without
   photos. An old gateway may still send `parts`; S5 ignores it.
2. S5 (`app/processors/vision.py`) reads each photo from S3, turns it upright
   from its EXIF orientation, shrinks it to 1600 px on the long edge and
   re-encodes it as JPEG for the model only; the original in S3 is never
   changed. For a marked photo it also cuts the marked area from the upright
   photo at full size, before shrinking, so a small area keeps its detail,
   and sends it as an extra image labelled `"<photo name>, marked area"`
   right after its photo. The close-up is not an item: the prompt names only
   the photos, and the rule added only when a photo is marked (`MARKED_RULE`)
   says to describe the marked area, use the full photo for context, and
   cite the close-up by its photo's name. A box drawn on the photo was ruled
   out because the model can read it as paint or tape.
3. With the gateway's `privacy` enabled (PV-04), S5 has privacy-service blur
   the faces in every photo and close-up (`POST /redact-image`, one call) and
   mask the note and location (`POST /mask`, one call), fails closed if either
   fails, and restores real values in the answer. With `check_answers` (the
   gateway's `PII_CHECK_ANSWERS`, on by default), it first takes details the
   model added out of the description (one more `/mask` call); see
   [privacy](privacy.md).
4. It sends each photo after its label, then the note, to the provider named by
   `VISION_PROVIDER` (only Gemini is implemented: `VISION_MODEL`, default
   `gemini-3.8-flash`, needs a paid-tier `GEMINI_API_KEY`, with `store:
   false`), and asks for a fixed answer: `description`, in the form Marsh's
   reports use ("During the site visit to …, it was observed that …"), stating
   only what the photos show, whatever the note claims; and `hazard_type`, one
   of the OFI Types in Marsh's sample reports, `Other`, or `No hazard visible`,
   so the model never has to invent a hazard.
5. S5 returns `description` and `hazard_type` with the provider, model,
   `prompt_version`, token `usage` (null when the provider reports none) and
   `redacted_photos`, or 502 with `detail`. Like transcription, it writes
   nothing to MongoDB.
6. The gateway (`observation-reading.service.ts`, `describePhotos`) stores the
   description in `interpretation.photoReading` with its attempt, the photos
   and marks it read, and its provenance, or the failure reason. It saves the
   call to `ai_calls` (EV-03) as `interpret-photo` (labelled "Observation
   reading"; the id is kept so earlier readings stay on one line), billed to
   `gemini-vision`, tagged with the assessment: thinking tokens are added to
   output tokens, since Google bills them as output, and the duration is the
   gateway's own timing of the request (S5 sends none). A failed request
   returns no usage, so nothing is saved.
7. The description is out of date once photos are added or removed or a mark
   moves (CP-10): the next run describes again. It is never drafting evidence
   by itself: drafting does not read it. It reaches a draft only if the
   engineer copies it into the note (Copy into note). The suggestion below
   does read it, with the rest of the observation's text.

### Suggested category and severity (the reading job)

The job is `runReading` in `server/src/services/observation-reading.service.ts`.
Its queue is `observation-reading` (BullMQ, as for transcription), with
concurrency 3 and 2 tries, 5 seconds apart. A job survives a restart.

**What queues it.** `queueReading` is called after: saving (including one
turned from a draft observation), adding media, removing or restoring a
recording, photo or page, marking or clearing a photo, correcting a transcript
or a page's text, changing the note (only when it actually changed), a
recording or page finishing or failing its transcription, restoring a deleted
observation (a reading skipped while it was deleted runs now), restart
recovery, creating an observation from a site walk (below), and Try again
(`POST /api/observations/:id/suggestion/retry`). Try again is accepted after a
failed suggestion or a failed photo description; anything else answers 409.
Confirming or changing a category or severity queues nothing.

**Site walk observations are not rated.** `suggestion.rate` is a stored flag;
missing means true, and the API does not return it. An observation created
from a site walk is queued with `rate: false`: its photos are described, but
its category and severity are not rated again, so the proposal's values and
not-sure marks stay as the walk gave them (AC17: the mark must carry from the
proposal onto the created observation, and a new rating could change or clear
it). A transcription finishing, restart recovery and a restore leave the flag
as it is. The engineer's own changes (media added, removed or restored, a
photo marking, a transcript or page correction, a note edit, Try again) set it
to true, and from then on the observation is read like any other.

**One job per observation, with a run number.** `queueReading` does one atomic
write: it adds 1 to `suggestion.run`, sets `suggestion.status` to `reading`
(or `done` when both fields are the engineer's), resets `attempts` and clears
`error`. Then it adds a job with the id `obs-reading-<observation id>-<run>`.
Every write the job makes matches `suggestion.run: <its run>`. Without that, a
trigger arriving while a job runs, or an older job Redis kept after a restart,
could write last and bring back text that is out of date; a stale run writes
nothing, and the newer run does the work. If Redis cannot take the job, the
suggestion is stored as `failed` with a message, so it never reads for ever.

**The steps** (`runReading`):
1. Stop if the run is stale. If the observation is deleted, is a draft, or its
   assessment is archived, mark the run `done` and stop.
2. Describe the photos first if they have no description of what they are now
   (above), as the system and not as a user. The description step starts
   atomically on the photo reading's own status, so two jobs never describe
   twice. If the description fails it is stored as failed and the rating goes
   on without it.
3. Wait while any kept recording or page is `transcribing`: the transcript
   finishing queues a new run, so this one just stops.
4. If rating is off (`suggestion.rate` is false), both fields are the engineer's,
   or there is no text at all, mark the run `done` and stop. With no text (for example the only recording failed to
   transcribe) the empty fields stay empty and the observation stays to check.
5. Join the text the rating reads, by blank lines: the note, each kept
   recording's and page's finished transcript (the engineer's correction where
   there is one), and the photo description when it matches the photos kept
   now. Call rag-service `POST /observations/rate` (below).
6. Fill each field that is still open at the moment of writing, in one update
   that checks it inside MongoDB: an open field is empty or still holds an
   unconfirmed suggestion. A value the engineer chose while the call ran is
   kept. The category is stored as a list of one (`metadata.COPE_dimension`)
   and the severity in `severity`; `suggestion.category` and
   `suggestion.severity` are set to `{ notSure }`. The status becomes `done`.
7. Tell the open page (below) and queue MarshBot's re-check (AS-06).

**Failure.** The first failure of a call is thrown, so BullMQ tries again after
5 seconds; the second is stored: `suggestion.status: 'failed'` with "The
category and severity could not be suggested." If masking was unavailable
(rag-service answers "Client details couldn't be protected…"), nothing was
sent, trying again at once would not help, and the failure is stored on the
first try with rag-service's own message. The fields stay as they were. The
engineer can press Try again.

**Restart.** `resumeReadings` runs at startup before the workers start. For
every observation with `suggestion.status: 'reading'` or a photo description
`interpreting`, it marks the description failed ("interrupted by a gateway
restart") and queues a new run, which describes the photos again and rates. The
new run number makes any older job Redis kept stale. A handwritten page cut
short is marked failed and queues a run too (`resumeInterruptedTranscriptions`),
since a run was waiting for it.

**Cost.** The rating's usage is saved to `ai_calls` (EV-03) under the feature
the site walk's rating step already uses, `site-walk`, tagged with the
assessment.

**Push, not polling.** After each change the job calls `publishObservations`
(`assistant/bus.ts`). The assessment's assistant stream, `GET
/api/assessments/:reference/assistant/events` (the same one MarshBot and
drafting use), then sends `event: observations`, and the open Observations tab
and observation page read the observations again. No new polling was added
(`.local-docs/adr/0002-push-assistant-updates-no-polling.md`). The tab's own
poll every 3 seconds while a recording or page is transcribing stays as it was.

### Rating one observation (rag-service, `POST /observations/rate`)

`app/site_walk/observation_rate.py`, called by `routes.py`. It is the site
walk's rating step (see "Site walk proposal"), run on one observation's text.

- Request `{ text, privacy? }`, no unknown fields; `text` is the joined text
  above and must not be empty (422).
- 1. **Mask** the text with `privacy_session(privacy).mask`, the same privacy
  session as the site walk. If privacy-service fails, nothing is sent and the
  route answers 502 ("Client details couldn't be protected…"). 2. **Rate** it
  with `propose._rate`: the same classifier (Jev), the same severity matrix and
  the same cutoff, `SITE_WALK_CHECK_BELOW` (0.70, unchanged). The observation is
  rated on its own, with no walk around it, and there is no place matching.
  3. Return `{ category, severity, check: { category, severity }, usage }`.
  `category` is one of the four COPE categories (never several, never none) and
  `severity` one of the four levels. A `check` flag is true when the
  classifier's probability for that value is under the cutoff: the value is
  still returned, and the gateway stores it marked not sure. The category and
  severity are single words from fixed lists, so nothing needs unmasking.
- A classifier failure answers 502, as the site walk does.
- The probabilities are not returned; only the eval reads them.

### Draft observation (transcribing before Save)

So a recording added on New Observation can transcribe before the engineer
saves, the first one creates a hidden draft observation (`draft: true`, no
location):
- `POST /api/assessments/:reference/observations/draft` takes `recording` parts
  and an optional `draftId`; without one it creates the draft. Each recording
  is stored in S3 and transcribed as a saved one is, and 201 returns `{ draft }`.
- `GET /api/observations/:id` returns one observation, so the page can read the
  draft's transcripts as they arrive.
- Saving sends `details.draftId`. The draft becomes the observation: `draft`
  is cleared in one update that matches on it, so a discard or a second Save
  cannot race it, and the reading job is queued.
- `DELETE /api/observations/:id/draft` discards it and its recordings' files
  (when New Observation is left without saving). 404 for an observation that
  is saved. It deletes the stored files first and the record only when every
  file went; on a storage error the draft is kept for the hourly cleanup and
  the route still answers 204, since the engineer has left.
- Removing a draft's recording deletes it and its file for good, file first and
  the record only once the file went. On a storage error it answers 409 "This
  recording could not be deleted. Try again." A saved observation's removal
  stays soft.
- A Save that brings nothing of its own (no note, recording, photo or page) is
  refused (400) if the draft's only recording was removed meanwhile; the
  update that clears `draft` matches on a recording still being there.
- An hourly job (`observation-draft-cleanup`, BullMQ, `0 * * * *`) deletes
  drafts unchanged for 24 hours (by `updatedAt`, so adding a recording keeps an
  open form's draft alive), with their files, files first as above. A draft
  whose files could not all be deleted stays for the next run.
- A draft is in no list, count, drafting input, Ask, appendix, MarshBot check
  or report: `listObservations` and `listObservationsOf` leave it out, and
  they are what those read. The reading job does nothing on one.

### Evaluation

The photo descriptions are set beside Marsh's by
`microservices/speech-ocr-service/eval/`, `eval.interpret_photos`. The category
proposals' own evaluation was deleted with them.

The rating is scored by `eval/site_walk/rate_eval.py` in rag-service. It takes
each golden finding's note from a saved site walk result (so no model reading
is paid for again), rates it alone as the route does, and scores it against the
sample reports' category and severity: agreement, the share marked not sure,
and how often a value is right when it is not marked. It is paid (one Jev call
per finding, needs `TYPESAFE_API_KEY`) and outside CI. From
`microservices/rag-service`:

```
uv run python -m eval.site_walk.rate_eval --split held-out
uv run python -m eval.site_walk.rate_eval --split tuning --sweep
```

`--sweep` also scores cutoffs 0.50 to 0.95. Results go to
`eval/results/<date>-observation-rate[-split].json` and the scoring is
unit-tested in `tests/test_observation_rate_eval.py`.

Recorded on 20 Nov 2026 at the cutoff of 0.70, with the classifier the site
walk uses (no language model reads the observation):

| Split | Findings rated | Category agreement | Severity agreement | Right when not marked (category / severity) | Marked not sure (category / severity) |
| --- | --- | --- | --- | --- | --- |
| Held-out | 79 (13 skipped: no saved note) | 1.000 | 0.835 | 1.000 / 0.900 | 5.1% / 24.1% |
| Tuning | 145 | 1.000 | 0.862 | 1.000 / 0.933 | 5.5% / 28.3% |

The held-out severity is one finding short of the 0.84 target. 13 of the 16
held-out cases had saved notes. Cost was about US$0.011 for both runs. The
cutoff stays 0.70. On the tuning sweep 0.75 gives 97% severity right when not
marked, but marks 35% of severities as not sure. The notes are the site walk's
clean notes, not an engineer's raw text, so this is a first check of the
rating on one observation at a time and not of real manual notes.

Running S5 outside Docker: as for transcription, plus `GEMINI_API_KEY`.

## Handwritten pages (S5, CP-19)

An engineer can photograph pages of their handwritten site notes in Scan mode
on the capture screen. Each page is transcribed word for word, as a recording
is (CP-03), and becomes drafting evidence.

1. Saving an observation with `page` parts stores each page in S3 as
   `transcribing`, with one attempt (see
   [database](database.md#observations)), and the gateway starts
   `runPageTranscription` for each without making the client wait.
2. The gateway posts `{ "s3_key": ... }` to S5's `POST /transcribe-handwriting`.
3. S5 (`app/processors/handwriting.py`) reads the page from S3 and prepares it
   as a photo is (`images.upright_jpeg`: upright from EXIF, at most 1600 px,
   JPEG). It sends it to the provider named by `HANDWRITING_PROVIDER` (only
   Gemini is implemented; `HANDWRITING_MODEL`, both defaulting to photo
   reading's `VISION_PROVIDER` and `VISION_MODEL`; paid-tier `GEMINI_API_KEY`,
   `store: false`, temperature 0; one retry at most and 90 s per attempt, as
   the SDK's own three untimed retries held a rate-limited page past the
   gateway's five-minute wait), prompt `cp19-v1`:
   - write the handwriting word for word, a line per line of writing, keeping
     abbreviations, numbers and spelling as written; never expand, correct or
     add a word;
   - leave out crossed-out words, drawings and printed text, except a printed
     label the handwriting fills in;
   - give a best guess for a word it can't read for certain, marked
     `uncertain`; never leave a word out because it is hard to read;
   - return no lines for a page with no handwriting.
   The answer is structured (lines of `{ text, uncertain }` words), so which
   words are uncertain comes back as data. Code joins it into `transcript` and
   the `[start, end)` positions of the uncertain words, counted in UTF-16 units
   for the browser. S5 returns those with the provider, model, `prompt_version`
   and `usage` (EV-03: `transcribe-handwriting`, billed to `gemini-vision`,
   thinking added to output), or 502 with `detail` (the page could not be read
   from storage, opened, or transcribed, including a blocked answer). It writes
   nothing to MongoDB.
4. The gateway records the usage, then stores the transcript, the uncertain
   words and the provenance on the page, or the failure reason, mapped from
   S5's message prefixes to a readable one: a used-up usage limit (429), a
   busy service (503) and a slow answer each say so; Node's own five-minute
   wait running out reads "took too long to answer", not "could not be
   reached". A failure can be retried; a
   restart marks a running attempt failed (`failInterruptedTranscriptions`
   covers recordings and pages). The client re-reads the list every 3 seconds
   while any page is transcribing.
5. The Observations tab shows each page with its original (opened to zoom
   into), its transcript behind the AI rule with each uncertain word underlined
   and counted, "No handwriting was found on this page." for an empty one, or
   the failure with Retry transcription. A finished page offers Transcribe
   again (CP-20) to the assessment’s assigned engineer (`POST
   /api/observations/:id/pages/:pageId/retranscribe`), which clears its text,
   and any correction, and runs steps 2-4 once more; for a corrected page the
   browser asks first. All Handwritten Pages, opened from the location
   navigator beside All Photos and All Recordings (CP-12), lists every page
   of the assessment's observations not deleted, each with its state, Retry,
   and its transcript to open, shown the same way; its text opens the
   observation. Its search (CP-13, in the browser) looks in the text as
   shown, the correction or else the model's reading, and marks the words
   found inside any uncertain word's underline.
   Drafting uses the text as transcribed, or as the engineer corrected it; the
   uncertain marks are for the engineer and are not sent to S4.
6. The assigned engineer manages a saved observation's pages (CP-20) as
   CP-08 manages its recordings and photos: Edit text corrects a finished
   page (`PUT …/pages/:pageId/transcript`, the model's text kept beside the
   correction, which is shown as the engineer's, with the transcription and
   its uncertain marks folded away under "As transcribed"); Add media adds
   pages, each transcribed through steps 2-4; Remove sets the page aside
   (`DELETE …/pages/:pageId`) and Removed media restores it (`POST
   …/pages/:pageId/restore`). A page kept by the demo without a capture
   session is never transcribed: its text can be written by hand, and pages
   added, removed and restored, in that browser only. No S5 change: pages
   added later go through the same `POST /transcribe-handwriting`.

Measuring it: `microservices/speech-ocr-service/eval/transcribe_handwriting.py`
reads each `<id>.jpg|png` and `<id>.txt` pair in `eval/cases/handwriting/` (see
its README for how to write one) through the same code and scores word
accuracy (case, edge punctuation and line breaks ignored; abbreviations must
match) and how many wrong words were marked uncertain. Run by hand, as it calls
the paid API: `uv run --extra dev python -m eval.transcribe_handwriting`. Each
run writes a summary to `eval/handwriting/<date>-<model>.md`.

## Knowledge document ingestion (IN-01)

1. The admin drops or picks files on the Knowledge base screen: PDF, Word
   (DOCX, DOC), PowerPoint (PPTX, PPT), RTF or ODT. Nothing else is asked
   (IN-05). The client sends one `POST /api/knowledge-documents?fileName=…` per
   file as soon as it is added, so a rejected file never blocks the others.
2. The gateway first fingerprints the file (sha256) and rejects it with 409 if a
   stored document that is not failed has the same fingerprint, on its PDF or
   its `original` (IN-07): no conversion, no `/inspect`, no `/label`, no S3
   write and no job. Then it reads the file's type from its bytes (the
   Content-Type is ignored) and rejects anything not on the list above (415). A
   non-PDF is converted to PDF by the `converter` service (Gotenberg, which runs
   LibreOffice; `CONVERTER_SERVICE_URL`): 422 if it cannot read the file (a
   corrupt file comes back as a 500), 503 if it is down, busy or past its
   120 s limit. Every later step, S3 included, holds only that PDF (IN-16).
   Then it asks the ingestion service's `POST /inspect` to open the PDF with
   PyMuPDF (422 with the reason if it is corrupt, password-protected or has no
   pages). Nothing is stored for a rejected file.
3. The gateway asks the ingestion service's `POST /label` for the file's
   details (IN-05, see "Automatic labelling" below; 180 s timeout). If labelling
   fails, the upload still goes ahead with every detail Unconfirmed. The
   document's id is chosen before this call, so `/label`'s paid calls are
   saved to `ai_calls` against it (EV-03), even if a later step rejects the
   upload.
4. The gateway stores the original in S3 at `knowledge/<id>.pdf`, records it in
   `knowledge_documents` as `queued` and adds a BullMQ job (`jobId` = document
   id) to the `ingestion` queue in Redis. If the queue is down, it removes the
   record and the file and answers 503. If labelling couldn't read the source
   type, it records the document as `awaiting_type` instead and queues nothing
   (IN-19): Recent uploads shows it as Type needed with a type select, and
   Start ingestion (`POST .../source-type`) saves the type and queues the job.
   The worker would redact a document with no type as a precaution (PV-05),
   which garbled standards set in Type3 fonts.
5. `ingestion-worker` (same image as the ingestion service, `python -m
   app.worker`, concurrency 1) claims the document, downloads the original,
   runs `app.pipeline.run(path, doc_id=<id>, labels=..., reporter=<ProgressReporter>)`
   so chunk ids are `<id>:<n>` and every passage carries the document's
   labels (KB-01; an Unconfirmed one is left out, and `status` is
   `needs_review` until the match step below has finished) and its own `section`
   (IN-05, the report section it sits in, `Not applicable` or `Undefined`).
   With protection on, a past report is redacted before parsing (PV-05,
   scanned pages included), its picture crops have faces blurred before the
   OCR model reads them, and its passage text is masked once more before
   embedding (PV-06); see docs/areas/privacy.md.
   Parsing converts the PDF in 10-page batches (`DOCLING_DOCUMENT_TIMEOUT`
   limits each batch), joins them, and then assigns heading levels in one pass
   over the whole document with the PDF's bookmarks and font styles, so a
   heading is ranked against those in every batch. The `ProgressReporter` writes each stage transition to the
   `ingestion_jobs` collection in MongoDB (E2), and the gateway merges this into
   the `KnowledgeDocument` DTO as `progress` while the document is `processing`.
   Then the worker runs the match step (IN-07, see "Matching" below) and gives
   the passages their final `status`.
   The worker records `complete` with counts and the `match` or `failed` with the reason on
   `knowledge_documents` as before. After recording it, the worker posts a notification
   for knowledge admins to the gateway (IN-10, `app/notifications.py`): "finished
   ingesting" or "failed", or, when the finished document needs review (IN-07),
   '"<title>" needs review.' with the list's reason as details and
   `context.status: needs_review`, which the Inbox opens as the Review page (F-10:
   the gateway files `failed` and `needs_review` in the Inbox and `complete` in the
   bell, from `context.status`, so the worker does not change). A job whose worker died mid-run is
   redelivered by BullMQ and processed again.
   Whatever the outcome (complete, failed or cancelled), the worker then posts
   what the document's paid calls used to the gateway's
   `POST /api/internal/ai-usage` (EV-03, `app/usage.py`, same service key as the
   notification), which prices and saves them to `ai_calls`. The OCR providers
   (`anthropic_ocr.py`, `gemini_ocr.py`, self-hosted GLM in `ocr_model.py`) and
   the embedder record each answered request; the worker sums them into one item
   per feature (`ocr`, `embed-document`), billed service and model, with a
   `call_count`. Calls that reported no usage are summed apart as unavailable.
   One collection per process behind a lock, not a ContextVar, because OCR runs
   in a thread pool; with concurrency 1 there is only ever one document. A
   failed post is logged and dropped, like a notification. Labelling's OCR
   (`app/labelling/pages.py`) is Docling's local engine, so it records nothing.
6. The client re-reads `GET /api/knowledge-documents` every 3 seconds while any
   document is queued or processing, showing each processing document's stage,
   elapsed time and, while parsing or chunking, the page reached out of the
   document's page total from `progress` (E2). Pages are shown rather than a chunk count because
   the chunk total is not knowable up front.

### Tables, columns and what search reads (CB-01)

- **Column order.** After the batches are joined and before headings are ranked,
  `app/pipeline/columns.py` puts each two-column page in column order: blocks much
  narrower than the page that fall in two clusters with a gap between are columns,
  full-width blocks split the page into bands, and each band reads the left column,
  then the right. A page without a gutter keeps Docling's order. After parsing,
  clause numbers that run backwards inside a chapter (29.4.3 then 29.2.5) are logged
  as warnings, so a page still out of order shows in the ingestion log.
- **Tables.** The OCR provider reads a crop as `tables`: per table a printed title,
  `header_rows`, `header_cols` and the grid (`chunking_helper/ocr_prompts.py`). Code
  flattens it (`chunking_helper/table_text.py`): a column is labelled by the path of
  its heading cells ("Inside Hose > gpm"), a row by its heading columns, and
  heading rows are never stored as data. A crop with two tables gives two passages.
  The first passage's title is Docling's caption when it has one, else the title in
  the image. A table over about 1,400 characters is cut between rows into groups
  that each repeat the title; ids are `<id>:table:<n>[:t<j>][:g<k>]`. The GLM path
  still guesses the header and has no title.
- **Formulas.** A chunk is read as a formula when Docling labels one of its items
  FORMULA, or when a line of its text has `=` and at least two arithmetic steps
  between numbers (`chunker._looks_like_equation`). The second catches equations
  written as ordinary text, such as Word fractions, which Docling's layout model
  does not label and whose text layer comes out flattened. The whole chunk is
  cropped and its reading replaces the chunk's text; an empty reading keeps
  Docling's. In a chunk with a picture, each text item that is an equation is
  cropped on its own and replaced in the picture passage's prose, since a crop of
  the whole chunk would take in the picture. Docling's formula enrichment stays off: it only decodes items already
  labelled, so it finds nothing more.
- **Unusable answers.** Claude's safety filter sometimes refuses a crop, at
  times partway through the JSON (FM-200 agent tables). `anthropic_ocr` validates the
  answer itself and asks once more; `gemini_ocr` does not ask again (temperature 0) and
  logs Gemini's `status`. If the answer is still unusable, the table parser reads the
  table's rows from the PDF text (PyMuPDF `find_tables`, strategy `text`): one record
  per row, words in reading order, no headings. With no text layer or fewer than 2 rows
  it stays unread; formulas and pictures are left unread. Nothing fails the document.
  Each attempt is logged with its `stop_reason`, and the fallback with its page. An
  answer that finds no table is not unusable: that table is still read as a picture.
- **Passage metadata** gains `position` (the chunk's number in reading order),
  and table passages `table_id` (shared by a table's groups) and `table_title`.
- **Heading trails** (`chunker._build_section_trails`). Each passage's `headings` is
  the stack of headings above it. A heading text on 3 or more pages, and on more than
  20% of them, is a running header or a watermark Docling read as a body heading
  ("25 NFPA ®", "EDUFIRE") and is in no trail; a "Table/Figure … Continued" label is
  skipped, so the clause trail before it carries on. Heading text is normalised:
  whitespace collapsed, NFPA's `Δ`/`N` change markers and a clause number's Annex `*`
  removed (IN-19). The picture reader's `Section:` line is the same trail.
- **What search reads.** The embedder and the reranker both see the heading trail
  and then the text (`indexer.embedding_text`, `retriever.rank_text`; change them
  together), while the stored text, quotes and pages stay plain. Short forms in a
  question ("EH2") are spelled out first (`retrieval/glossary.py`). Chat widens its
  best 3 hits to the rest of their table, or to the passages either side by
  `position`, up to 3 extra passages and 3,000 characters per hit
  (`retriever.widen`); withdrawn and unconfirmed passages are never added.
  Drafting does not widen.
- Passages indexed before this have no `position` or `table_id` and are not
  widened; re-ingest a document to get the new passages.

### Pictures (IN-13)

- **Finding them.** Docling's layout model labels photos, diagrams and charts as
  pictures. The chunker's serializer writes a placeholder for each
  (`PICTURE_PLACEHOLDER`), so the picture and its bbox reach its chunk; the
  placeholder never reaches passage text. Pictures under 72 pt on either side
  (logos, icons) are treated as absent (`picture_parser.worth_reading`), and a
  picture Docling repeats is read once (the same box check as tables).
- **Reading them.** In pass 2, with the tables and formulas, each picture is cropped
  (`chunking_helper/picture_parser.py`) and sent to the `picture` task of
  `ocr_model.recognise`, with its heading trail and caption as context. The prompt
  (`ocr_prompts.PICTURE_PROMPT`, `pic-v1`) follows S5's photo reader: describe only
  what is visible, leave out what cannot be made out, say nothing about causes,
  consequences or compliance, and never invent a hazard. The model answers with a
  kind, a description and the text printed in the image.

  | Step | anthropic / gemini | glm |
  |---|---|---|
  | Detection, slot, dedup | shared | shared |
  | Crop | shared with tables | shared with tables |
  | Reading | `picture` task, same call path, rate limits and usage (`ocr`) | left unread, no call |
  | Passage | caption, description, nearby prose; marked generated | caption and nearby prose only |

- **The passage.** One per picture: the caption, then `Image description (generated,
  <kind>): …` and `Text in image: …`, with the prose before or after it in the same
  chunk. It keeps the picture's own `bbox`/`bbox_pages`, the chunk's pages, heading
  trail and `position`; ids are `<id>:picture:<n>[:g<k>]`, and `:g<k>` keeps a
  chunk's pictures in reading order at search time. A read picture's passage carries
  `generated_text: picture_description`, `generated_by` (`<provider>:<model>`) and
  `prompt_version`. `section` comes from the pages as for any passage, so a past
  report's Appendix A photos are `Appendix`. A picture beside a table gets its own
  passage after the table's.
- **Tables that read as nothing.** A table none of whose crops gives a record is often
  a photo or drawing Docling labelled as a table, so it is read once as a picture. A
  table that read on some of its pages is not. Its passage id is
  `<id>:table:<n>:picture[:g<k>]`, so it never clashes with a picture of the same
  chunk (`<id>:picture:<n>`).

### Cited regions and formulas (KB-02)

- **What S4 returns.** `GET /passages/{id}` (`app/chat/passages.py`), through the
  gateway's `GET /api/chat/passages/:id`, adds `region` (`{ kind, boxes }` or null)
  and `generated`. A table or formula region comes only from the passage's
  `region_kind`/`region_bbox`/`region_pages` keys (see database.md); a described
  picture with no region keys gets its own `bbox`; anything else is null. Ingestion
  writes the keys from IN-19 (see database.md); a passage ingested before then shows
  as text. No box is guessed: the largest box of a
  table chunk is often its prose.
- **What is quotable.** `quotable_text` (`app/generation/generator.py`) leaves out a
  described picture's `Image description (generated …)` block, up to its
  `Text in image:` line or the next blank line. A quote found only in a model's
  description is therefore never "found" in the document, in chat, the checklist or
  Ask. The caption, the printed text and the prose stay quotable.
- **Three outcomes.** `quote_check(quote, passage)` (same file) returns `found`,
  `described` (only in the description: a real citation of what the answer read) or
  `missing`. Every check uses it. The boolean stays false for a described quote, and a
  separate flag marks it: `described` on a chat or Ask citation, `quote_described` from
  `/checklist/draft` (`quoteDescribed` in Mongo), absent meaning false. Chat's `meta`
  line marks it on the `unverified` entry, `{label, quote, described: true}`. The
  screens show a neutral "from the AI's reading of the figure" note, not "not found".
  In Ask it counts against neither confidence nor `guardrail.passed`; the trace
  counts it in `described_citations`. The gateway's check of a hand-chosen checklist
  quote (`checklist.service.ts` `quoteCheck`) does the same, leaving out the
  description as S4 does.
- **Where it shows.** The chat's Passage tab and the review workspace's source panel
  draw the region above the passage text (`client/src/features/sources/`:
  `CitedRegion`, `SourceRegion`), with react-pdf as the PDF tab does (`pdfSetup.ts`).
  Review looks the passage up live by its chunk id only for the region; its text stays
  as the draft was given it. The page is drawn out of sight and the box copied out of
  its canvas as an image, 8 points (`MARGIN`) more than the box on each side, inside
  the page, since Docling's boxes sit tight on a table's top rule. The image scales
  down to fit the panel, never wider than it and never taller than 24rem
  (`sources.css`). A region that can't be drawn shows nothing. The region is never sent to an AI model.
- **Formulas as math.** `PassageBody` renders the LaTeX the formula reader wrote
  (`$$…$$`, `\[…\]`, or a line with a command and no run of prose; words inside
  `\text{}` or `\mathrm{}` are not prose) with KaTeX, lazy-loaded. A formula the text
  breaks over lines (a brace left open, or the next line starting with `{`) is joined
  first. LaTeX KaTeX rejects, and a formula holding the quoted words, show as written.
  A formula ingestion didn't recognise is stored as plain text and stays so.

See the Redis/BullMQ decision in [DECISIONS](../DECISIONS.md).

## Automatic labelling (IN-05)

`POST /label` on the ingestion service (body: the PDF) reads the document's
seven details: source type, title, edition, standard number, effective date,
country and facility type. Code: `microservices/ingestion-service/app/labelling/`.

1. **Pages.** PyMuPDF text of the first `LABEL_PAGES` pages (default 20:
   Marsh reports state the country, via "Currency: SGD", only on pages 12–20).
   A page with no text layer in the first 5 is OCR'd with the IN-06 engine
   selection (Apple Vision natively on macOS, RapidOCR in Docker), then treated
   like any other page. Each page is wrapped in `<page n="…">` so answers can
   cite it.
2. **Models**, chosen by settings, never hardcoded:
   - fixed-list details (source type, country, facility type): a classifier,
     `LABEL_CLASSIFIER` = `jev` (TypeSafe System One) or `openai-decisions`
     (OpenAI Decisions API), or `none` to let the LLM answer them; confidence is
     the classifier's probability for its choice.
   - free-text details (title, edition, standard number, effective date): the LLM,
     `LABEL_LLM_PROVIDER` = `anthropic` or `openai` with `LABEL_LLM_MODEL`,
     structured output with a page and quote per detail.
   The two calls run in parallel; each logs model, tokens, cost and seconds.
3. **Rules.** A fixed-list value counts only at or above `LABEL_MIN_CONFIDENCE`
   and on its allowed list. A free-text value counts only if its text appears
   in the pages (dates in any common written form). A report has no edition;
   only a standard may apply to `all` countries or facility types, and a
   standard that names none gets `all`. Anything else is Unconfirmed (`null`).
   The effective date is never Unconfirmed: a standard gets the upload date, a
   report keeps its grounded date or else gets the upload date (model `default`,
   Singapore date; the gateway defaults it the same way if /label fails).
4. **Failure.** If only the classifier fails, the fixed-list details use the
   LLM's own answers. If the LLM call fails, every detail except the effective
   date is Unconfirmed. The endpoint still answers 200. Only a PDF that will not
   open gets 422.

The gateway checks each value again before storing it (see
[database.md](database.md) "Automatic labelling"). A document with an
Unconfirmed detail is listed as **Needs review**, its passages carry `status:
needs_review`, and retrieval skips them until an admin saves every detail
through Edit details (KB-01).

The model choice and `LABEL_MIN_CONFIDENCE` come from the evaluation in
`microservices/ingestion-service/eval/labelling/` (run by hand: it calls paid
APIs). See [DECISIONS](../DECISIONS.md).

## Matching: duplicates and newer editions (IN-07)

Code: `microservices/ingestion-service/app/matching.py`. It runs at the end of
ingestion (worker step 4) and writes `match` on the document (shape in
[database.md](database.md) "Duplicates and newer editions"). An identical file
never gets this far: the gateway rejects it at upload.

1. **Candidates.** Every `complete` document except itself (active, needs
   review or withdrawn), but not one in the same edition family. Failed and
   still-ingesting documents are skipped. Without that filter an older edition
   would re-flag its own family.
2. **Copy check.** No new embedding: the new document's vectors are read from
   Chroma. For each, the 5 nearest passages among the candidates are looked up.
   A new passage matches a document if one of its passages is at least
   `MATCH_PASSAGE_SIMILARITY` (0.90) similar. Per candidate, `newShare` is
   matched new passages over all new passages, and `storedShare` is matched
   stored passages over all stored passages. The candidate with the highest
   `max(newShare, storedShare)` is a `possible_copy` if that is at least
   `MATCH_MIN_SHARE` (0.58). Either direction counts, so an excerpt of a stored
   document and a full document whose excerpt is stored are both caught.
3. **One match, by rule order.** Titles are never compared (a missing "s"
   flipped a match); identity is the issuing body plus the standard number
   (`standardNumber`, tidied by casefold and removing spaces). A copy candidate
   has `max(newShare, storedShare)` at least `MATCH_MIN_SHARE`. The first rule
   that fits wins:
   1. a copy candidate with the same edition (same year, or both without one):
      `possible_copy`, highest share first (a withdrawn one still counts);
      a manual entry of that edition goes to rule 2 instead;
   2. (IN-18) the same body, number and edition year, with one of the two
      entered by hand (`entryMethod: 'manual'`) and the other not withdrawn,
      whatever the share: `replaces_manual`. A manual entry is often partial,
      so no share is needed; ties go to the one sharing more passages;
   3. another edition of the same body and number (both standards, both
      editions known, different year), whatever the share: `newer_edition` /
      `earlier_edition`, against the family's non-withdrawn edition, else the
      newest; ties go to the one sharing more passages;
   4. a copy candidate that is a standard of the same body with a known,
      different edition, when a number is unknown: the same edition kinds;
   5. any other copy candidate: `possible_copy`;
   6. otherwise no match. Same number and edition with a low share (different
      chapters of one edition) is no match. A report never gets an edition.
   The counts always come from the copy check (zeros when no passage is shared).

Both numbers are env settings (`.env.example`), set by
`microservices/ingestion-service/eval/matching/results/2026-10-08.md`: at 0.90
every copy shares at least 83% of its passages and no non-copy more than 33%,
so 0.58 sits in the middle of a 50-point gap. See [DECISIONS](../DECISIONS.md).

Ingestion service endpoints for IN-07, all behind the gateway (the gateway never
reads Chroma):

| Endpoint | Does |
| --- | --- |
| `POST /documents/{id}/match` | Re-runs the match for a `complete` document, saves `match` (or `null`), relabels its passages to the final status. Returns `{ "match": … \| null }`. 404 unknown, 409 not finished ingesting |
| `DELETE /documents/{id}/passages` | Deletes the document's passages from Chroma. Returns `{ "passagesDeleted": n }` |
| `GET /documents/{id}/comparison/{otherId}` | Returns `{ "rows": [{ new, stored, differs }] }` in the new document's order. A new passage pairs with its most similar stored passage if at least 0.90 alike; it differs if unpaired or its tidied text changed. Unpaired stored passages are slotted in by their own order |

**Decisions** (`POST /api/knowledge-documents/:id/decision`, code in
`server/src/services/knowledge-document-decision.service.ts`). All are refused
with 409 while the document's details are Unconfirmed, when it has no match, when
the matched document is gone, or when the choice doesn't fit. Every kind allows
`keep_both` and `discard_new`; `newer_edition` adds `supersede`;
`earlier_edition` adds `add_as_older`; `replaces_manual` adds `replace_manual`;
if the matched document also needs
review, `discard_other` is added.

| Choice | Effect |
| --- | --- |
| `keep_both` | Clears `match` (and the other document's, if it points back here). The matched document keeps its status |
| `discard_new` | Deletes the document completely: passages, then the S3 file, the `ingestion_jobs` row and the record. Passages go first so that if Chroma is down nothing has changed. Every document that matched it is then re-matched; one that now matches nothing leaves Needs review |
| `discard_other` | The same, for the matched document. The reviewed document is then re-matched too |
| `supersede` | The reviewed (newer) edition becomes active; the stored one is withdrawn (who and when, as KB-01; an existing withdrawal is kept). Both get the same `editionFamily`: the stored document's, or its `_id` if it had none |
| `add_as_older` | The reviewed (earlier) edition joins the stored one's family and is stored withdrawn |
| `replace_manual` | (IN-18) As `supersede`, but the manual side is withdrawn, whichever was reviewed: the uploaded PDF becomes active, and the manual entry is kept, with its clauses, in the same `editionFamily`. A withdrawn manual entry takes no clause changes until reinstated |

Saving a decision and relabelling the passages go together: if the relabel
fails, the gateway writes the old values back and answers 503 (as for withdraw).
A reinstate is refused (409) while another edition in the same `editionFamily`
is not withdrawn; the message names it, so the admin withdraws that one first.

A details correction (KB-01) calls `POST /documents/{id}/match` only when the
source type, standard number or edition changed, or the document already has a match; the
match call relabels the passages itself. If it fails, the gateway writes the old
details and history back and answers 503, as it does for any failed relabel.

## Correcting a knowledge document (KB-01)

1. The Documents tab lists `GET /api/knowledge-documents/ingested` and filters
   by source type (IN-17), country, facility type and status in the browser.
2. Edit details sends the full details to `PUT /api/knowledge-documents/:id`.
   The gateway validates them as at upload, refuses a document that is not
   active (409), keeps a copy of the old details and saves the new ones.
3. The gateway calls the ingestion service's `PUT /documents/{id}/labels` (via
   `INGESTION_SERVICE_URL`) with the labels (never `COPE_dimension`, so each
   passage keeps its own; IN-05) and `status`. It finds the passages by
   `doc_id` and merges the labels into their Chroma metadata, keeping
   `headings`, pages and `bbox`. Nothing is re-parsed or re-embedded. It
   returns `{ "passagesUpdated": n }` (0 if the document has no passages).
4. If that call fails, the gateway writes the old details back and answers
   503, so a failed relabel leaves both on the old labels.
5. Search sees the change at once: the RAG service's `POST /retrieve` takes
   optional `filters` on `source_type`, `jurisdiction` and `facility_type`;
   the last two also match passages labelled `all`.

## Withdrawing and reinstating a knowledge document (KB-01)

1. Withdraw sends `POST /api/knowledge-documents/:id/withdraw`; reinstate sends
   `POST /api/knowledge-documents/:id/reinstate`. The gateway refuses a document
   in the wrong state (409): withdraw needs a complete, not-withdrawn document,
   reinstate needs a withdrawn one.
2. The gateway saves or removes `withdrawn` (who and when), then calls the
   ingestion service's `PUT /documents/{id}/labels` with the labels plus
   `status` (`withdrawn`, or `needs_review` / `active` depending on whether a
   detail is still Unconfirmed). No re-parsing or re-embedding.
3. If that call fails, the gateway puts `withdrawn` back and answers 503, so
   the document keeps its old state.
4. Retrieval skips withdrawn passages: the RAG service's `retrieve()` always
   excludes `status: withdrawn` (and `needs_review`, IN-05), so `/retrieve` and `/generate` both skip them.
   Reinstating brings them back without uploading again.

## Browsing a knowledge document's passages (IN-17)

Engineers and admins (`knowledge:view`) see the Knowledge base's Documents list;
only admins (`knowledge:manage`) see Add documents, Requests, the Review page and
the actions that change a document. The client hides them, and the gateway
refuses them (403) whatever the client shows.

1. A document's details offer View passages: a table, one page of 25 at a time
   (`PassagesDialog.tsx`). It reads `GET /api/knowledge-documents/:id/passages`
   with `offset`, `limit` (1–100), `chapter`, `section`, `pageFrom`/`pageTo` and
   `q`. The gateway (`knowledge-passages.service.ts`) checks them with zod (400
   for a bad value or a range that ends before it starts, before any service is
   asked), answers 404 for an unknown document without calling a service, and 503
   when a service is down.
2. **Listing.** The gateway calls the ingestion service's
   `GET /documents/{id}/passages` (`matching.document_passages`). It reads every
   passage's metadata for the document (no text, no vectors), orders them in
   reading order (chunk number, then table, picture and `:partN` passages, as
   `matching.py` orders them), outlines, filters and counts them, then reads the
   text of that page's passages only. It answers
   `{ total, passages: [{ id, position, text, headings, section, pageStart, pageEnd,
   status, kind, generated }], outline: { by, chapters, sections } }`:
   - `position` is the passage's place in the whole document, filtered or not;
   - `kind` is `table`, `formula` or `picture` from the recorded region, a
     described picture or the id (`:table:`, `:picture:`), else `text`;
     `generated` marks text a model wrote (IN-13);
   - a page range keeps passages whose pages overlap it; a passage with no page
     never matches one.
3. **Outline** (`app/outline.py`). Docling's heading trails don't nest reliably
   (in NFPA 25 every trail starts with the page header and a watermark; see
   `.claude/plans/ingestion-data-fixes.md`, D1), so only the nearest heading is
   read. A clause number ("8.6 …", "Δ 12.4.1", "N12.3.17", "4.1.5*", "A.8.6.1")
   sets the chapter (`8`, or annex `A`) and section (`8.6`, `A.8`); "Chapter 8 …"
   and "Annex A …" start a chapter; any other heading stays in the clause before
   it, and passages before the first chapter are front matter (`""`). That gives
   `by: "clause"`, with `chapters` and, once a chapter is chosen, its `sections`,
   each `{ name, count, title }`. A title comes only from the chapter's or
   section's own heading ("Chapter 8 Installation", an "N.0" heading, "8.6 …"),
   never a sub-clause; else it is null. A document with no clause numbers (a past
   report) is `by: "section"`: its chapters are the passages' template `section`
   values, with no second level. Computed on each read, so no re-ingestion.
4. **Search by words.** With `q`, the gateway asks rag-service's keyword search
   (`POST /passages/search`, `document_ids: [id]`, the best 30; local ranking, no
   paid call, so nothing is masked) and then the same ingestion listing with
   `ids` in rank order, so a search is paged, filtered and outlined like a
   listing. The keyword search skips passages that aren't active, so a search of
   a document that needs review or is withdrawn answers 409 instead of looking
   empty; the client offers no search then. The client searches 300 ms after
   typing stops and cancels a request still running.
   **Search by meaning** (`mode=meaning`, the field's Words | Meaning switch): the
   gateway sends `{ query, document_id, limit: 20, privacy }` (`chatPrivacy()`) to
   rag-service's `POST /passages/meaning`. That runs `retriever.retrieve` on the one
   document (`doc_id`), 40 candidates from Chroma, reranked to 20: one Cohere embed
   and one rerank. With protection on, the query is masked before Cohere sees it and
   the reranker reads the passages masked (`rank_texts`, `protection`, as chat does);
   if masking fails nothing is searched, S4 answers 503 and the gateway passes its
   message on. S4 returns the ranked ids and `usage`, which the gateway records
   for the user and the document as `knowledge-search` (S4's retriever names its
   calls `retrieval`, which the cost report counts as drafting), before listing the
   ids as a word search does. On the Usage and costs screen these calls are a
   "Knowledge base search" group by assessment (they have none) and a part of the
   searcher's bar by engineer; an engineer sees only their own. `label_filter` hides passages that aren't active here too, so the
   same 409 applies. The client runs it only on Enter, or on choosing Meaning with
   words typed, so a pause in typing is never a paid call.
5. **Opening a passage** shows its full text (`PassageBody`) and, for a table,
   formula or picture, the region of the original page through the chat's
   `GET /api/chat/passages/:id` and `CitedRegion` (KB-02). Ingestion records the
   region from IN-19.
6. Nothing is changed: no relabel, no re-embedding. Passages of an uploaded
   document are never edited; only a manually entered document's clauses can
   be amended (IN-18, below).
7. A manual passage (IN-18) has no page: the Pages column shows "—" and a page
   range never matches it. The outline takes its clause number from its
   `clause`, its titles from its headings, and orders it by `order`. Opening
   it shows its screenshots (`CitedImage`) where a PDF region would go; no PDF
   is requested, as the document has none. A draft's passages show the note
   for a document that isn't active, with no search.

## Entering a standard by hand (IN-18)

For a standard that can only be read online, clause by clause. Gateway code:
`server/src/services/manual-section.service.ts`; ingestion:
`microservices/ingestion-service/app/manual.py`; client:
`client/src/features/knowledge-base/screens/ManualSections.tsx`. Records in
[database.md](database.md) "Manual entry".

1. **Start.** Add documents' "No PDF? Enter it manually" opens the details form
   (`ManualEntryDialog.tsx`). `POST /api/knowledge-documents/manual` creates a
   `draft` with no file and queues nothing. One entry per standard and edition:
   a second answers 409 naming the first, and the client offers Continue
   editing. A draft is shared: any admin sees it in the Documents list (Draft
   status) and can continue it.
2. **Start from** (optional): another edition of the same standard. From a
   manual document, its `manual_sections` are copied; from an uploaded one, the
   gateway asks ingestion's `GET /documents/{id}/clauses`, which groups its
   passages by the clause number of their nearest heading (as the outline reads
   it), joins their text, and leaves out front matter and pictures' AI
   descriptions. Copying writes Mongo only (no embedding), so copied clauses
   are `indexed: false, checked: false` until an admin saves each one. Each
   gets a new `seq` and its screenshots new S3 keys, so the copy never depends
   on the old edition: its citations don't block deleting a copied clause, and
   deleting either document leaves the other.
3. **Save a clause.** The editor sends `{ clause, headings, text, images }`.
   The gateway saves it to `manual_sections` first (clause number unique in
   the document; a change carries its `updatedAt` and a stale one answers 409),
   then calls ingestion's `PUT /documents/{id}/manual-sections/{sectionId}`
   with `seq`, `order`, `clause`, `headings`, the text (typed text then each
   screenshot's corrected text) and the screenshots' keys and kinds. That runs
   in the request: `manual.save` splits the text at paragraphs into passages of
   at most `MAX_CHUNK_TOKENS` (the chunker's tokenizer, heading trail
   included), indexes them with the document's current labels (`worker.labels`,
   so `needs_review` while a draft), then deletes any of the clause's older
   passages (`where section_id`) it no longer has. New passages go in first, so
   a failed embed leaves the old ones searchable. If ingestion is down, the
   clause is kept with `indexed: false` and the reason, and Re-embed
   (`POST .../sections/:sid/reembed`) tries again. Deleting a clause deletes
   its passages first (`DELETE /documents/{id}/manual-sections/{sectionId}`),
   and is refused (409) while a report cites any of them (`C:<doc>:<seq>` or a
   `:part<n>` of it); amending a cited clause is allowed, and the citation then
   shows the new text.
4. **Screenshots.** `POST .../sections/screenshots` checks the image's bytes
   (PNG, JPG or WebP), sends it to ingestion's `POST /recognise` (multipart:
   the image, `kind`, `documentId`, the heading trail as `context`), which
   converts it to PNG with Pillow and reads it with `ocr_model.recognise` under
   `OCR_PROVIDER` (a table as records, a formula as LaTeX, a picture as a
   description). The gateway stores the image at
   `knowledge/<id>/sections/<uuid>.<ext>` and returns the text for the admin to
   correct; when nothing was read, the image is still kept and the text is left
   to type. Only a key under the document's own prefix may be saved on a
   clause. Screenshots are streamed by `GET .../sections/screenshots/:name`,
   only when a clause holds them.
5. **Usage.** The clause and `/recognise` routes collect their own model calls
   with `usage.collecting(doc_id)` (a per-request collector, since the API
   process has no worker run to collect into) and return them as `usage`, as
   `/label` does. The gateway records them with `recordAiCalls`: embedding as
   `embed-document`, OCR as `ocr` (the Usage screen's Ingestion tab).
6. **Publish** (`POST /:id/publish`) is refused (409, with `unindexed` and
   `unchecked` counts) until the draft has a clause, every clause is indexed and
   every copied clause checked; the editor shows what is left, with To check
   and Failed filters, and Publish's reason box. Publishing sets `complete`
   (only from `draft`, so two publishes run once) and calls ingestion's
   `POST /documents/{id}/match`, which saves the match and relabels the
   passages: `active`, or `needs_review` if it matched something. If the match
   can't run, the document goes back to `draft` (503).
7. **After Publish.** Edit clauses stays available: a clause saved later is
   indexed at once with the document's labels (`active`, or `needs_review`
   while in review), with no second Publish. Matching runs only at Publish;
   clauses added later don't re-run it (`replaces_manual` compares body, number
   and edition only, so it isn't affected; the other rules keep the share
   worked out at Publish). A withdrawn manual document takes no changes (409)
   and offers no Edit clauses; reinstating it allows them again.
8. **The real PDF.** Uploaded later, it is ingested as usual and matched: rule
   2 gives `replaces_manual` against the manual entry of the same edition,
   whatever the share, and the review offers Replace manual entry
   (`replace_manual`). A PDF that arrives while the manual entry is still a
   draft matches nothing (drafts aren't candidates); the manual entry then
   matches the PDF at its own Publish, as the rule holds with either side
   manual.
9. **Citations.** rag-service's passage details (`chat/passages.py`) add
   `manual` and `images` (the `image_keys`). Chat's Passage tab, the knowledge
   base's passage detail and the review workspace's source panel show a Manual
   entry badge and the screenshots instead of a PDF page.

Only uploaded documents' passages stay read-only: every clause route answers
409 for a document whose `entryMethod` isn't `manual`.

Privacy: manual entry takes standards only, which are public, so as for
uploaded standards nothing is masked or redacted: the typed text and the
screenshot go to Cohere and `OCR_PROVIDER` as they are (see
[privacy.md](privacy.md), Known gaps).

## Report section drafting (S4, GN-01)

1. The client asks the gateway to draft one of sections 7-12:
   `POST /api/assessments/:reference/sections/:sectionId/draft`.
2. The gateway checks the request:
   - the user is the assigned engineer;
   - the assessment is not archived.

   Capture need not be complete: a section can be drafted, and drafted again,
   whenever it has enough evidence.
3. The gateway gets the section's COPE categories and minimum count from S4's
   `GET /sections`. It loads the assessment's categorised observations
   (uncategorised ones stay out, CP-02 AC4, and so do deleted ones, CP-08) and
   refuses (409) while any of their recordings or handwritten pages is still
   transcribing (CP-19).
4. It sends the usable ones to S4's `POST /sections/draft`. An observation is
   usable when it has a note, a finished transcript or a transcribed page with
   text (CP-19); a transcript the engineer corrected is sent as corrected, and
   a removed recording is left out, including from the wait in step 3 (CP-08).
   Pages go as `handwriting`, apart from `transcripts`: S4's prompt labels each
   `Handwritten note:`, and its searches read an observation's note,
   transcripts and pages alike (`Observation.recorded()`). Only those filed under
   any of the section's own categories count towards the minimum, so one
   filed under two categories counts in each of their sections; with too
   few, it refuses with 422 and gives the count. Each observation's
   `COPE_dimension` is sent as a list; S4 also reads a single string as a list
   of one.
   - S4 puts the section's own observations in `<observations>` as the main
     evidence and the rest in `<other_observations>` as backup, used only
     where they concern the section.
   - Only the section's own observations steer the standards search.
5. S4's orchestrator (`orchestrator.draft`) retrieves passages in one batched
   Cohere call:
   - for each of the section's own observations, searched by its own words,
     up to 8 standard passages (`fm_standard` or `nfpa_standard`) within cosine
     distance 0.60, filtered to the site's jurisdiction and facility type;
   - once per section, past-report passages (`marsh_report`), filtered by
     country only, keeping those whose `headings` trail contains the section
     title;
   - then one Cohere Rerank call (`retriever.rerank`, model `RERANK_MODEL`)
     orders both kinds against the section's own observations, and the top 12
     standards and top 4 past-report passages go to the draft (AC14). If
     rerank fails, the draft goes ahead in vector order (each observation's
     nearest first), and S4 logs a warning.
6. `generator.draft_section` builds the prompt from the section's subsections
   (`sections.json`), the drafting guide (`drafting-skill.md`: voice, house
   conventions, evidence rules), and the evidence labelled `O1`, `C1`, `P1`,
   which are mapped back to full IDs afterwards.
7. `llm.complete` calls the provider named by `LLM_PROVIDER`. Only Anthropic
   is implemented. It uses structured output, the server-side refusal
   fallback, and `LLM_EFFORT`.
8. S4 lays the draft out in the template's order and leaves tables empty.
   `checker.check_citations` marks each statement `supported` only if its
   citations are all IDs it was given and none is `P:`.
9. S4 returns the draft, up to three questions for the engineer, the cited
   passages (with pages and headings), the guardrail result and the
   provenance. The cited passages are the standards (`C:`) and any past-report
   passage (`P:`) a statement cites, so the reviewer can open it (RV-01); a
   `P:` citation still leaves its statement unsupported. A refusal or a
   cut-off answer is a 502 with `detail`.
10. The gateway saves the draft in `report_sections` (see
    [database](database.md#report-sections-gn-01)). Any S4 failure reaches
    the client as a 503 with the reason.

## Opportunities for Improvement (S4, GN-05)

Section 3's OFIs are drafted on the Report generation tab, as the first row of
the sections table (`components/OfiSuggestions.tsx`). View OFIs opens the
suggestions, each with Accept (or Accept all), and the OFIs in the report.

1. The engineer clicks **Draft OFIs**. The gateway (`ofi.service.draftOfis`)
   checks the assessment and its observations as for sections, then sends the
   usable observations and the titles of OFIs already accepted to S4's
   `POST /ofis/draft`.
2. `orchestrator.draft_ofis_for` takes observations rated critical, high or
   moderate as candidates. With none, it returns no OFIs and makes no model
   call.
3. One batched Cohere search, by each candidate's own words, finds standards
   (filtered to the site, distance at most 0.60) and past reports' passages
   (by country). Only past passages under the heading "Opportunities for
   Improvement", and not its introduction or Risk Assessment Matrix, are kept
   as past OFIs. One rerank orders both; the top 12 standards and 8 past OFIs
   go to the model. If rerank fails, vector order is used.
4. `generator.draft_ofis` writes the OFIs (prompt `gn05-v6`, guide
   `ofi-skill.md`) as structured output whose category, type, likelihood,
   consequence and effort must come from `ofi.json`, Marsh's value lists.
5. Code finishes each OFI. An OFI none of whose observations resolve is
   dropped. Unresolved standard and precedent labels are dropped. The
   priority is `ofi.json`'s Risk Assessment Matrix value for likelihood ×
   consequence, never the model's.
6. The gateway replaces the unaccepted suggestions with the new ones in
   `report_ofis` (see [database](database.md#opportunities-for-improvement-gn-05)).
   The engineer accepts suggestions one by one. Only accepted OFIs are in the
   report, numbered `<site visit year>-NN` in report order.

Section 6 Management Programs (GN-11) is drafted like Sections 7-12, from its
`sections.json` entry: Marsh's 15 programs as `fields`, each row written
"<Program>: <Rank>. <comment>". The entry's `instructions` add the maturity
scale and its rules to the prompt (the lower rank when the evidence fits two; no
row without evidence), and `orchestrator.check_maturity_ranks` marks a row
unsupported when its rank is not one of the five. `eval/score_ranks.py` drafts
the cases in `eval/rank_cases` and counts exact and within-one matches with
Marsh's ranks, next to an always-Embedded baseline (one paid call per case).

Sections 4 and 5 (GN-03) are drafted like Sections 6-12, but only once the
engineer's figures are complete (the gateway answers 422 otherwise). The
gateway computes the Location Risk Quality Score and rating, and each loss
level, from the figures, and sends them as `facts` (plain lines, e.g. "Current
Location Risk Quality Rating: B"); the model writes only the wording: Section
4's Risk Quality Rating Comments and Positive Points, and Section 5's Scenario
and Assumptions per level. `orchestrator.check_numbers_grounded` marks a
statement unsupported when it holds a number found neither in the facts nor in
its cited observations and standards, or names a rating other than the
computed one. No eval: no figure comes from the model.
Each loss level can have independent property damage items and engineer-entered
values. Those values also reach the drafting facts. The table retains the original
four columns: Property Damage, Value, % Damage and Property Damage. Site-wide
insured values remain separate. Older estimates without `damageRows` retain their
original calculation; saving them from Review copies their existing rows into
independent level rows. An empty level remains incomplete, not zero loss.

`eval/judge_ofis.py` scores drafted OFIs, and Marsh's own, on three cases from
the sample reports (AC7).

## Pre-survey checklist (S4, CP-30)

The assessment's Checklist tab (`screens/Checklist.tsx`) lists the standards
that apply to the site and the latest checklist. Before the first checklist
every standard is ticked; after it, those the latest checklist used are, and
any added to the knowledge base since; the list is folded once there is a
checklist. The checklist shows **Priority risks** (the facility type's
hazards) first, then **Report sections**: each report section once, with a
switch between two views. "Relevant sections" (the default) shows only the
sections the selected standards add requirements to, under their subsection,
and lists the rest as tags under "No specific requirements for:", with a link
to show all sections, so none goes missing unexplained. "All sections" shows every
template subsection with those requirements beneath it, and says "Nothing
specific in the selected standards" in a section they add nothing to. A risk names the standards it is checked against when they were selected. When
none was, its general check (from `checklist.json`) says which standard to
select, if one applies, or to add to the knowledge base. Each card marks its AI-written items
once, with a violet rule on each; a citation is a chip naming the standard and
page ("NFPA 13 p. 196"), one per page, opening to its quotes and the passage.
A facility type with no hazard list (one outside the nine) is said so on the
checklist. If the site's facility type or
country has changed since the checklist was generated, the tab says it is out
of date and to regenerate it.

1. The engineer unticks any standard to leave out and clicks **Generate
   checklist**. The gateway (`checklist.service.generateChecklist`) checks the
   assigned engineer and that the assessment is not archived, and that every
   chosen standard still applies, then sends S4's `POST /checklist/draft` only
   the facility type, the country and the chosen standards' ids, source types
   and numbers. No client detail is sent, so nothing is masked.
2. `checklist.template_items` writes one item per template subsection of
   Sections 6-12 (`sections.json`), leaving out "… Comments" subsections. Its
   text is `checklist.json`'s `template_details` for the subsection, or the
   heading, with the subsection's fields; a rag-service test checks no item is a
   bare heading. No model is involved.
3. With standards in scope, `orchestrator.draft_checklist_for` runs one batched
   Cohere search, filtered to those documents (`doc_id`): one per report area,
   by what it covers (`checklist.area_scope`: each subsection with its fields or
   template detail, not the title alone, which left Management Programs drawing
   whatever no other search claimed), and one per hazard configured for the facility type (`checklist.json`
   `hazards`). A hazard is searched within the standards it names when any of
   them is in scope, else across all in scope. One rerank orders the pool; the
   top 20, plus each search's own two nearest passages, go to the model, so no
   area or hazard is crowded out by another's. If rerank fails, vector order is
   used. Each passage is offered under one area or hazard only, so the model
   does not write the same requirement under two: a hazard's, if any hazard's
   search found it (a hazard keeps its own standards' passages, AC7), else the
   area whose search found it nearest.
4. `checklist.draft_items` (prompt `cp30-v5`, `CHECKLIST_EFFORT`, default
   `medium`, on `LLM_MODEL`) writes items as structured output: each under a
   report area and subsection, or a hazard, citing passages by label with the
   words it rests on. The prompt lists the passages each area's and hazard's
   own search found (`<found_for>`) as where to look, not where an item goes:
   each requirement is filed, once, under the area and subsection whose scope
   (the same `area_scope`, listed in `<report_areas>`) covers what it checks,
   without stretching a passage to fill an area, and never from a loss history
   or example, which tells of a past fire rather than setting a requirement.
   A passage's headings longer than 200 characters are left out
   (`generator.passage_headings`, which drafting and chat use too): they are
   body text the PDF reader took for a heading (FM 2-0's loss examples), which
   the model quoted though the passage's text did not hold them.
   Items for an unknown area or hazard are dropped. An item in a section of one
   subsection (6) is put under it when the model leaves it out.
5. Code checks the result. A citation of a passage not given is dropped; each
   quote is looked for in its passage, the headings shown with it and then its
   text (`quote_check`, as chat does): a past report's
   cover lines, for one, are headings only. A quote only in a picture's AI
   description is `quote_described` (KB-02). An item
   left with no citation is flagged `uncited`. A configured hazard with no item
   gets the config's own item, with origin `hazard_list` (written by the team,
   so not shown as AI-generated) and flagged `uncited`. Items are placed after their
   subsection's template item, in report order, then the hazards.
6. The gateway records the paid calls under the `checklist` feature and saves
   the checklist in `checklists` (see [database](database.md#pre-survey-checklists-cp-30)).

With no standard in scope, steps 3-4 are skipped: the checklist has its
template and hazard items only, and no paid call is made.

`checklist.json` holds the hazards for each of the nine facility types (3-4
each), each naming the NFPA or FM standards it is checked against. It was
drafted by the team and is to be reviewed with Marsh; bump its `version` on any
change; a rag-service test checks it covers exactly the nine facility types.
`eval/score_checklist.py` generates a checklist for every facility type from
the standards in `eval/checklist_cases.json`, and counts template and hazard
coverage, hazards cited by one of their own standards, citations resolving to
a standard in scope and quotes found (one paid call per type). The cases file
comes from the gateway (`npm run export:checklist-cases -- <file>`), since the
passages in Chroma carry no standard numbers; it holds one database's document
ids, so it is not committed.

### Customising the checklist (CP-32)

On the Checklist tab the assigned engineer customises the latest checklist;
nothing changes in the sheet opened from capture, where the checklist is only
answered. Each item has a pencil (Edit item) and a red bin (Remove item); each
card ends with a dashed **Add item** row. The template's subsections, a
priority risk's last item and an item an observation answers keep a greyed bin
with the reason (mark the first two Not applicable instead; delete the
observation first). Removing shows a toast with Undo; removed items are listed,
folded, under **Removed items (n)** at the end, each with Restore. An edited
item is tagged Edited and loses its AI rule; an added one is tagged Added.

The editor (`components/ChecklistItemEditor.tsx`) holds what to check, the
COPE categories (one or more) and the references. Adding asks where: a
priority risk, or a report section and optionally one of its template
subsections. **Add reference** searches the checklist's standards, starting
from the item's own words, and opens a passage to read; the engineer may
select the words the item rests on, else its first sentence is quoted. The
gateway fetches a newly chosen passage from S4 (`GET /passages/{id}`), refuses
one outside the checklist's standards or no longer applying to the site, looks
for the quote in it as S4 does (`quoteCheck`: `quoteFound`, or `quoteDescribed`
for words only in a picture's AI description, KB-02) and keeps the passage in the
checklist's `sources`, so the reference reads the same later and offline.

**Passage search.** S4's `POST /passages/search` (`app/retrieval/keyword_search.py`)
takes `{ query, document_ids, limit }` and ranks the documents' searchable
passages by BM25 over the words they share with the query (lower case, stop
words dropped, a plural "s" dropped, clause numbers such as `8.3.1` kept whole;
headings count). It reads Chroma only, paging past Chroma Cloud's 300-result
cap, and keeps each document's passages for 10 minutes (24 documents at most),
so the next search is instant. No paid call is made and the query never leaves
the service, so nothing is masked or recorded. Withdrawn and unconfirmed
passages are left out, as in every search. The gateway's `GET
.../checklist/passages?q=` searches the latest checklist's standards that still
apply to the site (12 results).

**PDF.** `GET .../checklist/pdf` (anyone who can view the assessment) builds the
page from the saved checklist (`checklist-pdf.ts`), never from the browser, and
prints it with the export's Chromium (`export-render.service`: scripts off,
every request refused). A4, with the reference and page number in every page's
margin. It has the assessment's details and the standards used, then every
item still on the checklist in the tab's order (priority risks, then each
section with its template subsections and their items beneath), numbered. Each
item has its categories; each reference its standard's title, edition, page and
quoted words (flagged when not word for word); then its answer (result, who,
where, when) or four boxes to tick and two lines to write on. AI-written items
are tagged, as are edited and added ones. Nothing in it is fetched, so it reads
the same offline. Named `<reference> checklist <YYYY-MM-DD>.pdf`
(`REPORT_TIME_ZONE`). CP-34 adds each item's pre-filled value where the
reference lines are.

## Site walk proposal (S4, CP-22)

`POST /site-walks/propose` (`app/site_walk/propose.py`) turns a finished site
walk into proposed locations and observations. The gateway's
`site-walk-proposal` worker calls it with the transcript (recordings in `seq`
order, each with Whisper's timed segments, or the typed text), the
assessment's locations, the photos with S5's descriptions, and `privacy`.
Nothing is saved here; the response is the proposal plus `usage`. Shapes:
`.local-docs/specs/sprint-4/CP-22-contract.md`.

1. **Mask** every client text in one `/mask` call (see
   [privacy](privacy.md)). Fails closed: rag 502, nothing sent.
2. **Read the walk** with one `complete()` call (`LLM_PROVIDER`, `LLM_MODEL`,
   `SITE_WALK_EFFORT`). The prompt says the text is speech-to-text and may hold
   misheard place names, to carry the last announced place forward, and that
   positive remarks are observations too. Each observation comes back with a
   clean note, the place as spoken (building or elsewhere, building, level,
   name) or none, and its span (recording, start, end). Results are put in walk
   order; a typed walk has no spans.
3. **Resolve places** in walk order. Levels are spelled as the gateway does
   (`places.standard_level`, a port of `standardLevel`), and an exact repeat of
   a place, or of an existing location, is matched by the gateway's location
   key without a model call. Each other place goes to the classifier, which
   chooses among the existing locations, the places accepted earlier in this
   walk, and "a new place", reading the spoken place and the transcript within
   30 s of it. The choices grow as the walk is read, so "Block H" said after
   "Block A" can resolve to Block A.
4. **Severity and COPE category** for every observation, from the classifier
   (criteria descriptions in `propose.py`), 20 observations per call.
5. **Photos:** each photo with a time is matched among the 3 observations
   spoken nearest it (same recording first); the classifier picks one from the
   photo's description and their notes. With one candidate it is attached
   directly. A typed walk's photos are not matched.
6. **Check flags:** a classifier pick below `SITE_WALK_CHECK_BELOW` (0.70, the
   IN-05 labelling cutoff) sets that observation's `check.location`,
   `check.severity` or `check.category`. No pick is hidden.
7. **Unmask** notes and new locations' names; matched existing locations are
   returned with the gateway's values.

The classifier is `SITE_WALK_CLASSIFIER` (default `jev`), an adapter in
`app/site_walk/jev.py` copied from ingestion's labelling one (needs
`TYPESAFE_API_KEY`). Jev answers many questions about one text in one call.
Calls per walk: one model call, plus one Jev call per spoken place that is
not an exact repeat and has something to choose from, plus
ceil(observations / 20) for severity and category, plus ceil(photos with
more than one candidate / 20). Every call is returned in `usage` with feature
`site-walk`; Jev calls carry their own cost (`cost_usd`, at ingestion's Jev
price).

**Evaluation** (`eval/site_walk/`): six scripted walks in `golden.json`
(existing locations, a repeated place, a misheard place, a positive remark, a
finding with no clear place in a typed walk, a level said three ways), scored
in code by `scoring.py` on location matching (and extra locations),
observation recall, and location, category and severity agreement. It is paid,
so run it by hand from `microservices/rag-service` and report the cost it
prints:

```
uv run python -m eval.site_walk.run_eval [--only case-id,case-id]
```

Results go to `eval/results/<date>-site-walk.json` (git-ignored). The scoring
is unit-tested in `tests/test_site_walk_eval.py`.

## Client intake (ingestion, S4, gateway, CP-23)

Starting a new assessment from a client's documents. The reading is done in
place, not by a queue: the engineer waits about 15-25 s on a progress view
(a large pack of 12 files and 88,000 characters took about 11 s for the model
step, plus about 3 s of local reading). Nothing is written by ingestion or
rag-service; the gateway saves the result on a `client_intakes` document (see
[database](database.md)).

### Ingestion: `POST /extract-text`

`app/extract_text.py`. The body is the file's raw bytes; the query `filename`
(required) names it and gives its type by extension. The answer is
`{"documents": [{"name", "text"}], "failed": [{"name", "size", "reason"}]}`:
the file first, then each of an email's attachments that is a PDF, `.docx`,
`.eml` or `.msg`, named `Attachment: <file> (from <email>)`. An attachment of
those types, or a `.doc`, that can't be read (damaged, password-protected,
empty, or a `.doc`, which only the gateway can convert) is listed in `failed`
under the same name, with the same reason words as a top-level file's refusal;
a `.doc` says "Can't read .doc attachments. Save it as .docx or PDF and add
it." Other attachments (images, signatures) are skipped. An attached email's
own attachments are not opened (one level only).

| Format | How it is read |
| --- | --- |
| PDF | PyMuPDF text, page by page, joined with a blank line. A page with fewer than 20 non-space characters has no text layer, so it goes through the labelling OCR (`app/labelling/pages.py: ocr_page`, Docling's local engine, so it records no AI cost). At most `OCR_MAX_PAGES` (5) pages are OCR'd per file; the text then ends with `[Pages after N were not read: scanned]`. A page whose OCR fails is skipped (logged) and the rest are read. An attachment that can't be opened is listed in `failed`, and the email and its other attachments are still read. |
| `.docx` | `python-docx` reads it directly: paragraphs, then table rows with cells joined by ` | `. |
| `.eml` | Python's `email` package: From, To, Cc, Date and Subject, then the plain-text body (HTML stripped to text when there is none). |
| `.msg` | `python-oxmsg` (MIT): the same header and body. |

Legacy `.doc` is not read here. The gateway converts it to PDF with the converter
first (`textOf` in `client-intake.service.ts`), then sends the PDF. Answers:
**415** for an extension it does not read, **422** with a plain-English reason
for a file it cannot open (corrupt, a password-protected PDF, not really an
email). The gateway shows that reason on the file and still reads the others (AC3);
the gateway answers 503 if ingestion is down, and 422 only when no file at all
could be read.

**OCR warm-up.** The OCR model takes about 45 s to load, so the lifespan loads it
in a background thread when the service starts (startup is not blocked), and the
first scanned page after a restart is not slow. Set `PRELOAD_OCR=0` to skip it;
the tests do (`tests/conftest.py`), so they never load the model.

### rag-service: `POST /client-intakes/read`

`app/client_intake/read.py`. The gateway sends every document's text, every
recorded client with its sites (`has_assessments` says whether a site was ever
surveyed), the facility types and jurisdictions, and `privacy` with
`detect: ["CLIENT", "SITE"]`. The answer is the proposal: the client (name,
division), each site (name, address, jurisdiction, facility type), each
assessment (visit type, dates, contacts) and where each document belongs, plus
`usage`. Every value is `{ value, source: { document_id, quote } }`;
`value: null` is Not sure (left empty). Steps:

1. **Mask** every document's name and text in one `/mask` call (see
   [privacy](privacy.md)); `CLIENT_INTAKE_PRIVACY_TIMEOUT` is 60 s. Fails
   closed: rag 503 (`PrivacyUnavailable`), nothing sent.
2. **Read the documents** with one `complete()` call: `LLM_PROVIDER` with
   `CLIENT_INTAKE_MODEL` (default `claude-sonnet-5-5`) at `CLIENT_INTAKE_EFFORT`
   (default `medium`). It returns the client, sites, the visits requested (each
   with its dates, hints for the visit type and contacts) and what each document
   is about. Every value carries the words it rests on and their document.
3. **Check each quote** is in its document (case, spacing and placeholder
   brackets ignored). A value whose quote is not found is emptied, as the
   checklist checks citations. A date must also be `YYYY-MM-DD`.
4. **Match to recorded clients and sites**, in code, after unmasking
   (`difflib` similarity on names with case, punctuation and trailing "Pte Ltd",
   "Inc", "Sdn Bhd" and the like dropped; a site matches on its name or address,
   and an address only when its numbers are the same, so 5 Tuas Ave 1 is not 7
   Tuas Ave 1). Sites are matched only among the matched client's own. At or
   above `CLIENT_INTAKE_MATCH` (0.80) it is that recorded one (`existing_id`);
   from `CLIENT_INTAKE_MATCH_MAYBE` (0.65) up to it, `existing_id` is null and
   `match_not_sure` is true, so the form asks the engineer. A recorded site keeps
   its own facility type and jurisdiction; they are not proposed.
5. **Fixed choices** go to the classifier, `CLIENT_INTAKE_CLASSIFIER` (default
   `jev`; the adapter in `app/site_walk/jev.py`, shared with CP-22), 20 questions
   per call, on masked text: a new site's facility type (of the nine) and
   jurisdiction (of the eight), the visit type, and each document's placement
   (the whole client, a site or an assessment). A visit to a new site, or one
   never surveyed, is a First survey by code, with no AI pick (AC17). Only a
   recorded site that was surveyed before gets Resurvey or Follow-up visit.
6. **Cutoffs.** Each decision type has its own, `CLIENT_INTAKE_CUTOFFS`. A pick
   below it is left empty (Not sure); a document's placement falls back to the
   whole client, flagged Not sure.
7. **Unmask** every value and quote before returning.

| Setting | Default | Why |
| --- | --- | --- |
| `CLIENT_INTAKE_MODEL` | `claude-sonnet-5-5` | Chosen by the evaluation (see DECISIONS). |
| `CLIENT_INTAKE_EFFORT` | `medium` | Same output as low on the timing test, at a little more time. |
| `CLIENT_INTAKE_CLASSIFIER` | `jev` | |
| Cutoffs: facility type, jurisdiction, visit type | 0.5 | At most one wrong pick at any cutoff on the tuning packs, so 0.5 (Jev favours one option over all the others together) empties nothing. |
| Cutoff: placement | 0.85 | Right 96% of the time at 0.85; 14% of documents go to the whole client. |
| `CLIENT_INTAKE_MATCH`, `_MAYBE` | 0.80, 0.65 | Every cutoff from 0.65 to 0.95 matched all 54 tuning items with no false match (0.60 made 2). 0.80 sits inside that range, not at its edge, as a wrong client is worse than a Not sure. |

The cutoffs and match thresholds were chosen by a sweep on the tuning packs and
confirmed on held-out ones, not copied from another feature (the labelling
cutoff, 0.70, was not reused). The prompt and the placement descriptions were
tuned on the tuning packs only. rag 502 for any other AI failure.

### Gateway flow

`routes/client-intake.routes.ts`, `services/client-intake.service.ts`,
`client-intake-create.service.ts`:
1. `POST /api/client-intakes`: each file is checked by its extension and its
   bytes together (PDF, `.docx`, `.doc`, `.msg`, `.eml`; 100 MB in all). Accepted
   files go to S3 under `client-intakes/<id>/`; a refused file is listed with its
   reason and the others go on.
2. `POST /api/client-intakes/:id/read`: claims the intake (two taps read it once),
   gets each file's text (`.doc` through the converter, then `/extract-text`),
   adds pasted text as a document named "Pasted text", then calls rag-service.
   An email's attachments that couldn't be read are saved on the intake
   (`failedAttachments`) and listed in the answer's `files` after their email,
   as `failed` with no id and the reason.
   Its paid calls are saved to `ai_calls` (feature `client-intake`). A failed read
   leaves the intake `failed`, so it can be read again.
3. `POST /api/client-intakes/:id/create`: the engineer's checked form becomes the
   client, sites and assessments (the same create as `POST /api/assessments`),
   and each listed document is copied to
   `client-documents/<client id>/` and recorded under its placement. The
   assessments are assigned to the signed-in engineer; there is no picker. A
   failure part-way removes everything it made (records, copies, documents) and
   leaves the intake ready, so a retry starts clean; a repeat after success
   returns the same records.
4. `DELETE /api/client-intakes/:id`, or the daily cleanup, removes an intake that
   was not used.

**Evaluation** (`eval/client_intake/`): synthetic client packs built from the
sample reports, scored against their answer keys in code, with a tuning set and a
held-out set. See the CP-23 entry in [DECISIONS](../DECISIONS.md) for the results.
It is paid, so run it by hand from `microservices/rag-service`; the scoring is
unit-tested in `tests/test_client_intake_eval.py`.

```
uv run python -m eval.client_intake.run_eval --split tuning [--only p01,p02] [--privacy on]
```

## Client insights summary (S4, gateway, CP-29)

The written summary on a client's Insights tab. The figures on the tab are
counted by the gateway alone ([database](database.md), "Client insights"); only
this summary asks a model. It is written in place when the engineer asks (about
10-15 s), never on opening the tab, and never streamed.

Gateway (`client-insight-summary.service.ts`):
1. Builds the evidence from the user's own figures: `figures` (F1 observations
   by category, F2 rating and accepted OFIs by site, F3 change between visits,
   as lines of text) and `observations` (O1, O2, ...: each latest assessment's
   observations with words, most severe first, at most 60, each cut to 600
   characters).
2. Sends them to `POST /client-insights/summary` with `privacy` from
   `chatPrivacy()`: notes at one client can name another, so every client, site
   and person is masked, as chat masks them.
3. Records the usage (`ai_calls`, feature `client-insights`, for the user).
4. Numbers the cited sources in the order they are first cited, each with its
   own words, and saves the summary. Nothing is saved when the call fails or no
   statement is left.

rag-service (`app/client_insights/summary.py`, prompt `cp29-v1`, `INSIGHTS_MODEL`
and `INSIGHTS_EFFORT` on `LLM_PROVIDER`):
1. One `/mask` call covers the client's name, the figures and the observations,
   before any model call. It fails closed: masking down is 503 and nothing is sent.
2. One `complete` call returns 3 to 5 statements, each with the labels it rests on.
3. Real names are put back, then each statement is checked in code. It is left
   out when it cites no source it was given, breaks the Ask tab's content rules
   (`ask.content_problem`: first person, advice, a percentage of certainty),
   holds a placeholder that could not be restored, or uses a number its cited
   sources don't give (a source's own label, "F3", does not count as a number).
4. `confidence` is `low` when a statement was left out, `medium` when something
   is missing or no statement rests on an observation, `high` otherwise. With no
   statement left the call fails (502), and the gateway answers 503 with the reason.

Not built: an evaluation set for the summary. The checks above are unit tested;
how often a real summary passes them, and how useful it reads, is not yet measured.

## Calendar (client, CP-60)

The Calendar (`/calendar`, `client/src/features/calendar/`) has no service of its own. It is drawn
in the browser from the work list, `GET /api/assessments`, which the gateway already scopes by role,
so it adds no endpoint, collection or model call.

- **Reads:** each assessment's `siteVisitDate`, `siteVisitEndDate`, `reportDueDate`, `status`,
  `engineer` and `siteContacts`. Archived assessments are left out. `calendar.ts` holds the dates and
  the layout (weeks from Monday, entries in lanes, the report due states) as pure functions.
- **Writes:** Reschedule saves through `PUT /api/assessments/:reference` (RV-10), sending the type
  unchanged and all three dates. Only the assigned engineer may, and not once archived (403, 409).
- **New assessment on a day** opens the New Assessment form (CP-23) with that day as the first
  assessment's survey start; nothing is created until the form is.

## Site weather (gateway, CP-62)

Whether it is raining or stormy at an assessment's site now, and whether rain is expected in the
next 2 hours, so an engineer doesn't set off for an outdoor or below-ground inspection in it. It is
advisory: nothing is blocked. Shown on the Overview (a bar above MarshBot's conversation), on New
Observation (a card above the form) and on each Assessments row whose survey days include today.

- **Route:** `GET /api/assessments/:reference/weather` (`routes/weather.routes.ts`,
  `assessments:view`), mounted with `requireAuthNoRefresh`: the panel reads it every 10 minutes and
  must not keep an idle session alive (F-07). 404 for an unknown assessment; `Cache-Control: no-store`.
  It answers 200 with one of:
  - `{ status: 'ok', reading, source }`: `reading` holds `observedAt`, `fetchedAt`, `timeZone` (the
    site's IANA zone), `condition` (the provider's words), `raining`, `thunder`,
    `rainfallMmPerHour`, `temperatureC`, `forecast` (`hours` that overlap the next 2 hours, each with
    `chancePercent`, `rainfallMm`, `rain`, `thunder`; and `rainExpected`, `thunderExpected`) and
    `located` (`pin` or `address`); `source` is `{ name: 'Google Weather', url }`.
  - `{ status: 'no-address', address }`: no address and no pin (`address: null`), or an address the
    geocoder can't place (the address). The panel says "Add the site address to see weather".
  - `{ status: 'unavailable', lastReadingAt, timeZone, source }`: the geocoder or the weather API
    couldn't be reached, timed out (8 s) or refused. Never a reading.
  - `{ status: 'unconfigured' }`: no `GOOGLE_MAPS_SERVER_KEY`.
- **Where** (`site-weather.service.ts` `locate`): the site's own `coordinates` (the engineer's pin,
  CP-26) when set; otherwise its `address`, geocoded once (`weather-provider.ts` `geocodeAddress`,
  Google's Geocoding API with the jurisdiction as `region`) and kept on the site as `geocode`. A
  result that is only a country or a state counts as not found. The look-up happens on the first
  weather read, so sites made before CP-62 need nothing run, and a corrected address (CP-18) is
  looked up again because `geocode.address` no longer matches.
- **Reading** (`readWeather`): Google's Weather API, `currentConditions:lookup` and
  `forecast/hours:lookup?hours=3`, in metric. Its current `precipitation.qpf` is the last hour's
  rain, shown as mm/h.
- **What counts** (`judge`, thresholds in `.env`, so every screen agrees):
  - Raining: a rain, hail or thunder condition (`RAIN_TYPES`; `CHANCE_OF_SHOWERS` is not rain), or
    rain at or above `WEATHER_RAINING_MM_PER_HOUR` (default 0.5; 0 means any).
  - Thunder: a condition whose type contains `THUNDER`.
  - Rain expected: an hour of the next 2 with a chance at or above `WEATHER_RAIN_EXPECTED_PERCENT`
    (default 50), or rain at or above the mm/h threshold. Thunder expected: a thunder condition, or a
    thunder chance at or above the same percent.
- **Kept** in memory per site for 10 minutes (`WEATHER_CACHE_MS`), so assessments at one site share
  a reading and the provider is called at most once per site in that time; reads at the same moment
  share one call. After a failure the provider isn't asked again for 30 seconds
  (`WEATHER_RETRY_MS`). The last good reading's time is kept for `unavailable`. A restart forgets
  them all, at the cost of one call per site.
- **Browser** (`client/src/features/assessments/weather/`): `useSiteWeather.ts` reads on open, 10
  minutes after each answer and on Refresh; a hidden tab skips its turn and reads when shown, and the
  clock ticks each minute so a reading over 30 minutes old is labelled Stale. A failed read shows
  "Weather unavailable" with the last good reading's time, never the old reading. Refresh asks the
  gateway at once, which still answers from its 10-minute copy. `weatherWords.ts` words it and picks
  the one warning, strongest first: a thunderstorm (`role="alert"`), rain now, then rain expected
  (`role="status"`), each naming the source and that it is advisory. Times are in the site's zone.
  `SiteWeatherPanel.tsx` is the panel (bar or card), `RowWeather.tsx` an Assessments row's line.

## Report review workspace (RV-01)

1. The Review tab of a saved assessment asks the gateway for
   `GET /api/assessments/:reference/review` (`assessments:view`, so a
   knowledge admin can read it too).
2. The gateway loads sections 7-12 as the Report generation tab does (S4's
   `GET /sections`, the assessment's observations, each section's newest
   draft), so `changesSinceDraft` is counted the same way.
3. It looks up every document the drafts cite in `knowledge_documents`, in one
   query, by each passage's `doc_id` (or the `<document id>` part of its chunk
   ID). The passage text, headings and pages come from the draft, exactly as
   the draft was given them; the title, issuing body, edition, effective date
   and withdrawal come from the knowledge base now, so a correction or a
   withdrawal since drafting shows (KB-01).
4. For each section it works out:
   - completion: how many of the template's prose and field subsections the
     draft writes (`not_started`, `partial`, `complete`). Tables are counted
     apart, since GN-03 fills them.
   - review state: `not_drafted`; `needs_review` when a finding still in the
     draft is unsupported, a source one cites is withdrawn, or observations
     changed since drafting; otherwise, from the engineer's decisions (RV-02,
     below), `ai_draft`, `in_review` or `reviewed`.
   - the observations to show: the draft's own `evidence` (GN-01 AC11),
     limited to those filed under the section's categories plus any other it
     cites.
5. The client numbers citations across the section in the order each is first
   cited. Selecting one opens the passage beside the draft with its page,
   heading trail, document title, edition, effective date (a past report's
   date), and a Withdrawn label, plus a link to the original PDF at that page
   (`/api/knowledge-documents/:id/file#page=n`, `knowledge:view`).

Reading writes nothing. A 503 means S4 could not be reached for the
template's sections.

## Reviewing findings and regenerating sections (RV-02)

Each statement of a saved draft is a finding the assigned engineer accepts,
edits or rejects in the draft editor (`screens/ReviewWorkspace.tsx`,
`components/DraftEditor.tsx`). The gateway (`review-decision.service.ts`)
records each decision as one entry in the append-only review audit log (see
[database](database.md#review-audit-log-rv-02)); drafts are never changed.

1. Every decision names the saved draft the engineer was looking at. The
   gateway checks the assigned engineer, the assessment not archived, the
   section in S4's template (so nothing is saved while S4 is down), and that
   `draftId` is still the section's saved draft (409 if not).
2. It folds the draft's log entries into each finding's state and text, and
   refuses a decision that no longer applies (e.g. editing a rejected
   finding, 409). A decision that changes nothing records nothing.
3. It adds the entry with the finding's next `sequence`; a clash on the
   unique index means another decision came first (409).
4. It answers with the whole review workspace, read again. The browser keeps
   the response read last (`asOf`), since a regeneration can finish after a
   later decision.

Bulk accept adds one `accept` entry per pending finding. Rejected findings
leave the editor and the claims; the review history in the source panel
keeps their text, with Restore.

Regenerate:

1. `POST …/sections/:sectionId/regenerate` with an optional instruction. The
   gateway refuses (409) a section with no saved draft or with a replacement
   already waiting, then drafts as GN-01 does (`section.service.writeDraft`:
   the same evidence and minimum), adding `redraft` to S4's request: the
   instruction and each finding of the saved draft as `{ heading, text,
   decision }`, edited ones in the engineer's wording.
2. S4 (`orchestrator.draft`, `generator.draft_section`) retrieves and checks
   citations exactly as for a first draft. Only the prompt changes: the
   system prompt adds `REDRAFT_RULES`, and the user message adds
   `<current_draft>` (each finding marked with its decision) and
   `<engineer_instruction>` after the evidence. The model keeps accepted and
   edited findings where the evidence supports them, leaves out rejected
   ones, and never cites either block. Provenance records
   `gn01-v2.4+rv02-v1` and the instruction.
3. The gateway saves the result as a `report_sections` document with
   `replacementFor`, and logs `regenerate`. The saved draft stays the
   section's content; the workspace shows the replacement beside it, to read
   and then accept (it becomes the saved draft, every finding pending) or
   discard (nothing else changes).

## Background drafting (GN-13)

Generation drafts the report in the background, in the gateway
(`services/generation/`). Each job calls the same drafting function the old
synchronous routes call, unchanged: `draftOfis` (Section 3), `draftSection`
(Sections 4 to 12; `regenerateSection` for Regenerate from Review) and
`draftSummary` (Section 2), as the engineer who asked. No new prompt or model.

**Run record.** `drafting_runs`, one per assessment (see
[database](database.md#drafting-runs-gn-13)): each part's latest job and the
current drafting run.

**Queue.** `drafting` (`defineQueue`, BullMQ): one job per part, 3 at a time
across all assessments, 3 attempts (the first try and two retries) from a 5 s
exponential backoff. Before the last try a failure puts the part back to
`queued` and BullMQ retries it; on the last it is `failed` with a plain reason.
A job drafts its part only if it can claim it from `queued`, so a duplicate
drafts nothing. Only the drafting call is retried: the `done` write comes after
it, so a failed write never pays for a second draft. When the queue is down
(Redis not answering in 3 s), the part is `failed` with "Drafting could not be
queued. Try again.", the other parts carry on and the run still closes, so
Generation offers Try again instead of "Drafting" for ever. `resumeDraftingRuns`
(from `index.ts`, before the workers start) queues again what a restart cut
off, under a fresh job id (`retryJobId`), as does Section 2's queueing.

**Order.** Out-of-date parts first, in run order (3, 6 to 12, 4, 5), then the
parts the current step allows, Section 2 always last: Section 2's job is added
only once every other part of the run has finished, and dropped if one failed
or the engineer's tasks are no longer done (a redraft of Section 3 suggested
OFIs where there were none).
When the whole run has finished, the bell (`drafting_status`, `context:
{ reference, status, client, site, reportDue? }`) says which parts are ready
("Your draft of Section 3 and Sections 6 to 12 is ready."); each failed part
gets its own ("Section 9 was not drafted.", the reason as `details`), and a
part drafted from Review gets "Your new draft of Section 6 is ready.".

**One check.** `draftingState(reference)` (`generation.service.ts`) works out
each part (drafted, out of date and why), the three tasks, the three steps and
the checkpoint from what is saved now; `GET …/generation` adds `canStart` for
the viewer. MarshBot reads the same function. Out of date: Sections 4 to
12 from `changeCounts` (figures, scope, else observations); Section 3 when the
usable observations' hash differs from the one stored when a job last drafted
it (`ofiEvidence`). OFIs from before GN-13 get today's hash as a baseline the
first time the state is read, so later changes count (earlier ones are not
seen). Section 2 from `staleSections`, or while another part is out of date.
When a job drafted Section 3 and the AI suggested no OFIs at all, the OFI task
counts as done and Section 2 is drafted without any (`currentSections` gives
Section 3 the version `none`); that is read from `ofiEvidence`, so it holds
while Section 3 is redrafted. The `drafting` checkpoint's `done` counts drafted
parts only.

**Push.** Each change to a part calls `publishDrafting` (`assistant/bus.ts`),
which the assistant events stream sends as `event: drafting`; the page then
reads `GET …/generation` again. No polling. Each finished part also calls
`queueAssessmentCheck`, since the re-check middleware doesn't see a worker's
writes.

**Guard.** The old routes (`…/sections/:id/draft`, `…/sections/:id/regenerate`,
`…/ofis/draft`, `…/summary/draft`) answer 409 while their part is `queued` or
`drafting`, so a run and a one-off draft never write one section at once. A
run and a Review request each claim their parts in one write; a Review request
for a part of the run still going is refused (409), even once that part is
drafted. While one of Sections 4 to 12 is redrafted (action `draft`, queued or
drafting), every review decision on it answers 409 ("Section 7 is being
redrafted. …"): accept, edit, reject, restore, bulk accept, the replacement's
accept or discard (`assertNotRedrafting` in the routes), and every save through
`writeSectionVersion` (the document editor, a restore, Ask's Insert, Replace,
Undo, Accept and Delete). Otherwise the decision would stay on the draft being
replaced. A Regenerate doesn't block: its replacement waits beside the saved
draft.

## Asking about an assessment (S4, AS-01)

The review workspace's right inspector has two tabs, Evidence and Ask
(`client/src/features/assessments/components/ReviewInspector.tsx`). Ask
(`ask/AskPanel.tsx`, `ask/useAsk.ts`) answers an engineer's question from the
assessment's own evidence, with citations.

1. The tab reads `GET /api/assessments/:reference/ask` once when the
   workspace opens: the user's own conversations on the assessment (AS-03),
   the latest with its questions and answers (oldest first), and the scope a
   new one searches. See [Conversations](#conversations-as-03) below.
2. A question is one `POST /api/assessments/:reference/ask` with
   `{ question }` (1 to 1,000 characters), and `conversation` to go into the
   one on screen. Its answer streams back as
   server-sent events on that request: `question` (the saved id and the
   conversation it went into), `step`
   (`retrieve`, then `generate`), each checked `statement` with the sources
   it cites (so a citation opens while the answer is still written, and after
   it stops), any `missing` line, then `result` with the saved answer. The tab never polls, so the
   F-07 idle sign-out still applies.
3. The gateway (`assessment-ask.service.ts`) checks `reports:ask` and that
   the user can open the assessment (its assigned engineer or a knowledge
   admin), counts the question against the chat's limits (10 a minute, 200
   a day, $2 a day, shared with CB-01; over one it answers 429 with the
   cause, time and next step), and saves the question in its conversation
   before asking S4.
4. It builds S4's request (`POST /assessments/ask`) itself, never from the
   browser:
   - `observations`: every observation not deleted with something recorded
     (note, finished transcript or transcribed page), categorised or not
     (`COPE_dimension` null), oldest first.
   - `standard_ids`: the standards selected on the assessment, read from
     `knowledge_documents`: the latest checklist's (CP-30), or, before any
     checklist, every standard that applies to the site
     (`listApplicableStandards`). Only those finished, not withdrawn and with
     no Unconfirmed details are kept, so one withdrawn since the checklist is
     no longer searched.
   - `documents`: the name the prompt gives each of those standards and each
     past report matching the site's jurisdiction and facility type.
   - `privacy`: as drafting (`privacyFor`, PV-02).
5. S4's orchestrator (`orchestrator.ask`, prompt and checks in
   `app/generation/ask.py`) runs one pipeline:
   - **retrieve**: one `/mask` call for the question, observations and
     document names; one batched Cohere embed of the question, searching
     the standards' passages through a Chroma `doc_id` filter and past
     reports (`marsh_report`) filtered to the site's jurisdiction and
     facility type (`all` matches either), 20 candidates each; then one
     Cohere rerank of the observations, standards and (masked) past reports
     together, keeping at most 8 observations, 6 standard passages and 4
     past-report passages scoring at least `ASK_MIN_RELEVANCE` (0.1). If
     rerank fails, vector order is used (the first 20 observations).
   - **assemble**: the evidence labelled `O1`, `C1`, `P1`. With nothing
     kept, no model is asked and the answer is one Missing line naming what
     was searched.
   - **generate**: `llm.stream_text` with `LLM_PROVIDER`, `ASK_MODEL`
     (default `LLM_MODEL`) and `ASK_EFFORT` (default `low`), feature `ask`.
     The model writes one statement per line with its citations after it
     (`[O2]`, `[C1 "exact words"]`), or a `Missing:` line.
   - **guardrail**, on each line before it is sent: real values back; a
     citation counts only if it names a label the model was given, and its
     quote is looked for in that passage or observation (`verified`). A line
     with no citation is not shown, nor one in the first person, one that
     recommends, or one that gives a percentage; emoji are removed. If no
     line survives, the answer says no statement could be supported.
6. S4's `result` holds the statements, missing lines, the cited sources (a
   passage's text and Chroma labels, or the observation as sent), the
   confidence, any error (`step`, `cause`, `at`), the usage list and the
   run's trace. Confidence is worked out in code, never asked of the model:
   High when every quote was found, nothing was left out or missing and some
   statement rests on an observation or standard; Low when a line was left
   out, most statements have a quote not found, or only past reports support
   it; Medium otherwise.
7. The gateway records the usage for the report (`ai_calls`: `ask` for the
   model call, `retrieval` for Cohere), adds its cost to the user's daily
   chat spend, saves the answer, its provider, model and times, and the
   trace into the question's turn in `assistant_conversations` (see
   [database](database.md#ask-conversations-as-01-as-03)), and sends the
   browser the saved answer, its passages with their documents' details now
   (as RV-01), without the usage or trace.

Selecting a citation or a source in an answer switches the inspector to
Evidence and opens it there; a source the draft also cites is marked open in
its list. On parts with no draft (Sections 1-3, Appendix A) the source opens
above the part's note.

Failures state their cause and time, then the next step (AC8): "Answer
stopped at 14:02: the model provider did not respond. Ask again." What was
answered before a failure stays. Causes: `the answer service could not be
reached` (gateway to S4), `the evidence search did not respond`, `client
details could not be masked, so nothing was sent to the model`, `the model
provider did not respond`, `the model provider returned an error`, `the
model declined to answer`, `the answer was cut off before it was complete`,
and for a request refused over the limits `more than 10 questions were asked
in a minute` (Ask again in a minute) or `today's question limit was reached`
(Ask again tomorrow). An engineer who leaves while it is written stops it;
it is saved as `stopped`.

Without the gateway the tab says it is unavailable: on the sample assessment
always, and on a saved one when the gateway cannot be reached.

### Asking about a selected passage (AS-02)

Selecting text offers **Ask about this** in two places, both with
Ctrl+Alt+K (Cmd+Option+K), beside Comment's Ctrl+Alt+M (`ask/shortcut.ts`):

- the review workspace's draft editor, Sections 4 to 12 (`ask/AskSelection.tsx`):
  a button by the selection opens the Ask tab (the sheet on a phone). Each
  block of text the draft draws carries `data-ask-block`, its index in the
  section's text, so a DOM selection is read as offsets in that text
  (`ask/draftSelection.ts`; a citation number counts as its one marker,
  badges as nothing).
- the document editor (RV-08): a toolbar button beside Comment, and an Ask
  panel (`ask/DocumentAsk.tsx`) in the comments list's place, with the same
  conversation as the Ask tab; a source an answer cites opens at its top.

A selection that can't be asked about (no words, across two sections, over
4,000 characters) greys the button out with the reason; the shortcut says it.
Either way the passage is kept as a comment thread's anchor is (RV-03,
`comments/anchor.ts`): offsets into the section's text as the document editor
saves it, its words and 32 characters either side (`ask/passage.ts` reads that
text from the saved content too, so both places agree). Its citations are
those of every block it is in; its findings, the keys of those blocks'
findings. The passage waits in the question box, quoted verbatim behind a 2px
rule, until the next question is asked or it is taken off.

1. The browser sends `{ question, passage: { anchor, citations, findings } }`.
   The gateway checks the anchor as RV-03's (`anchorSchema`), and that it holds
   words and at most 4,000 characters (400 otherwise).
2. It reads the section's saved draft, never the browser's copy: the findings
   still in the draft (text now, decision, citations), and the sources the
   draft cites. Only citations the draft holds are kept; each cited standard
   or past-report passage is sent with its words and Chroma labels as the
   draft was given them, and a cited observation deleted since is sent as the
   draft was given it. S4 gets `passage: { section_id, section_title, text,
   citations, sources, findings }`, `text` being the passage's words without
   the markers.
3. S4 masks the passage and the findings in the same `/mask` call as the
   question, searches with the question and the passage's words, and always
   keeps what the passage cites as evidence, labelled first and marked "cited
   by the passage" (not reranked). The prompt (`as02-v1`) shows `<passage>` and
   `<section_findings>` (each with its decision and the labels it cites); the
   findings are the draft under review, never citable.
4. Where the sources behind the passage disagree, the model writes a
   `Differs:` line naming each figure with its source. The guardrail keeps it
   only if it cites two sources or more, and drops any line that chooses
   between sources ("more reliable", "the correct figure", "should be used",
   "takes precedence", "likely a typo"). It is shown as "Sources disagree:"
   and the answer's confidence is at most Medium.
5. The question is saved with `passage: { anchor, label, citations, findings }`;
   the trace's `story` is `AS-02` and its `passage` block holds the section,
   length and citations, never the words.

The Ask tab quotes each question's passage above it, with **Go to the
passage**: the part opens and the passage is marked (the CSS highlight API
where the browser has it, else its blocks tinted; in the document editor a
decoration). The anchor is never moved: each time it is found again from its
words, as RV-03 does, and once they are gone the message says "Text deleted".
Asking writes nothing to the report (AC5): no version, no review log entry, no
mark in the editor's text (`ask/askHighlight.ts` draws decorations only).

### Conversations (AS-03)

The Ask tab's questions are kept in conversations
(`assistant_conversations`, see
[database](database.md#ask-conversations-as-01-as-03)): per assessment and per
user, private to that user, so an engineer can pick up where they left off
and the team can evaluate the answers.

- **Opening**: `GET …/ask` returns the user's conversations, latest first by
  when a question was last asked, and the latest with its questions. The tab
  opens on it; with none yet, the tab is empty and no picker shows.
- **Picker** (`AskPanel.tsx`, `ConversationBar`): a `Select` named
  "Conversation" above the tab lists each by its first question and when it
  was last asked ("Was the B1 valve shut? · 14:02", a day before today as
  "11 Nov 14:02"). Choosing one reads `GET …/ask/conversations/:id`. Beside it,
  New conversation (`plus`) empties the tab; nothing is saved until its first
  question, which `POST …/ask` without `conversation` saves as a new
  conversation, named from it and listed first. Delete conversation
  (`trash-2`) asks first in a dialog naming it and how many questions go
  with it; `DELETE …/ask/conversations/:id` deletes it for good and the
  latest left opens, or a new one when none is left. While an answer is
  written the three are greyed out with the reason, as the answer belongs to
  the conversation on screen.
- **One question at a time into one conversation**: the gateway checks the
  conversation is the user's (404 otherwise, as one deleted) and has room
  (at most 100 questions; 409 "Start a new conversation.") before the
  question counts against the limits, then pushes it on only while there is
  room, so two at once never overfill it.
- **Each question stays stand-alone**: S4 is sent no earlier turns, as AS-01
  decided; a conversation is kept for reading back and for the evaluation
  harness, and each turn can be replayed on its own.
- **For the evaluation harness** (AC3): each turn keeps its cited `sources`,
  `provider`, `model` and `promptVersion` (from S4's trace), `askedAt`,
  `answeredAt` and the whole trace. The browser gets none of these but the
  sources and when it was asked.
- **Archived** (AC5): the list says `archived: true`; the tab shows every
  conversation and its answers, with a note in the question box's place
  ("This assessment is archived, so its conversations are read only. Restore
  the assessment to ask about it again."), and no New conversation, Delete or
  Ask again. Ask about this (AS-02) is greyed out with that reason. The
  gateway refuses asking and deleting with 409.
- **Never in the report** (AC4): the export (`document/export/`) imports
  nothing from `ask/` (a test follows its imports), and the gateway's export
  reads no conversation. Asking, starting or deleting a conversation adds no
  version and changes no review state.

### Drafting and rewriting text (AS-04)

The assigned engineer can have the Ask tab draft text for a section, or
rewrite a passage, then put it into the report (DECISIONS 2026-11-16). It is
asked like a question, in the same conversation and through the same S4 run,
so masking, provider, limits and the trace are AS-01's; what differs is what
S4 may cite and what happens to the answer.

- **Asking**: Draft text, beside Ask, sends `POST …/ask` with `{ question,
  propose: { kind: 'draft', sectionId } }` for the section open (Sections 4 to
  12; in the document editor, the one the cursor is in). Rewrite this, beside
  Ask about this (and in the document editor's toolbar, once saved), puts the
  passage in the question box to be rewritten; the request is then `{ question,
  passage, propose: { kind: 'rewrite' } }`, the question saying how (empty:
  "Rewrite this passage."). Both need `reports:generate` and the assigned
  engineer (403), on an assessment neither archived nor finalised (409).
- **What S4 is told** (`text-proposal.service.ts` `proposalContext`): the
  section's text now, built as the editors build it (`section-document.ts`
  `currentDocument`, the same as the client's `documentContent.ts`). A draft
  sends the subsections it can go in (not tables, not Section 6's programmes);
  a rewrite checks the passage is still at its offsets (409 `moved` otherwise),
  widens it to the paragraphs it is in (plain paragraphs of one subsection, or
  items of one list; a sub-heading refuses with 400) and sends their words as
  the passage, with the sources they cite: observations, and standards in the
  drafting set; never a past report. `standard_ids` are the drafting set (the
  standards selected on the assessment, `drafting-set.service.ts`); no past
  report is named.
- **S4** (`orchestrator.ask` with `propose`, prompt and checks in
  `app/generation/propose.py`, `as04-v1`, `PROPOSE_EFFORT` on `ASK_MODEL`):
  searches the drafting set only, keeps up to 12 observations and 8 standard
  passages, and writes in the drafting guide's voice: a draft's first line
  `Subsection: <heading>` (streamed as `target`), then one sentence per line,
  a blank line between paragraphs. Each sentence is checked before it streams:
  content rules as an answer's (a line breaking one is dropped); a citation
  counts only if it names evidence given and, for a standard, its quote is
  found; a sentence left with none is kept with `supported: false` (AC3), not
  dropped. Each statement carries its `paragraph`. The trace's `story` is
  `AS-04`, with a `propose` block and the guardrail's `unsupported` and
  `uncounted_citations`.
- **Kept**: the gateway saves the proposal in `report_text_proposals` (see
  [database](database.md#proposed-text-as-04)) with what the section was when
  it was made (newest version, saved draft, text signature), and the turn
  points to it. The Ask tab shows it as a card: a rewrite's paragraphs before,
  then the text, each sentence with its citations and any unsupported one
  marked; Insert (with Insert into, when the section has several
  subsections) or Replace. Nothing in the report changes (AC1).
- **Insert / Replace** (`POST /api/assessments/:reference/proposals/:id/insert`
  `{ subsection? }`, `…/replace`): refused 409 `stale` when the section's
  version, saved draft or text differs from when it was proposed (AC6; the card
  offers Draft again), 409 `drafting-set` when a standard it cites left the
  drafting set (AC4). Otherwise the section's next version holds the text as
  paragraphs marked `ai: <proposal id>`, each sentence then its citation
  markers, at the end of the subsection (a draft) or in place of the paragraphs
  it rewrote (a rewrite; a finding among them is logged `reject`, `inDocument`,
  as one deleted in the document editor). The answer is `{ proposal,
  workspace }`; the section is Needs review (AC2).
- **In the section**: the review workspace draws the text in violet with an AI
  draft badge, who inserted it when and what was asked, each sentence still
  unsupported underlined and badged (`aiText.ts`: still in the text word for
  word with no citation marker straight after it). Accept (`…/accept`) saves a
  version without the mark, refused while a sentence is unsupported; Delete
  (`…/delete`) one without the text. Undo (`…/undo`, in the card while nothing
  changed since) restores the text from before as the next version, named as a
  restore (`version:<n>` or `draft:<id>`), bringing back a finding a rewrite
  replaced. The document editor shows it violet too (`dm-ai-text`, its
  unsupported sentences decorated), keeps the mark through edits and splits,
  and drops it on a copy pasted into another section. A save naming a proposal
  never inserted into the section is refused (400).
- **Export**: `exportBlockers` lists a section with AI text awaiting Accept or
  with an unsupported sentence of it (AC3).

### Writing guidance for a section (AS-08)

Two buttons above the Ask tab's question box ask about the part of the report
open (in the document editor, the one the cursor is in): **What should this
section cover?** (`list-checks`) and **What is missing from this section?**
(`list-x`). They are asked by button, never guessed from what is typed
(DECISIONS 2026-11-24), into the conversation on screen, and need only
`reports:ask`, so a knowledge admin can ask too. The question kept is the
gateway's own wording ("What is missing from 9. Fire Protection?"). On an
archived assessment the buttons are not shown and the gateway answers 409.

- **What it should cover** (AC1), Sections 4 to 12: `POST …/ask` with
  `{ guide: { kind: 'cover', sectionId } }`. The gateway names the section
  from S4's template (`GET /sections`; 404 for one it doesn't list), counts the
  question against the limits as any other, and sends S4 `guide: { kind,
  section_id, section_title }` with the standards selected on the assessment
  (as AS-01 reads them) and no observations or past reports. S4
  (`orchestrator.cover`, prompt and template in `app/generation/guide.py`,
  `as08-v1`, `ASK_EFFORT` on `ASK_MODEL`) runs retrieve → assemble → generate
  → guardrail as an answer does:
  - **retrieve**: one `/mask` call for the question and the documents'
    names; the template's definition of the section from `sections.json` as
    evidence, T1 for the section as a whole (its categories and its parts in
    order; Sections 4 and 5 also say their figures are the engineer's), T2
    onwards one per part (its heading, kind and fields); one batched embed
    searching the selected standards (Chroma `doc_id` filter) once per part, 5
    candidates each, then one rerank of them all against the section and its
    headings, keeping up to 8 scoring at least `ASK_MIN_RELEVANCE`. With no
    standard kept it says so in a Missing line, and the model still answers
    from the template.
  - **generate**: one line per statement, the template first, part by part
    (`[T3]`), then what the standards say (`[C1 "exact words"]`), and at most
    two Missing lines for parts no standard covers.
  - **guardrail**: `ask.check_statement`, a template part cited as a whole (a
    quote, when given, must be in it). The content rules are an answer's, so a
    line telling the engineer what to write is dropped as a recommendation.
  - The trace's `story` is `AS-08`, with `guide: { kind, section_id,
    template_parts, template_parts_cited }` and `retrieved.template`.

  A cited part comes back as `template` (`{ id: 'T:9.3', sectionId, label,
  subsection, heading, kind, fields, text }`) beside the answer's passages and
  observations, and is listed under Sources as "Report template". Selecting it
  goes to that part of the section (its note in the draft editor), not to the
  Evidence tab.
- **What is missing** (AC2-AC4), Sections 2 to 12: `POST …/ask` with
  `{ guide: { kind: 'missing', sectionId } }`. The gateway
  (`section-guidance.service.ts`, `sectionGaps`) works it out from what is
  saved, with no AI call, and saves it as the question's answer at once (two
  events: `question`, then `result`). It counts against no question limit. In
  order:
  1. What blocks the export, from `detailedBlockers` (`export.service.ts`), the
     one function the Export tab's check (`blockersFrom`) and MarshBot read
     too, filtered to the section and in its order (AC3). Each blocker carries
     its `fact` beside the Export tab's `reason`: the same condition, stated
     without a next step ("Section 9 has 2 findings waiting for a decision.").
     Sections 4 and 5's missing figures name what reads "Not entered" (e.g.
     "Section 4's risk quality table reads Not entered for 2 of its 7
     categories: Fire Protection (potential) and Water Supply (current and
     potential).").
  2. Parts with no text, once the section has some: no finding still in the
     draft and nothing written in the document editor.
  3. Tables reading "Not entered": every `table` part (Sections 7 to 10), which
     nothing fills yet, so the report prints "Not entered" in each.
  4. COPE categories with no observation its draft can use ("Section 9 has no
     observation tagged Protection."), and each observation tagged with the
     section's categories that the draft leaves out: still to check (CP-24),
     still being transcribed, or with nothing recorded. At most 20 are listed,
     then a count.

  Sections 2 and 3 list only 1. Each gap links to its section (Go to section:
  the part open in the review workspace, scrolled to the finding or the part
  when the gap names one; in the document editor, scrolled to the section) or
  an observation (Go to observation: the Observations tab with it open, or the
  tab itself for a category with none; past the document editor's leave
  guard). The list sits in a grey card, never AI violet, with "As of 14:02",
  what blocks the export first, and a note that it was listed with no AI.
- **Never the report** (AC5): neither writes to sections, versions, the review
  log, comment threads or the assessment; only the conversation keeps them.

## Report export (S2, EX-01)

The Export tab of a saved assessment exports the report as a PDF or a Word
file. Nothing is stored: the file is the gateway's answer.

1. **Check** (`GET /api/assessments/:reference/export`, `reports:export`):
   `exportBlockers` in `server/src/services/export.service.ts` (built by
   `detailedBlockers`, which the Ask tab's writing guidance reads too, AS-08),
   until RV-04:
   only a complete report goes. Section 2 drafted and current; an accepted
   OFI; Sections 4-12 drafted or written, 4 and 5 with every figure; and in
   each draft no new draft waiting, every finding decided, none unsupported,
   out of date or citing a withdrawn source (DECISIONS 2026-11-05); and no
   text drafted from the Ask tab awaiting Accept, nor any of its sentences
   unsupported (AS-04, [Drafting and rewriting text](#drafting-and-rewriting-text-as-04)). Each
   blocker names its section and where it is finished (`where`). It also
   returns `openThreads`, the comment threads still open (RV-03), shown as a
   reminder that never blocks the export; no comment reaches the file, as
   threads are kept apart from the text and the export's editor has no
   comment marks. Nor does any Ask conversation (AS-03 AC4): they are kept
   apart in `assistant_conversations`, which the export never reads.
2. **Save** pending edits (`client/.../pendingSaves.ts`): the document editor's
   next save and Appendix A's queue. One that fails stops the export.
3. **Lay out** (`client/.../document/export/`): `ExportPages` draws the report
   off screen in the document editor's Page layout (RV-12), read-only, with no
   AI styling, review states, flags or notices. `exportDocument.ts` applies the
   choices: citations numbered per section with References after Appendix A
   (`references.ts`: a standard by title, edition, heading and page; an
   observation by location and capture date; a past Marsh report by facility
   type and year only), or no marker at all; Appendix A only when chosen and
   holding photos. Once every part has loaded and the pages have held still
   for four checks 300 ms apart, `snapshot.ts` cuts the report into Letter pages
   where the layout breaks it, each page with its header and footer, a table
   carried onto a page starting with its header again, and photos redrawn at
   300 dpi of their printed size (never above the original). It marks what the
   Word file needs (`data-x-*`; see `export-extract.ts`).
4. **Make the file** (`POST /api/assessments/:reference/export`, 64 MB body):
   the assigned engineer only (403), the check again (409 with `blockers`),
   then `export-render.service.ts` opens the pages in headless Chromium
   (playwright-core) with page scripts off, a content security policy allowing
   only inline styles and data: images, and every request refused. Any text
   still holding a privacy placeholder stops it (422). A PDF is printed as the
   pages size it (Letter, backgrounds on, tagged, headings as bookmarks,
   contents as links, fonts embedded). A Word file is read off the same pages
   (`export-extract.ts`, run in the page; charts and legends pictured at twice
   their size) and written by `export-docx.ts` (`docx`): a navy cover, the
   details page and a Word table of contents numbered i, ii, the report from 1,
   Marsh's header and footer with a page-number field, Heading 1-3, editable
   tables with their header rows repeating and rank colours, Word lists, and
   the photos as embedded. 503 when Chromium is missing or the pages cannot be
   printed, to retry.

Chromium: `CHROMIUM_PATH` (the server image's own), else an installed Google
Chrome, else a Chromium installed for Playwright. `REPORT_TIME_ZONE` (default
Asia/Singapore) dates the file name, `<reference> <YYYY-MM-DD>.pdf`.

## Knowledge chat: cost and speed (S4, CB-01)

One question runs up to four paid steps:

| Step | Model | Paid by |
|---|---|---|
| 1. Plan: rewrite the question as a search, or ask back, or decline | Claude Haiku 5.5 (`CHAT_PLAN_MODEL`) | tokens |
| 2. Search: embed the query | Cohere embed-v4.0 | tokens |
| 3. Rerank the 20 nearest passages to the best 5 (past-report searches: the 40 nearest, keeping the best passage of each report above the cut-off) | Cohere rerank-v3.5 | per search |
| 4. Answer from those passages, streamed | GPT-6.1 Sol (`CHAT_MODEL`) | tokens |

Steps 2-4 are skipped when the planner asks back or declines, and step 4 is
skipped when no passage is relevant enough. A comparison runs up to three searches.
A past-report question can send one passage per matching report (up to the 40
candidates), so its answer step costs more than a standards question (from 16 Oct,
prompt `cb01-v13`; not yet measured).

Measured on the CB-01 eval (61 cases, 90 questions, prompt `cb01-v12`, 15 Oct 2026),
priced with `server/src/services/ai-pricing.service.ts`:

| Per question | Typical (median) | Busy (90th percentile) |
|---|---|---|
| Cost, answered question | $0.013 | $0.021 |
| Cost, asked back or declined (no answer step) | $0.0004 | |
| Answer model input / output | about 3,000 / 220 tokens (output at most 620) | |
| Time to first words / full answer | 1.4 s / 4.8 s | |

- About 87% of an answered question's cost is the answer model, 9% the rerank,
  and under 1% each the planner and the embedding.
- GPT cache reads are priced at the full input price (an overestimate, as OpenAI's
  cache discount isn't modelled).
- Cohere's prices are estimates (`COHERE_*` in `.env.example`); see EV-04 below.

**Rough monthly bill.** 20 engineers asking 30 questions on each of 22 working days is
13,200 questions, or about $190 a month at $0.0143 each (the mean). Each extra question
per engineer per day adds about $6 a month.

**Limits per user** (`server/src/services/chat-limits.service.ts`): a message of at most
4,000 characters, 10 questions a minute, 200 a day, and $2 of chat a day. Over a limit,
the gateway refuses before any model is called. So one user can cost at most about $2
a day, or $44 a month. The refusal is a normal chat reply, picked at random from a few
hand-written phrasings per limit (never the same one twice in a row) so it reads as the
chatbot talking. If S4 can't be reached, the gateway answers the same way (a 200 stream
with a friendly "try again shortly" reply), not a 503.

**Testing doesn't spend money.** Unit tests mock every paid call. Two guards make a
missed mock fail instead of spending:
- rag-service: `tests/conftest.py` blocks any outside network connection.
- server: `vitest.config.mts` points the services' URLs at a closed port.

Scoring the chat for real (`eval.chat_eval`) does spend: a full re-score (answers for
all 61 cases plus two judge runs) costs about $2.

## Chat retrieval ranking by source tier (RT-04)

`POST /chat` takes an optional `tier_order` (tier ids, highest authority first) and each `documents` item an optional `tier` and `jurisdiction`, both set by the gateway. Right after search, `retrieval/ranking.py` `apply_rank` re-orders only the passages scoring within `RANK_BAND` (0.1, `config.py`) of the top relevance score, by tier, ties by score; weaker passages follow in their order, so a tier never lifts a clearly worse passage. A `national_code` document ranks only when its jurisdiction equals the question's `jurisdiction` filter, else it counts as no tier. Passages match their document by `metadata.doc_id`. No `tier_order` leaves the order unchanged.

## Password reset email (F-06)

`requestPasswordReset` in `server/src/services/auth.service.ts` emails a link `APP_URL/?reset=<code>`. The sign-in screen reads `?reset=`, opens the new-password step with the code filled in, and removes it from the address bar.

- **Real email:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `.env`. For Gmail, `SMTP_PASS` is an app password (Google account → Security → App passwords; needs 2-step verification).
- **No `SMTP_HOST`:** nothing is sent. The code is printed in the server console (CI and fresh checkouts).
- **Mail failure:** logged, and the API answers exactly as on success, so a mail outage never reveals which addresses are registered.
- The code is single-use and expires after 30 minutes.
- An account that has never had a password gets no reset email (the response is unchanged): its owner sets the first one from their invitation (below).

## Invitation email (F-08)

`createUser` in `server/src/services/user.service.ts` emails a new account's owner a link `APP_URL/?invite=<code>` (`sendInvitation` in `invitation.service.ts`). The sign-in screen reads `?invite=`, removes it from the address bar, and opens Set your password (`client/src/features/auth/SetPassword.tsx`), which checks the link, then sets the first password. It is a separate flow from the reset, with its own token field and routes.

- Mail goes through the same SMTP settings and `mail.service.ts` transport as the reset. With no `SMTP_HOST` the code is printed in the server console as `[invitation] <email> -> token: <code>`.
- **Mail failure:** logged; the account is still created and shows no open link. The admin resends from the profile (Resend invitation), which answers 503 while mail is down.
- The code is single-use, expires after 72 hours, and works only for an active account with no password. A resend, or correcting the account's email, cancels the earlier link.

## Idle sign-out (F-07)

The gateway ends a session after 15 idle minutes. The browser also runs its own 15-minute timer (`client/src/features/auth/useIdleTimeout.ts`), because the gateway can't tell an idle page its session ended. The two values must match.
## Chat usage (CB-01, EV-03)

`POST /api/chat` (`server/src/routes/chat.routes.ts`) streams S4's `POST /chat`
answer events (AG-UI, server-sent events) to the chat screen. S4 ends every
answer with one more event, `{"type": "CUSTOM", "name": "usage", "value": [...]}`,
listing the answer's paid calls (today the placeholder's one Cohere embed; an
empty list when no paid call was made). `openChatStream` in `rag.service.ts`
saves those calls to `ai_calls` as feature `chat` with the signed-in user's
`userId` (no report), and does not pass the event on, so the browser never
sees it. Every other byte passes through unchanged. S4 starts collecting in
the same generator step as the search, because Starlette runs each step of a
streaming generator in a fresh copy of the context.

S4 sends text as the model writes it; the chat screen paces it
(`client/src/features/chat/smoothAdapter.ts` splits deltas into words and reveals them
at an even rate, keeping the `meta` line whole). When the knowledge base lacks the
answer, the reply is in the model's own words and the `meta` line carries a third
argument, `Meta([...], [...], true)`, which shows the "Ask an admin" or "Add documents"
button (CB-07). An `unverified` entry with `described: true` is a quote only in a
picture's AI description (KB-02). Errors and an empty question get a random friendly phrasing instead of
a fixed sentence; the technical reason stays in `chat_result.error`.

## Usage and Costs report (EV-04)

`GET /api/usage/summary?reportId=` and `GET /api/usage/export.csv?reportId=&groupBy=feature|service` (`server/src/routes/usage.routes.ts`, `usage-report.service.ts`), shown on the **Usage and Costs** screen (`/usage-costs`, `client/src/features/usage/`). Both read the `ai_calls` collection written by EV-03 and need `usage:view`.

The screen (loaded on first open, as it brings the chart library) opens on the report-generation overview for the last 30 days: a Period, Group by (knowledge admins) and Split each bar by row, totals (with calls without a cost, and an Estimated badge when a price is an estimate), a stacked bar per assessment or engineer, and a table of every group below it, searchable by reference, client or site and filterable by engineer. Choosing an engineer's bar or row narrows the overview to their assessments; choosing an assessment opens its drill-in (feature × service chart, cost per report section, the cost breakdown, usage and rates, and speed), which has its own CSV. A risk engineer sees the same overview, limited by the gateway to their own assessments and chat, without the engineer controls.

A knowledge admin also has an **Ingestion** tab (from `GET /api/usage/ingestion`): the same Period and Split row, totals, a stacked bar per knowledge document (titles shortened on the axis, whole in the tooltip and table), and a table of every document with its status, upload date, pages, calls, time per call, total and cost per page, searchable by title or file name, with its own CSV. Choosing a document opens its detail page: file, status, pages and upload date, totals, cost per stage split by service, and usage and rates with the average time per call. An upload refused after labelling shows as `Not saved`.

- **Who sees what:** a knowledge admin sees every report. A risk engineer sees only reports where they are the assigned engineer; asking for another report returns 403. Document ingestion is for knowledge admins only (403 otherwise).
- **Summary:** cost totals and call counts; breakdown by feature (always every feature, chatbot included) and by billed service; latency per feature (average, median, 95th percentile, slowest); tokens, Cohere search units and Whisper audio seconds per feature; the pricing bases used, with calls whose price is an estimate flagged. Calls are counted over `callCount`, so a summed ingestion row counts as all its calls. Its time is the total of those calls, so averages are per call and the percentiles use single-call rows only.
- **Cost:** US dollars, summed over calls that have a cost. A call with no cost is counted in `callsWithoutCost` and never added as 0.
- **Usage and rates (`rateRows`):** both detail pages show their calls one row per feature, service, model and set of rates, in one table per way of billing so every column applies to every row: Claude and OpenAI (input, output, cached input tokens); Gemini, labelling and self-hosted models (input, output tokens); Cohere embeddings (input tokens); Cohere rerank (searches); Whisper (audio minutes). Each cell is `{ quantity, unit, usdPer, per, costUsd, note }` at the rate stored with the calls (`ai_calls.costParts`), never re-priced, so a rate change starts a new row (older first) and each table's subtotal adds up to the total. OpenAI's input is shown net of its cached tokens, which it includes. Trial-key Cohere and self-hosted OCR show $0 with a `note`. A row is `rates: 'charged'`, `'not recorded'` (saved before rates were kept: quantities and its stored cost, no rate) or `'not priced'` (no cost; `note` says why). Parts with no quantity are a dash. The overview and ingestion lists carry no rates.
- **One assessment (drill-in):** with `reportId`, the summary also has `rateRows` (above), `byFeatureService`, each feature's cost split by the service that billed it (features with calls only, costliest first), and `bySection`, what drafting each report section cost: its Claude calls and their Cohere searches, the number of drafts (Claude calls), calls without a cost, and its title from Marsh's template (`2` Executive Summary, `3` Opportunities for Improvement, `7`–`12`). Sections are in report order; drafting saved before sections were recorded is `Unspecified`, last. Without `reportId`, `bySection` and `rateRows` are empty.
- **Ingestion:** `GET /api/usage/ingestion?split=service|feature&range=7d|30d|month|all` (knowledge admins: `usage:view` and `knowledge:manage`) gives what labelling, OCR and embedding cost per knowledge document: title, file name, status, upload date, pages (`ingestion_jobs.pageTotal`, so none until parsing has counted them), calls, total, cost per page, average time per call, last activity and `segments` per billed service or stage. A re-ingested document's runs add up. Labelling for an upload refused after it ran shows as `Upload not saved`; labelling from before calls named their document is one `Not linked to a document` row (key `unlinked`). No uploader is shown: documents are shared, and uploads do not record who made them. `GET /api/usage/ingestion/export.csv` exports it: one row per document, a column per split key, named `usage-ingestion-<split>-<range>.csv`.
- **One document:** `GET /api/usage/ingestion/:key` (knowledge admins) gives one document's ingestion cost, all time: its details as in the list, `totals`, `byFeatureService` (cost per stage split by service) and `rateRows` (above), each with `avgMsPerCall`. Ingestion calls are saved as totals per stage and model, so only the average time per call is known. `key` is the document id, or `unlinked`; a key with no calls is 404.
- **Chatbot:** `GET /api/usage/chat?period=month&at=YYYY-MM` or `period=year&at=YYYY` (`usage:view`) gives the knowledge assistant's chat cost for a calendar month or year in Singapore time: `totals`, `buckets` (a month's days or a year's months, oldest first, up to today, empty ones at 0), `byUser` (each person who asked, with `name`, costliest first), `rateRows`, `previous` (the period before's calls and cost) and `scope.complete` (the period has ended). A knowledge admin sees everyone's chat; a risk engineer only their own. Anything else is 400. The overview's Chatbot row and bar open its page on this month, with Month and Year tabs and a stepper (‹ October 2026 ›) whose forward arrow stops at the current period and "This month" or "This year" to return; it shows totals, the change from the period before (finished periods only), a chart and table of cost per day or month split by billed service, cost per person, and usage and rates. It counts calls, not questions: one question makes several calls, and calls carry no question id. `GET /api/usage/chat/export.csv` with the same period exports its rates (`usage-chat-rates-<at>.csv`).
- **Usage and rates CSV:** the detail pages export their `rateRows`: an assessment's from `GET /api/usage/export.csv?groupBy=rates&reportId=` (`reportId` required, named `usage-rates-<reportId>.csv`), a document's from `GET /api/usage/ingestion/:key/export.csv` (knowledge admins, named `usage-document-<title>.csv`, 404 for a key with no calls). One line per billed part: `feature,service,model,rates,part,quantity,unit,usd_per,per,cost_usd,calls,avg_ms_per_call,note`, where `quantity × usd_per ÷ per = cost_usd` in the part's own unit (tokens, searches for Cohere rerank, minutes for Whisper). A call with no price leaves `usd_per` and `cost_usd` empty; a row saved before rates were kept leaves its rate empty and adds a `stored cost` line, so `cost_usd` adds up to the total.
- **Export:** CSV of the breakdown on screen (one row per feature or per billed service). The overview's is `GET /api/usage/overview/export.csv` with the overview's own query: one row per group (label, reference, client, site, engineer, last activity, calls, calls without a cost, total), then one column per split key, named `usage-by-<groupBy>-<split>-<range>.csv`.
- **Overview:** `GET /api/usage/overview?groupBy=assessment|engineer&split=service|feature&range=7d|30d|month|all[&engineer=<userId>]` gives report-generation cost across assessments or engineers, for the stacked bar chart and the table under it. Each group has its total, calls (summed over `callCount`), calls without a cost, `lastActivityAt` (for sorting by time) and `segments`: cost per billed service or feature. `splitKeys` lists every split key present, costliest first. Document ingestion (`label-document`, `ocr`, `embed-document`) is left out; it has its own view.
  - **Whose a call is:** a report call belongs to the assessment's *assigned* engineer, looked up when the report is read, so reassigning an assessment moves its cost. A chat call belongs to the user who asked (`userId`). Grouped by assessment, chat is one `Chatbot` group (key `chat`); grouped by engineer, it is part of the asker's bar. An assessment with no engineer is grouped as `Unassigned`.
  - **Period:** `7d` and `30d` count back from now; `month` starts at 00:00 on the 1st in Singapore (UTC+8, no daylight saving); `all` has no limit.
  - **`engineer`:** only the calls attributed to that engineer, for when their bar is chosen.
  - **Scope:** as for the summary: a risk engineer sees only their assigned assessments and their own chat.
- **Demo data:** `npm --prefix server run seed:usage` (after `seed`) writes fake rows tagged "DEMO data" for the sample assessments and the sample engineers' chat, and replaces them on every run. It writes no ingestion rows. How to discard them is in [RUNNING](../RUNNING.md) §5.


## Who is told what (F-10, RV-11)

Every notification goes through `createNotification` in the gateway's
`notification.service.ts`, which sets its `kind` (Inbox or bell) from one lookup;
see `docs/areas/database.md`, "Inbox and bell". The producers:

| Producer | Purpose | Goes to |
|---|---|---|
| Ingestion worker, via `POST /api/internal/notifications` | `ingestion_status` | Inbox when failed or needs review, bell when finished |
| `knowledge-gap.service.ts`, a new request | `knowledge_gap_request` | Inbox, all admins |
| `knowledge-gap.service.ts`, filled or dismissed | `knowledge_gap_request` | bell, the asker |
| `assessment-assign.service.ts`, an assessment created for or moved to another engineer | `assessment_assigned` | Inbox, that engineer |
| `assessment-assign.service.ts`, an assessment moved away | `assessment_moved` | bell, the previous engineer |
| `site-walk-notice.service.ts`, proposal ready | `site_walk_ready` | Inbox, the assessment's current engineer |
| `site-walk-notice.service.ts`, walk failed | `site_walk_failed` | Inbox, the assessment's current engineer |

Rules every producer follows: address a person by their current role, looked up
(`audienceOf`), never a role written into the code; never tell people about their
own action (an admin assigning to themselves, or moving work away from
themselves, makes no notification for them); and never let a failed notification
fail the action that already saved (they log and carry on, except the site walk
"ready" one, which throws so the queue sends it again).

A site walk fails in three places (the reading runs out of retries, a recording
cannot be transcribed, the job cannot be queued); each tells the engineer once
per attempt. An attempt is the walk's `retries` count, which Retry increments.

## Assessment assistant (MarshBot, AS-06)

MarshBot is the Overview tab: a saved conversation that tells the engineer the
assessment's stage, what to fix and the next step, one topic at a time. Its
cards only show and point (a button opens the tab where the work happens); the
only things it changes are the choices under its newest turn and "Try Again" on
a failed transcription. A choice with a `link` (Add observations, Export Again)
only opens a tab and posts nothing. It never takes typed input and sends
nothing to the bell or the Inbox.

**In the browser.** The newest bot turn has one action slot under its last
bubble or card: that card's `cta` (e.g. Open Generation), then the choices;
older turns show none. Scrolled away from it, a sticky bar at the bottom of the
conversation repeats those buttons, with a round arrow that scrolls back to the
newest turn. A 409 with `code: 'reply-not-asked'` (already answered, e.g. in
another tab) only re-reads the conversation, quietly. The Review and Generation tabs count 11 parts (Section 1 not counted), as
MarshBot does.

A bot turn is one message: its words share one bubble, opening with the bold
lead line when the turn brings something to do or decide; cards and a
stand-out message (an overdue report) stand alone. A bar above the conversation
names the stage and lists its topics (`agenda`: done, still open, now, to
come); on a computer a raised topic jumps back to its turn. A "Moved on to
<stage>" marker sits in the conversation where the stage changed, and the rail
shows the day each finished stage was finished. A choice that moves the stage
carries a line under the choices (`reply.hint`, "Clicking “That's everything”
will move the assessment's status forward to Ready for generation."), and
"What else?" carries "Up next: <topic>". A bold name in the words that one of
the turn's cards lists is a link to it.

**Stage.** `Assessment.stage` is one of Setup, Prepare, Capture, Ready for
generation, Generate, Review, Ready to export, Exported, with `stageDates` for
when each was entered. It only moves forward: each re-check stores the furthest
stage the data proves (`services/assistant/stage.ts`), never an earlier one.
Generate becomes Review only when all 11 parts are drafted, as Generation's
`draftingState` counts them (GN-13); a review decision alone no longer moves it.
Archived stays separate (`archivedAt`), and the derived `status` used before
AS-06 is unchanged. `npm run migrate:stages` works the stage out once for
assessments made before AS-06. Ready to export needs the export check clear and
no open comment thread (`exportClear` in `stage.ts`): an open comment keeps the
assessment in Review, and the Review outline and the rail never count a section
with open comments as reviewed (its row is "Open Comments" and the words name
it and its count).

**Re-check.** `recheckAssessment(reference)` (`recheck.service.ts`) loads the
assessment's data once, advances the stage, runs every check in
`services/assistant/checks/` (one file per item kind) and saves one brief per
assessment (`assistant_briefs`: items, checklist areas, sections, facts,
coverage). It runs:
- after any 2xx non-GET under `/api/assessments/:reference/**`,
  `/api/observations/:id/**` or a client document route
  (`middleware/assistant-recheck.middleware.ts`);
- when background work finishes: transcriptions, handwritten pages, photo
  reading, site walk proposals (`queueAssessmentCheck` in those services);
- once a day for date-based items (`scheduleDailyAssessmentChecks`, 00:05
  Singapore).
Changes within 2 seconds are checked together (BullMQ job id
`as-check-<ref>-<window>`). A failed recording or page that stops being raised
is stamped `facts.outcome`: `removed` when the engineer deleted it (its row
says "Recording removed" / "Page removed"), else `done`.

**Conversation.** `assistant_threads` keeps one thread per (assessment,
assigned engineer): today's session and up to 10 earlier ones. The engine in
`services/assistant/thread/` is pure: `advance()` takes the thread, the brief,
now and an event (open, changed, reply) and returns the turns to add. A session
is one day (or a stage that moved on after a 30-minute pause) and opens with a
greeting or a catch-up. MarshBot raises one topic at a time per stage
(`thread/topics.ts`, `STAGE_TOPICS`) and waits: a "To Do" topic until its rows
are done or skipped ("Skip for now" names what stays in To Do; its words are a
numbered list, one step per place, when there are 2 or more), a question for
its own replies, any other topic offers "What else?" while another topic is
waiting. The Setup card keeps one row per detail (Report Due Date, Site
Contacts, Client Documents) that ticks in place with its value; with nothing
missing, MarshBot says so and asks "Ready to move on to Prepare?" with one
choice, "Move on to Prepare" (`to-prepare`, same effect as "Nothing more to
add"). When something it listed is sorted (`thread/reactions.ts`), it posts one
`noticed` turn: what it saw, in words for each kind of item (never an item's
title as a label), and what is left (Setup names it, To Do and Gaps count it,
Before the Survey counts it or says nothing is left until the survey day,
Review names the findings and comments that hold it), with the waiting topic's
button (e.g. Open Review) while something is left. The last Setup detail turns
that turn into the Prepare question; fewer open comments are said too ("1
comment is resolved"). Each item is said once (`seen:<id>` in `said`), and the
next day's catch-up skips it. When the coverage check runs again after the
gaps were raised, a `recheck` turn says what cleared, any new gaps and what is
still open (a gaps card of a new kind comes with it); a check that fails then
gets one `recheck-failed` turn; the typing dots show while it runs. None of
this is said once the stage has moved past Capture. A stage move says which
stage and why, both under an open session ("… has moved on to the Review
stage now that all 11 sections are drafted.") and in the answer to a choice
that moved it ("Thanks! Setup is confirmed, so I've moved this on to the
Prepare stage."). Turns from before a stage move keep the cards they showed
then (`frozen`), and a row that is no longer open ticks with "Done". Survey day passed asks "Another visit", "Add observations" (opens
Observations) or "That's everything"; the first two carry their own icon
(`reply.icon`: `calendar`, `plus`). Exported with sections changed since says
which, shows the "Changed Since Export" card and one "Export Again" choice that
opens the Export tab; nothing is asked. In Generate, the "next-step" topic
(`thread/topics-drafting.ts`, under To Do) names Generation's checkpoint, which
the re-check copies from `draftingState` into `facts.drafting`, with the button
Generation offers (Open Review while the engineer's input is needed, Open
Generation, Open Observations, or none while drafting or transcribing); a new
checkpoint is named again at once. While it waits on the engineer
(`input_needed`, `needs_observations`, `ready`, `failed`, `out_of_date`) it
offers only that button, no "What else?" (board 18). In Review and Ready to
export it speaks only for `out_of_date` (in Ready to export only when Draft
Again doesn't), `failed` and `drafting`, never for `drafted`. Generate-stage links never point at a section
row on Generation: figures and draft questions open the section in Review, out
of date, not drafted and the summary open Generation, and the Sections outline's
rows open a drafted section in Review. The gaps turn gives "Not Covered" and
"Thin" each its own lead-in bubble, then a closing bubble; such a turn keeps
its `order` and starts with the gateway's own program in that order. A new Fix
now item is raised at once. Cards in today's session are rebuilt from the brief
on every read (a fixed row ticks in place); earlier sessions are frozen. Turns'
words never change. The rules give every piece of words its form (`Say.tone`):
plain, good news (green), the lead line, a tick (a catch-up with 2 or more
changes is a tick list), a numbered step or a stand-out message (the report is overdue; a
report due within 7 days is a sentence at the end of the greeting). `thread.service.ts` loads and saves the thread (one advance
per thread at a time, `lock.ts`); a re-check that changed the brief advances it
only when the Overview is open (a live event stream) and the engineer opened it
in the last 30 minutes. An archived assessment is shown read only and never
advanced. An admin's view is built on the fly and nothing is saved.

**Push.** After saving, the re-check and the thread call `publishBriefChanged`
(`services/assistant/bus.ts`). The open Overview listens on
`GET /api/assessments/:reference/assistant/events` (server-sent events, auth
without refreshing the session cookie, a ping every 25 s, closed when the
session expires so the browser reconnects with a fresh cookie) and reads the
conversation again. No polling. The channel is in-process: a gateway running
as several instances would need Redis pub/sub instead.

**API.** Under `/api/assessments/:reference/assistant`: `GET` the conversation
(`AssistantThread`), `POST /replies` (`{ replyId, date?, lastTurnId? }`: only a
reply offered now, and only while `lastTurnId` is a turn of today's session
with no engineer turn after it (MarshBot's own turns don't count), else 409
with `code: 'reply-not-asked'`, so a second press adds nothing; an archived
assessment is 409 without that code; e.g. another visit with its date moves
`siteVisitEndDate`), `POST /activity` (the browser's engaged time and content
seen per place, sent with `sendBeacon`). Each row of `GET /api/assessments`
carries its `stage` and, for the engineer's own assessments, a `priority` with
its Focus rank (AS-07; `rankedFocus` in `focus.service.ts`: overdue first, then
least time to spare; Fix now puts an assessment in Focus but ranks by its spare
time too); the Focus list is those rows in rank order. Client
page visits carry the same. An admin, or anyone who isn't the assigned
engineer, sees the stage and progress only, never the engineer's activity.

**AI.** Two rag-service routes, both masked through privacy-service and failing
closed (503 when privacy-service is down):
- `POST /assistant/coverage` finds checklist items no observation covers and
  observations too thin for their section. It starts when the Overview opens
  and the evidence changed, at most once a minute, from the first checklist
  and categorised observation until Review. The "gaps" topic waits for it
  (typing dots) and raises its result as "Not Covered" and "Thin", each card
  with a `help` line on what clears a row. Model
  `ASSISTANT_COVERAGE_MODEL`.
- `POST /assistant/wording` rewords each new bot turn once as an OpenUI Lang
  program (`Reply`, `Lead`, `Say`, `Ticks`, `Steps`, `Alert`, `Card`). The rules pick
  the format and the AI only words it: each piece is sent with its form, and a
  card as its id and kind only (nothing a card shows is sent). The gateway
  (`wording.service.ts`) never words the greeting (it shows at once in its rule
  words), waits at most 4.5 s for the other new turns, and keeps a program only
  when it has
  the same pieces in the same order as the gateway's own program for the turn
  (`programOf`; a run of plain words counts as one), so the AI can't add, drop
  or move a lead line, a tick, a step, a green or stand-out message or a card.
  Each part (the lead line, the stand-out message, each tick or step, a run of
  plain words)
  is then checked against the rule words it rewords: the same numbers; the
  same names (the viewer's first name, the site, areas, sections, places); the
  same stage, weekday and month names; no tick, list mark or pictograph typed
  into the words; and bold only on a name the rules wrote in that part, with
  every `**` closed. Otherwise the turn is drawn from its rule words in the
  same format. The prompt tells the AI never to add the viewer's name: without
  the greeting in the batch it put "Sure, Alex!" into the next turn, and the
  name check refused 20 of 66 turns (round 9). rag-service also leaves out a turn whose masked value runs
  across a sentence end (a mis-read name), so it keeps its rule words. Known
  limit: inside one part a number is not tied to the word beside it. Model
  `ASSISTANT_WORDING_MODEL`.
The prompt file `app/assistant/marshbot_components.txt` is generated from the
client's MarshBot library (`UPDATE_PROMPT=1`). MarshBot uses
`@openuidev/react-lang` 1.1.0 under the npm alias `openui-lang-v1`; the
knowledge chatbot stays on 0.4.1.

**Numbers.** Server thresholds are in `services/assistant/settings.ts`, Focus's
work-left days in `focus.service.ts`, and the browser's activity numbers in
`client/src/features/marshbot/settings.ts`.

## Splitting a shorthand note (CP-35)

`POST /split-note` (rag-service `site_walk/note_split.py`) takes a note's lines, the engineer's
own glossary and `privacy`. It masks the lines through privacy-service (fail closed: 503, no model
call), makes one model call under `LLM_PROVIDER` (feature `split-note`, prompt `cp35-v1`), then
unmasks and checks in code: a number or unit in a part's shorthand that its text lacks is flagged
`number_changed`, and a model-reported unknown term is flagged `unknown_term` only if neither the
Marsh list (`retrieval/site_abbreviations.json`) nor the glossary holds it. Empty parts are
dropped; a line the model skipped comes back as one fact part. `scripts/make-shorthand-notes.py`
is a dev script that asks Gemini once for invented test notes (needs `GEMINI_API_KEY`).

**Hand-off of the other two kinds (CP-35).** Info requests: `GET /api/assessments/:reference/to-ask`
(`toAskFor` in `observation.service.ts`, `assessments:view`) lists the `info_request` parts of the
assessment's observations, oldest first; the Observations tab shows them as "To ask the client".
Recommendations: OFI drafting (`ofi.service.ts`) sends each observation's `recommendation` parts as
`observations[].recommendations` (`draftingRecommendations` in `section.service.ts`), never in
`toEvidence`. rag-service masks them with the note (`_mask_evidence`), prints them as
"Engineer's recommendation:" in the OFI prompt (`gn05-v7`), and the guide says to base the fix on
them without adding actions. An OFI that rests on such an observation is saved with
`fromRecommendation: true`. Facts stay the only part read as evidence.

## Walkthroughs and the practice assessment (gateway, client, F-12)

MarshBot's walkthroughs are fixed text in the client. The gateway only keeps each account's
record, makes the practice assessment, and answers one question before a try-it.

- **Routes** (`routes/walkthrough.routes.ts`, a session and no permission, the caller's own
  account only): `POST /api/walkthroughs/practice` (Reset and "Set it up again": hides the old one,
  makes a fresh one, 201 `{reference}`), `DELETE /api/walkthroughs/practice` (Remove: hides it, 204),
  `GET /api/walkthroughs/check?for=<walkthrough id>` (`{ok}`; 404 when that walkthrough has no
  try-it). The record itself rides on `PATCH /api/settings/me` and the signed-in user (see
  docs/areas/database.md, "The walkthrough record").
- **First sign-in** (`ensurePractice`, called while building the signed-in user): makes the
  practice assessment once, unless the user removed it. It never throws: a failure is logged and
  sign-in carries on with `practice: null`. It is made as `practice: 'making'` (open to no one,
  listed nowhere) and made live only once filled; two tabs at once make one (the unique index
  on live ones decides, and the loser removes its own unseen copy), and a call that finds one
  still being made answers `null` (one over a minute old counts as abandoned). Remove saves its
  "removed" mark before it hides, and first sign-in reads the mark first and again after
  making, so a Remove at the same moment is never undone.
  The record service loads the practice service lazily, because `settings.service` imports the
  record service and the practice service reaches `settings.service` again through drafting.
- **The quick check** (`walkthrough-check.service.ts`): a try-it is a walkthrough step that calls
  live AI on the user's own input (6 walkthroughs: `new-docs`, `new-observation`, `split-note`,
  `site-walk`, `ask`, `chat`). Before one is offered or started the client asks the check, which
  calls each needed service's `/health` and one tiny provider request: rag-service
  `GET /health/providers?need=llm|chat|search|privacy` (a one-word request through the same
  provider layer and `X-Model` as real work) and speech-ocr-service `GET /health/providers`
  (the speech-to-text model's metadata, no audio). No client text is sent. The free health calls
  run first, and the provider calls only when they all pass. Health calls time out at 5 s and
  provider calls at 15 s; any failure is `ok: false`. A pass is remembered for 5 minutes in
  memory and a fail for 30 s, per set of checks and drafting model, and requests that arrive
  while a check runs share it. The tiny language-model call is recorded under `walkthrough`.
- **Try-its use the real features** on the practice assessment, so masking, fail-closed behaviour
  and every hard rule hold unchanged. The chat question and the sample email have no assessment:
  the client sends `x-walkthrough: <id>` on those requests and `walkthroughUsage`
  (`middleware/practice.middleware.ts`) marks the request so its calls are recorded the same way.
  It honours the header only for those two ids on their own routes (`chat`: `POST /api/chat`;
  `new-docs`: `POST /api/client-intakes` and `/:id/read`), so a real assessment's request keeps
  its usage.
- **MarshBot on the practice assessment** re-checks on change and pushes to its open Overview as
  for any assessment. It is left out of the daily re-check and of Focus.
- **Client** (`client/src/features/walkthrough/`): one engine mounted once at the app shell
  (`WalkthroughHost`). Each screen with a walkthrough makes one `useWalkthroughScreen(key, ready,
  hold)` call; features raise `signal('<name>')` when something a hands-on step waits on has
  finished; nothing polls. A definition is data in a `*walkthroughs.ts` file beside its feature
  (found by `registry.ts`), and each step points at a `data-walk` tag. The dimming and cut-out are
  drawn by driver.js (pinned, `spotlight.ts`), round an invisible stand-in placed where the cut-out
  goes (several tags' union, clipped to the window, kept clear of the bubble and the phone sheet).
  Only its drawing is used: the bubble, keys, focus and what can be pressed are the engine's own
  layer, placed inside the open modal dialog when there is one (a layer in `body` sits under a
  native dialog); there the layer doubles as the dialog's `driver-layer`, so the dimming is drawn
  under the bubble. An `apart` step's other cut-outs are added to driver.js's path whenever it
  redraws. A walkthrough whose place has `{practice}` always plays on the practice assessment.
  - **What a step can ask for** (`types.ts`): a tag ending in `?` is lit only where it is on the
    screen (table headings a phone layout leaves out); `apart` gives each tag its own cut-out
    (three buttons with others between them); `show: 'end'` shows the end of a target too tall to
    show whole. Before a step shows, its target is scrolled into view through every scroll
    container round it and clear of any pinned bar over its edge.
  - **On a phone** MarshBot's words always show whole, and the sheet never covers what they name.
    The sheet goes below the target when it fits whole, else above it. When it fits neither, a
    target shown from its end (`show: 'end'`: Confirm all parts, the drawer's Tools list) gets the
    sheet at the top and is lit from its first whole row under it to its end; any other target is
    scrolled to the top (clear of the sticky header) and lit from its top down to its last whole
    row above a sheet at the bottom (the top only if that would show less than its first row). A
    row (a block no taller than 120 px and at least half the target's width) is never cut: one
    the edge crosses is left out whole, a dim gap of at least 8 px stays between the cut-out and
    the sheet, and the cut-out never goes past what the target's scroller shows (a target running
    past the screen is lit down to its last whole row on it). On any screen size, a bar pinned
    over a target's edge (the Ask panel's question box over the answer) is never lit with it
    (`pinnedCut` in `placement.ts`, used by `targets.ts`). Only a target with no whole row on
    either side keeps the sheet to the larger side, cut between two lines. The one exception to the gap: a target whose own top is at most 8 px under a sheet at the top
    is lit from that top (the admin's Tools list). Split note's parts and Insights' three panels
    draw compact while lit there (CSS keyed on `data-walk-on`). The cut-out opens with the sheet,
    after that scroll (opened before it, it lit what scrolled into the target's old place), and
    Back and Next stay whole at the sheet's foot.
  - **Hands-on steps, one model** (`do` and `until`): `do` is only what the person does. A single
    `press` keeps the spotlight until the press; with more to do (a `signal`: a menu, typing, a
    recording; or several actions) the spotlight goes at the first press or key inside the cut-out
    and the bubble stays where it is. The person's own save landing (Confirm, Accept, Save) is a
    `do` signal, so a refused save leaves the step showing. The moment the last action lands, the
    bubble and the spotlight leave together and nothing of the walkthrough shows while the app
    answers. `until` names the app's own "result is ready" signal (an AI answer, MarshBot's turn
    shown): the engine waits for it (remembered if it came early), keeps the result on screen alone
    for 1 s (`QUIET_MS` in `run.ts`), then shows the next step, the result, after the settle
    rule. When that next step needs an `open` press (New Observation's result is on the
    Observations list), the engine makes it a second after the person's action, so they watch the
    app work on the right screen. An answer that sets the app working ("Use the sample email") can
    carry an `until` too. That wait is never open-ended: it lasts at most the walkthrough's
    `fail.slow` time (its own line, then it ends) or else 90 s (`QUIET_LIMIT_MS` in `hands.ts`), after which a
    hands-on step shows again when its control is still there, and otherwise ends with the "didn't
    work" line, as a try-it does. A refused answer ends
    it at once the same way: the Overview raises `try-it-failed` for a refused reply while its
    walkthrough plays (`MarshBotOverview.tsx`). Leaving the screen during the wait (an app link,
    which fires no Back event) ends the walkthrough as a skip, noticed through
    `useWalkthroughScreen`'s cleanup. During the wait the walkthrough takes no key (`keys.ts`): Esc
    closing a menu goes to the app and never skips a walkthrough the person cannot see. The same
    goes for Esc outside the bubble once a hands-on step has let its spotlight go: it closes the
    list the person opened (a press on a list's text leaves focus on the page's body, so this is
    not decided by focus), and Esc from the bubble still skips. A person who leaves in
    the second before the engine's own press ends it as a skip too (`hands.ts`). A screen reader hears "I'll carry on when this is ready."
    meanwhile (a polite status line in `WalkthroughHost`). There are no waiting steps.
  - **Back** is greyed where the step before cannot show again: it was hands-on, or this step
    opened something.
  - **A used-up practice assessment** (the one amber observation already confirmed, the sample
    walk already created): when a hands-on walkthrough cannot find its target there, the engine
    resets the practice assessment and plays the walkthrough again, once. Reset, Remove and
    "Set it up again" raise `practice-changed`, and the assessments list reads itself again.
  - **Unsaved work**: a screen passes `hold: 'unsaved'` while it has any. A walkthrough that
    would have to leave that screen does not start; MarshBot says it will wait.
  - **A slow try-it** (`fail.slow`): when the app's answer (`until`) has not come within its time,
    the walkthrough ends with its own line (the site walk: 90 s) and the AI's work carries on.
  - **The site walk try-it** learns its walk is ready from the assessment's event stream (the
    MarshBot re-check that follows reading pushes), then reads the walk once. The recorder's own
    5 s re-read still stops at Finish walk, as before.
- **Help tips** (F-13): `HelpTip` in the design system is the one (?) button and popover;
  `features/help/Tip.tsx` adds the tip's fixed text (`features/help/tips.ts`), its roles and the
  "Show me" link, which replays a walkthrough through the engine.


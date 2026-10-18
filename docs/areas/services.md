Per-service internals: ingestion pipeline stages, RAG orchestrator flow, speech/OCR processor notes go here.

## Speech (S5) and voice transcription (CP-03)

1. The client saves an observation with its recordings to the gateway, which
   stores each recording in S3 and saves it as `transcribing` (see
   [database](database.md#observations)).
2. The gateway posts `{ "s3_key": ... }` to S5's `POST /transcribe` (via
   `SPEECH_OCR_SERVICE_URL`) without making the client wait.
3. S5 reads the audio from S3 with boto3 and sends it to the OpenAI Whisper API
   (`WHISPER_MODEL`, default `whisper-1`; needs `OPENAI_API_KEY`). The file name
   keeps the key's extension, which Whisper uses to pick the decoder. S5 returns
   `{ "transcript": ... }`, or 502 with `detail` explaining the failure. It
   writes nothing to MongoDB.
4. The gateway stores the transcript or the failure reason on that recording.
   The client re-reads the list every 3 seconds while a recording is
   transcribing.

Transcription runs inside the gateway process (no queue or worker). If the
gateway restarts mid-attempt, startup marks that attempt failed with a reason,
so the engineer can retry it instead of waiting forever.

Running S5 outside Docker: `.env` points `SPEECH_OCR_SERVICE_URL` at
`http://localhost:8003` (Compose overrides it with the Docker hostname). If a
recording fails with "The speech service could not be reached", S5 is not running or
the gateway was started with the Docker hostname. S5 also needs the AWS
credentials, `S3_BUCKET` and `AWS_REGION` from `.env`.

## Photo interpretation (S5, CP-05)

1. Saving an observation with photos stores them in S3 (CP-04) and reads
   nothing: no photo goes to the vision model until an engineer asks. Read
   photos on the Observations tab sends `POST
   /api/observations/:id/interpretation`, which saves the observation with
   `interpretation.status: 'interpreting'`: one interpretation covering all
   its kept photos, whose ids it records in `photoIds` (see
   [database](database.md#observations)). Photos added or removed later
   (CP-08) leave a finished reading out of date; Read again on the tab sends
   the same request, reading the photos kept then.
2. The gateway posts `{ "s3_keys": [...], "location": ..., "note": ... }` to
   S5's `POST /interpret` without making the client wait. The location is where
   the observation was made, most specific first ("Pump room, Level 43,
   Tower 1"; see `locationText`); the note is
   as the engineer wrote it. The engineer's category and severity are not
   sent, so the proposed category is the model's own.
3. S5 (`app/processors/vision.py`) reads each photo from S3, turns it upright
   from its EXIF orientation, shrinks it to 1600 px on the long edge and
   re-encodes it as JPEG for the model only; the original in S3 is never
   changed. It sends them to the provider named by `VISION_PROVIDER` (only
   Gemini is implemented: `VISION_MODEL`, default `gemini-3.8-flash`, needs a
   paid-tier `GEMINI_API_KEY`, with `store: false`) and asks for a fixed
   answer:
   - `description`, in the form Marsh's reports use ("During the site visit
     to …, it was observed that …");
   - `cope_dimension`, one of the four categories;
   - `hazard_type`, one of the OFI Types in Marsh's sample reports, `Other`,
     or `No hazard visible`, so the model never has to invent a hazard.
   It returns those with the provider, model, `prompt_version` and token
   `usage` (null when the provider reports none), or 502 with `detail`. Like
   transcription, it writes nothing to MongoDB.
4. The gateway stores the proposal, or the failure reason, on the
   observation. It also saves the call to `ai_calls` (EV-03) as
   `interpret-photo`, billed to `gemini-vision`, tagged with the assessment:
   thinking tokens are added to output tokens, since Google bills them as
   output, and the duration is the gateway's own timing of the request
   (S5 sends none). A failed request returns no usage, so nothing is saved. A failure can be retried through the same route; a restart
   marks an attempt still running as failed. The client re-reads the list every 3 seconds while any
   observation is interpreting.
5. The proposal is for the engineer to review and is never drafting evidence:
   drafting does not wait for it, never reads it, and a draft does not go out
   of date when it arrives. On the Observations tab, Use as note and Change
   category open the Edit dialog with the proposal filled in; only saving it
   makes it the engineer's own.

Running S5 outside Docker: as for transcription, plus `GEMINI_API_KEY`. The
reference photos for judging the prompt are in
`microservices/speech-ocr-service/eval/` (`uv run --extra dev python -m
eval.interpret_photos`).

## Knowledge document ingestion (IN-01)

1. The admin drops or picks PDFs on the Knowledge base screen; nothing else is
   asked (IN-05). The client sends one `POST /api/knowledge-documents?fileName=…`
   per file as soon as it is added, so a rejected file never blocks the others.
2. The gateway first fingerprints the file (sha256) and rejects it with 409 if a
   stored document that is not failed has the same fingerprint (IN-07): no
   `/inspect`, no `/label`, no S3 write and no job. Then it rejects anything that is not a PDF (Content-Type and `%PDF-`
   header, 415), then asks the ingestion service's `POST /inspect` to open it
   with PyMuPDF (422 with the reason if it is corrupt, password-protected or has
   no pages). Nothing is stored for a rejected file.
3. The gateway asks the ingestion service's `POST /label` for the file's
   details (IN-05, see "Automatic labelling" below; 180 s timeout). If labelling
   fails, the upload still goes ahead with every detail Unconfirmed. The
   document's id is chosen before this call, so `/label`'s paid calls are
   saved to `ai_calls` against it (EV-03), even if a later step rejects the
   upload.
4. The gateway stores the original in S3 at `knowledge/<id>.pdf`, records it in
   `knowledge_documents` as `queued` and adds a BullMQ job (`jobId` = document
   id) to the `ingestion` queue in Redis. If the queue is down, it removes the
   record and the file and answers 503.
5. `ingestion-worker` (same image as the ingestion service, `python -m
   app.worker`, concurrency 1) claims the document, downloads the original,
   runs `app.pipeline.run(path, doc_id=<id>, labels=..., reporter=<ProgressReporter>)`
   so chunk ids are `<id>:<n>` and every passage carries the document's
   labels (KB-01; an Unconfirmed one is left out, and `status` is
   `needs_review` until the match step below has finished) and its own `section`
   (IN-05, the report section it sits in, `Not applicable` or `Undefined`).
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
   `context.status: needs_review`, which the bell opens as the Review page. A job whose worker died mid-run is
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
   2. another edition of the same body and number (both standards, both
      editions known, different year), whatever the share: `newer_edition` /
      `earlier_edition`, against the family's non-withdrawn edition, else the
      newest; ties go to the one sharing more passages;
   3. a copy candidate that is a standard of the same body with a known,
      different edition, when a number is unknown: the same edition kinds;
   4. any other copy candidate: `possible_copy`;
   5. otherwise no match. Same number and edition with a low share (different
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
`earlier_edition` adds `add_as_older`; if the matched document also needs
review, `discard_other` is added.

| Choice | Effect |
| --- | --- |
| `keep_both` | Clears `match` (and the other document's, if it points back here). The matched document keeps its status |
| `discard_new` | Deletes the document completely: passages, then the S3 file, the `ingestion_jobs` row and the record. Passages go first so that if Chroma is down nothing has changed. Every document that matched it is then re-matched; one that now matches nothing leaves Needs review |
| `discard_other` | The same, for the matched document. The reviewed document is then re-matched too |
| `supersede` | The reviewed (newer) edition becomes active; the stored one is withdrawn (who and when, as KB-01; an existing withdrawal is kept). Both get the same `editionFamily`: the stored document's, or its `_id` if it had none |
| `add_as_older` | The reviewed (earlier) edition joins the stored one's family and is stored withdrawn |

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
   by country and facility type in the browser.
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
   refuses (409) while any of their recordings is still transcribing.
4. It sends the usable ones to S4's `POST /sections/draft`. An observation is
   usable when it has a note or a finished transcript; a transcript the
   engineer corrected is sent as corrected, and a removed recording is left
   out, including from the wait in step 3 (CP-08). Only those filed under
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
4. `generator.draft_ofis` writes the OFIs (prompt `gn05-v4`, guide
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
a day, or $44 a month.

**Testing doesn't spend money.** Unit tests mock every paid call. Two guards make a
missed mock fail instead of spending:
- rag-service: `tests/conftest.py` blocks any outside network connection.
- server: `vitest.config.mts` points the services' URLs at a closed port.

Scoring the chat for real (`eval.chat_eval`) does spend: a full re-score (answers for
all 61 cases plus two judge runs) costs about $2.

## Password reset email (F-06)

`requestPasswordReset` in `server/src/services/auth.service.ts` emails a link `APP_URL/?reset=<code>`. The sign-in screen reads `?reset=`, opens the new-password step with the code filled in, and removes it from the address bar.

- **Real email:** set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in `.env`. For Gmail, `SMTP_PASS` is an app password (Google account → Security → App passwords; needs 2-step verification).
- **No `SMTP_HOST`:** nothing is sent. The code is printed in the server console (CI and fresh checkouts).
- **Mail failure:** logged, and the API answers exactly as on success, so a mail outage never reveals which addresses are registered.
- The code is single-use and expires after 30 minutes.

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

## Usage and costs report (EV-04)

`GET /api/usage/summary?reportId=` and `GET /api/usage/export.csv?reportId=&groupBy=feature|service` (`server/src/routes/usage.routes.ts`, `usage-report.service.ts`), shown on the **Usage and costs** screen (`/usage-costs`, `client/src/features/usage/`). Both read the `ai_calls` collection written by EV-03 and need `usage:view`.

The screen (loaded on first open, as it brings the chart library) opens on the report-generation overview for the last 30 days: a Period, Group by (knowledge admins) and Split each bar by row, totals and the estimate notice, a stacked bar per assessment or engineer, and a table of every group below it, searchable by reference, client or site and filterable by engineer. Choosing an engineer's bar or row narrows the overview to their assessments; choosing an assessment opens its drill-in (feature × service chart, cost per report section, and the cost, usage and speed tables), which has its own CSV. A risk engineer sees the same overview, limited by the gateway to their own assessments and chat, without the engineer controls.

A knowledge admin also has an **Ingestion** tab (from `GET /api/usage/ingestion`): the same Period and Split row, totals and estimate notice, a stacked bar per knowledge document (titles shortened on the axis, whole in the tooltip and table), and a table of every document with its status, upload date, pages, calls, time per call, total and cost per page, searchable by title or file name, with its own CSV. Documents have no drill-in; an upload refused after labelling shows as `Not saved`.

- **Who sees what:** a knowledge admin sees every report. A risk engineer sees only reports where they are the assigned engineer; asking for another report returns 403. Document ingestion is for knowledge admins only (403 otherwise).
- **Summary:** cost totals and call counts; breakdown by feature (always every feature, chatbot included) and by billed service; latency per feature (average, median, 95th percentile, slowest); tokens, Cohere search units and Whisper audio seconds per feature; the pricing bases used, with calls whose price is an estimate flagged. Calls are counted over `callCount`, so a summed ingestion row counts as all its calls. Its time is the total of those calls, so averages are per call and the percentiles use single-call rows only.
- **Cost:** US dollars, summed over calls that have a cost. A call with no cost is counted in `callsWithoutCost` and never added as 0.
- **One assessment (drill-in):** with `reportId`, the summary also has `byFeatureService`, each feature's cost split by the service that billed it (features with calls only, costliest first), and `bySection`, what drafting each report section cost: its Claude calls and their Cohere searches, the number of drafts (Claude calls), calls without a cost, and its title from Marsh's template (`2` Executive Summary, `3` Opportunities for Improvement, `7`–`12`). Sections are in report order; drafting saved before sections were recorded is `Unspecified`, last. Without `reportId`, `bySection` is empty.
- **Ingestion:** `GET /api/usage/ingestion?split=service|feature&range=7d|30d|month|all` (knowledge admins: `usage:view` and `knowledge:manage`) gives what labelling, OCR and embedding cost per knowledge document: title, file name, status, upload date, pages (`ingestion_jobs.pageTotal`, so none until parsing has counted them), calls, total, cost per page, average time per call, last activity and `segments` per billed service or stage. A re-ingested document's runs add up. Labelling for an upload refused after it ran shows as `Upload not saved`; labelling from before calls named their document is one `Not linked to a document` row (key `unlinked`). No uploader is shown: documents are shared, and uploads do not record who made them. `GET /api/usage/ingestion/export.csv` exports it: one row per document, a column per split key, named `usage-ingestion-<split>-<range>.csv`.
- **Export:** CSV of the breakdown on screen (one row per feature or per billed service). The overview's is `GET /api/usage/overview/export.csv` with the overview's own query: one row per group (label, reference, client, site, engineer, last activity, calls, calls without a cost, total), then one column per split key, named `usage-by-<groupBy>-<split>-<range>.csv`.
- **Overview:** `GET /api/usage/overview?groupBy=assessment|engineer&split=service|feature&range=7d|30d|month|all[&engineer=<userId>]` gives report-generation cost across assessments or engineers, for the stacked bar chart and the table under it. Each group has its total, calls (summed over `callCount`), calls without a cost, `lastActivityAt` (for sorting by time) and `segments`: cost per billed service or feature. `splitKeys` lists every split key present, costliest first. Document ingestion (`label-document`, `ocr`, `embed-document`) is left out; it has its own view.
  - **Whose a call is:** a report call belongs to the assessment's *assigned* engineer, looked up when the report is read, so reassigning an assessment moves its cost. A chat call belongs to the user who asked (`userId`). Grouped by assessment, chat is one `Chatbot` group (key `chat`); grouped by engineer, it is part of the asker's bar. An assessment with no engineer is grouped as `Unassigned`.
  - **Period:** `7d` and `30d` count back from now; `month` starts at 00:00 on the 1st in Singapore (UTC+8, no daylight saving); `all` has no limit.
  - **`engineer`:** only the calls attributed to that engineer, for when their bar is chosen.
  - **Scope:** as for the summary: a risk engineer sees only their assigned assessments and their own chat.
- **Demo data:** `npm --prefix server run seed:usage` (after `seed`) writes fake rows tagged "DEMO data" for the sample assessments and the sample engineers' chat, and replaces them on every run. It writes no ingestion rows. How to discard them is in [RUNNING](../RUNNING.md) §5.


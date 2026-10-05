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

## Knowledge document ingestion (IN-01)

1. The admin picks PDFs on the Knowledge base screen and enters each file's
   details. The client sends one `POST /api/knowledge-documents` per file, so a
   rejected file never blocks the others.
2. The gateway rejects anything that is not a PDF (Content-Type and `%PDF-`
   header, 415), then asks the ingestion service's `POST /inspect` to open it
   with PyMuPDF (422 with the reason if it is corrupt, password-protected or has
   no pages). Nothing is stored for a rejected file.
3. The gateway stores the original in S3 at `knowledge/<id>.pdf`, records it in
   `knowledge_documents` as `queued` and adds a BullMQ job (`jobId` = document
   id) to the `ingestion` queue in Redis. If the queue is down, it removes the
   record and the file and answers 503.
4. `ingestion-worker` (same image as the ingestion service, `python -m
   app.worker`, concurrency 1) claims the document, downloads the original,
   runs `app.pipeline.run(path, doc_id=<id>, labels=..., reporter=<ProgressReporter>)`
   so chunk ids are `<id>:<n>` and every passage carries the document's five
   labels (KB-01). The `ProgressReporter` writes each stage transition to the
   `ingestion_jobs` collection in MongoDB (E2), and the gateway merges this into
   the `KnowledgeDocument` DTO as `progress` while the document is `processing`.
   The worker records `complete` with counts or `failed` with the reason on
   `knowledge_documents` as before. A job whose worker died mid-run is
   redelivered by BullMQ and processed again.
5. The client re-reads `GET /api/knowledge-documents` every 3 seconds while any
   document is queued or processing, showing each processing document's stage,
   elapsed time and, while chunking, the page reached out of the document's page
   total from `progress` (E2). Pages are shown rather than a chunk count because
   the chunk total is not knowable up front.

See the Redis/BullMQ decision in [DECISIONS](../DECISIONS.md).

## Correcting a knowledge document (KB-01)

1. The Documents tab lists `GET /api/knowledge-documents/ingested` and filters
   by country and facility type in the browser.
2. Edit details sends the full details to `PUT /api/knowledge-documents/:id`.
   The gateway validates them as at upload, refuses a document that is not
   active (409), keeps a copy of the old details and saves the new ones.
3. The gateway calls the ingestion service's `PUT /documents/{id}/labels` (via
   `INGESTION_SERVICE_URL`) with the five labels. It finds the passages by
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
   `status` (`withdrawn` or `active`). No re-parsing or re-embedding.
3. If that call fails, the gateway puts `withdrawn` back and answers 503, so
   the document keeps its old state.
4. Retrieval skips withdrawn passages: the RAG service's `retrieve()` always
   excludes `status: withdrawn`, so `/retrieve` and `/generate` both skip them.
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
   (uncategorised ones stay out, CP-02 AC4) and refuses (409) while any of
   their recordings is still transcribing.
4. It sends the usable ones to S4's `POST /sections/draft`. An observation is
   usable when it has a note or a finished transcript. Only those filed under
   the section's own categories count towards the minimum; with too few, it
   refuses with 422 and gives the count.
   - S4 puts the section's own observations in `<observations>` as the main
     evidence and the rest in `<other_observations>` as backup, used only
     where they concern the section.
   - Only the section's own observations steer the standards search.
5. S4's orchestrator (`orchestrator.draft`) retrieves passages in one batched
   Cohere call:
   - for each of the section's own observations, searched by its own words,
     up to 4 standard passages (`fm_standard` or `nfpa_standard`) within cosine
     distance 0.60, filtered to the site's jurisdiction and facility type; at
     most 12 per section, each observation's nearest first;
   - once per section, past-report passages (`marsh_report`), filtered by
     country only, keeping up to 4 whose `headings` trail contains the section
     title.
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
   standard passages (with pages and headings), the guardrail result and the
   provenance. A refusal or a
   cut-off answer is a 502 with `detail`.
10. The gateway saves the draft in `report_sections` (see
    [database](database.md#report-sections-gn-01)). Any S4 failure reaches
    the client as a 503 with the reason.

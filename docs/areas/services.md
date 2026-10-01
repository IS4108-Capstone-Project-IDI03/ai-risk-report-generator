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
   runs `app.pipeline.run(path, doc_id=<id>, labels=...)` so chunk ids are
   `<id>:<n>` and every passage carries the document's five labels (KB-01), and
   records `complete` with counts or `failed` with the reason. A job whose
   worker died mid-run is redelivered by BullMQ and processed again.
5. The client re-reads `GET /api/knowledge-documents` every 3 seconds while any
   document is queued or processing.

See the Redis/BullMQ decision in [DECISIONS](../DECISIONS.md).

## Correcting a knowledge document (KB-01)

1. The Documents tab lists `GET /api/knowledge-documents/active` and filters
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

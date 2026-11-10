# PII protection before external AI calls (epic E11)

Client details are swapped for typed placeholders (`[CLIENT_1]`, `[PERSON_2]`) before text goes to Anthropic, OpenAI, Gemini or Cohere. The real values are restored afterwards. The local `privacy-service` does the masking (PV-01); each caller masks its own requests.

## Protected flows

`PII_PROTECTION=required` covers **only the flows below**. Never read it as "everything is protected".

| Flow | Protected | Since | Notes |
|---|---|---|---|
| Section drafting, incl. redraft and Regenerate | Yes | PV-02 | Cohere search and rerank queries, past-report passages and the prompt are masked. |
| OFI drafting (Section 3) | Yes | PV-02 | As for sections; accepted OFI titles are masked too. |
| Executive Summary (Section 2) | Yes | PV-02 | The saved section text is masked. |
| Knowledge-base chat | Yes | PV-03 | The conversation, context (the engineer's remembered facts, CB-05, travel as context), document names, passages, Cohere queries and rerank documents are masked; the answer streams back with real names. |
| Site walk proposal (CP-22) | Yes | CP-22 | The transcript, existing location names and photo descriptions are masked before the walk-reading model and Jev. The audio is not (speech-to-text, below); the photos are described with faces blurred (PV-08, below). |
| Photo on a chat question (CB-08, Gemini) | Faces: always checked, the engineer chooses | CB-08 | privacy-service finds faces when the photo is attached; the engineer blurs them (the default) or sends the photo as is. If the check cannot run, the photo is not kept or sent. Only the photo goes to the vision model; its description joins the question's context and is masked with the rest of the question (PV-03). Text printed on a photo cannot be masked. |
| Client intake: reading a client's documents (CP-23) | Yes | CP-23 | Every document's name and text is masked before the reading model and Jev, including a client or site not yet recorded. See "Client intake" below. The files themselves are stored in S3 and never sent. |
| Pre-survey checklist (CP-30) | Not needed | CP-30 | Only the facility type, country and standard ids are sent; S4's request has no field for client text. |
| Report export (EX-01) | Not needed | EX-01 | No AI call. The gateway refuses a file whose text still holds a placeholder (`[PERSON_2]`, `client_1`, `[PHONE 3]`), naming where it is (422). |
| Proposed figures for Sections 4 and 5 (GN-03) | **No** | (PV-02 follow-up) | `POST /figures/propose` sends observations and sections to the model unmasked. |
| Observation reading: photos, and since CP-21 any observation's text (Gemini) | Yes | PV-04 | Faces in photos are blurred; the note, transcripts and location are masked. Item labels ("Note", a photo's file name) are not. |
| Handwritten note transcription (CP-19, Gemini) | **No, by decision** | PV-04 | The page image must be read by the model, so it can't be masked. See Known gaps. |
| Ingestion of past reports: labelling, table, formula and picture OCR, embedding, Chroma | Yes | PV-05, PV-06 | Labelling reads masked page text; a past report's PDF is redacted before parsing, scanned pages included (PV-06). Faces in picture and table crops are blurred before the OCR model reads them, and passage text is masked once more before embedding. Text inside a picture still reaches the OCR model (Known gaps). Reports ingested before PV-05 stay unredacted until every document is re-run. Standards are public and not redacted. See "Ingestion of past reports" below. |
| Speech-to-text (Whisper) | **No, by decision** | | The audio can't be masked. Every transcript is masked before drafting, chat and site-walk reading. See Known gaps. |
| Site walk photo description (CP-22, Gemini) | Yes | PV-08 | Faces are blurred before the model, and the description is checked like observation reading's answer before it is saved. Text printed on a photo still reaches the model. See "Site walk proposal" below. |

## How a protected request works

The gateway decides whether protection is on. It sends `privacy: {enabled, known_entities}` with each request (`server/src/services/privacy.service.ts: privacyFor`). The Python services never read `PII_PROTECTION`, and without a `privacy` field they behave as before.

`known_entities` lists the assessment's client, site (name and code), address and every active user. A client or site that was renamed, or a site whose address was corrected (CP-28), also lists the names and addresses it had before, after the current one: notes written with an old name are still masked, and the placeholder restores to the first name, so they read back with the current one. Names match in any case and spacing, so a change of case alone keeps no former name.

In rag-service (`app/privacy.py`, `orchestrator.py`), drafting does the following:
1. **One `/mask` call** covers the request's own text: the observations' notes, transcripts, locations and standards, plus the facts, a redraft's saved text and instruction, accepted OFI titles, or the summary's sections.
2. **Search and rerank** run on the masked text.
3. **Past-report passages** (text and headings) are masked in a second call that passes the first call's mapping back. This happens **before rerank**, because Cohere reads them too. Standards are public and are not masked. The reviewer's `sources` show the stored passage.
4. The model drafts from masked text only. Its prompts say to copy placeholders exactly (prompt versions gn01-v2.11, gn05-v6, gn07-v3).
5. **Unmask** happens before any check that compares text: the citation, maturity and number checks run on the restored statements, against the original observations and facts.
6. A section or summary statement holding a placeholder that can't be restored is marked **unsupported**. An OFI has no such flag, so the placeholder stays visible for the engineer to edit, and a warning is logged without the text.
7. Provenance records `privacy: {enabled, masked_count}`, never the values or the mapping (`report_sections`, `report_ofis`).

**Fail closed.** If privacy-service is down, times out (`PRIVACY_TIMEOUT`, 10 s) or errors, the draft fails with a readable reason (rag 502, gateway 503). Nothing is sent to Cohere or the model.

### Chat (PV-03)

Chat has no assessment, so the gateway sends every client (and any client name typed on an assessment before CP-17), every site and its address, removed sites included, with their former names (CP-28), and every active user (`chatPrivacy`). It reads them at most once a minute, so a client added, or a name corrected, in the last minute is not yet masked by its new name. It always sets `privacy` itself, replacing any the browser sent.

In rag-service (`app/chat/answer.py`):
1. **One `/mask` call** covers the conversation (earlier answers hold real names), the engineer's context and the document names (a past report's title can name its client). The planner and the answer model see the same placeholder for a name.
2. **The planner's output** is unmasked where the engineer sees it: its own reply, the search shown on screen, and the filters in the result. A document it names by placeholder is restored before matching. The queries sent to Cohere **stay masked**.
3. **Rerank** reads every candidate masked, through `retrieve(rank_texts=...)`: stored past reports can name people. The passages returned keep their stored text.
4. **The passage block** sent to the answer model is masked in a second call with the same mapping. Unlike drafting, chat masks standards' passages too.
5. **The answer streams back with real names** (`Session.unmask_stream`). A placeholder split across chunks is held back until it is complete, at most 24 characters, and restored JSON-escaped, since it lands inside `Statement("...")`. The quote check, the screen and the saved answer all read real text, checked against the original passages.
6. `chat_result.privacy` records `{enabled, masked_count}`. Both chat prompts say to copy placeholders exactly (`cb01-v17`).

If privacy-service fails, chat answers "Sorry, the chat couldn't answer: Client details couldn't be protected because the privacy service…" and calls no model or search.

### Site walk proposal (CP-22)

The gateway's `site-walk-proposal` worker sends the walk to rag-service's `POST /site-walks/propose` with `privacy` from `privacyFor`, like drafting.

Before that, each photo is described by S5's `POST /describe-photo` with `privacy` from `readingPrivacyFor`, as for observation reading (PV-08):
1. **One `/redact-image` call** blurs the photo's faces; only the blurred copy goes to the vision model. The S3 original is unchanged and the blurred copy is not kept.
2. **With `PII_CHECK_ANSWERS`**, one `/mask` call checks the description: a name or number the model read off the photo becomes its kind ("[phone number removed]"), a known client, site or person stays. Nothing goes in masked, since only the photo is sent.
3. If either call fails, S5 answers 502 and nothing is described. The walk treats it like any description failure: retried, then on the last try the photo is matched by its time alone. The raw photo is never sent as a fallback.
4. S5 returns `privacy` provenance (counts only); the gateway doesn't store it, since a walk photo has no provenance field.

In rag-service (`app/site_walk/propose.py`):
1. **One `/mask` call** covers every transcript segment (or the typed walk), each existing location's building, level and name, and each photo's description.
2. The walk-reading model (`complete`) and every Jev question read only masked text. Places are matched in masked text too; one mapping covers the request, so the same name has the same placeholder everywhere.
3. **Unmask before returning:** each note and each new location's building, level and name. A location matched to an existing one is returned with the gateway's own values.

If privacy-service fails, the step fails with rag 502 and nothing is sent to the model or Jev. The worker retries, then marks the walk `failed` with the reason.

### Observation reading (PV-04)

The gateway sends `privacyFor(reference)` with every reading (`runInterpretation`), as drafting does. In S5 (`app/privacy.py`, `app/processors/vision.py`):
1. **Faces are blurred.** After each photo is turned upright and shrunk, all of a reading's photos go to privacy-service's `POST /redact-image` in one call. YuNet (OpenCV's face detector, kept in `privacy-service/app/models/`) finds the faces on a copy at most 960 px long, and each face, padded by 40%, is pixelated to 3×3 blocks and blurred. At 5 or more blocks the detector still found the face it had blurred. A photo with no face comes back unchanged. About 100 ms per 1600 px photo.
2. **One `/mask` call** covers the note, every recording and page transcript, and the location.
3. Gemini reads only the blurred photos and the masked text. The prompt says to copy placeholders exactly (`cp21-v4`, also with protection off).
4. **Unmask** happens before the gateway's checks: the description, each category's reason and each quote come back with real values, so the quote check compares real text. A placeholder Gemini garbled stays visible: in a quote it fails the quote check, and in a description the engineer sees and edits it.
5. **The S3 original is never changed.** S5 returns each photo as Gemini received it (`redacted_photos`). The gateway keeps a photo with a face blurred as a separate object, `<photo key>.redacted.jpg`, and the photo popup in Observations can switch to it ("As sent to AI · 2 faces blurred"). A photo with no face is recorded as checked ("no faces found"), and no copy is kept. If keeping a copy fails, the reading still succeeds.
6. **The answer is checked** (`PII_CHECK_ANSWERS`, on by default). Masking can't reach text inside a photo, so Gemini may write a name or phone number it read off a sign or notice into its answer. Before unmasking, S5 sends the description and each category's reason to `/mask` once more, with the reading's mapping. Everything the reading sent is a placeholder by then, so whatever `/mask` finds is new. Each new detail is replaced by its kind: "[name removed]", "[phone number removed]", "[ID number removed]", "[postal code removed]", "[address removed]", "[vehicle plate removed]". A known client, site or person is kept, as it would have been in the input. Quotes are not checked: they are copied from the items, which were masked going in. privacy-service is local, so this call sends nothing out. It is a second `/mask` call per reading, an exception to Rule 2: it checks the answer and adds nothing to the mapping. The kinds looked for are the ones `detectors.json` has on.
7. Provenance records `privacy: {enabled, maskedCount, facesBlurred, removedFromAnswer}` on each part of the reading, never the values.

If privacy-service fails, the reading fails with "Client details couldn't be protected because the privacy service…", and nothing goes to Gemini. If it fails at the answer check, Gemini has already answered: the reading fails with "The AI's answer couldn't be checked for personal details because the privacy service…, so it wasn't saved."

**Placeholder-shaped input.** Text that already contains something like `[PERSON_1]` (typed by an engineer, or from a past report) is swapped for `[LITERAL_n]` before masking, and restored after unmasking. Without that swap, unmasking would put a real name where the input never had one. A bracketed escape such as `[ PERSON_1 ]` does not work, because the unmask pattern accepts placeholders without brackets.

### Client intake (CP-23)

Starting an assessment from a client's documents has to protect a client nobody has recorded yet, so the known names alone are not enough. The gateway's `readIntake` sends rag-service's `POST /client-intakes/read` `privacy` from `chatPrivacy` (every recorded client, site and address, removed ones and former names too, and every active user), plus `detect: ["CLIENT", "SITE"]`. rag-service passes `detect` on to `/mask`; without it, `/mask` behaves exactly as before, so no other flow changes.

In rag-service (`app/client_intake/read.py`):
1. **One `/mask` call** covers every document's name and text. The intake has its own timeout, `CLIENT_INTAKE_PRIVACY_TIMEOUT` (60 s, against `PRIVACY_TIMEOUT`'s 10 s), because a pack of documents takes longer than a draft's notes: about 15 s for 10 documents and 40,000 characters.
2. The reading model and every Jev question see only masked text. Matching the client and sites to recorded ones is done after unmasking, in code, so no recorded name is sent anywhere to be compared.
3. Each value's source quote is checked against the masked document (as the checklist checks citations). Then real names go back into every value and quote before anything leaves rag-service.

**What `detect` adds** in privacy-service (`app/masker.py`, `allow_list.json`):
- `CLIENT` masks spaCy's organisations as `[CLIENT_n]`, and `SITE` masks its facilities (buildings, plants, warehouses) as `[SITE_n]`. Known names still win where spans overlap.
- **A never-mask list** (`never_masked` in `allow_list.json`, see below) keeps Marsh, Marsh McLennan and its businesses, FM Global, NFPA, SCDF (and Singapore Civil Defence Force), UL, VdS, LPCB, Munich Re and Swiss Re readable, whatever the model says. They are never a client, and the reading needs them. Matching is on the whole name, in any case.
- **Span tidying** (`_unlisted_parts`): spaCy's spans are loose. They run over line breaks into a form label ("Crest Tower Central\nAddress"), start with "the", or join names ("Marsh and FM Global"). Each detected span is cut per line, split at "and", a comma or "&" when one part is on the never-mask list, trimmed of spaces and a leading "the", and dropped when it is a label (ends in a colon) or only a company form ("Pte Ltd"). Without this, a placeholder would restore to the loose text, and Marsh would be masked with a client it was written next to.
- Countries and cities are never masked, so the jurisdiction can still be read.

**Fail closed (AC19).** If privacy-service is down, errors or passes the 60 s timeout, rag-service answers 503 and the gateway answers the engineer 503 with the reason ("Client details couldn't be protected…"). Nothing is sent to the model or Jev, and raw text is never the fallback. When protection is off (`privacy.enabled` false), documents are read unmasked, as every other flow.

### Ingestion of past reports (PV-05)

A past report names its client, the client's staff and their phone numbers. Its text leaves the system three ways at ingestion: labelling (OpenAI or Anthropic, and Jev), the table and formula crops read by the OCR model, and the passages embedded by Cohere and stored in Chroma Cloud. The gateway decides whether to protect a document, as for every flow, with `chatPrivacy`'s names: every client, site, address and active user, since a past report has no assessment. It sends no `detect`: on a sample report, detecting unlisted organisations and buildings tagged 171 section headings and building terms ("Opportunities for Improvement", "Reinforced Concrete", "Cooling Towers"), which would have left passages without their technical words.

1. **Labelling** (at upload, `POST /label`). The gateway sends the PDF and `privacy` as a multipart form. Ingestion masks the first `LABEL_PAGES` pages in one `/mask` call before either model reads them, checks the answers against the masked text, and unmasks the details and their quoted evidence. If privacy-service is down, or the gateway can't read the names, no model is called and every detail is left Unconfirmed, as in a model outage: the upload still succeeds.
2. **Redaction before parsing** (the worker, stage "Anonymising"). The worker asks the gateway how to protect the document (`GET /api/internal/knowledge-documents/:id/privacy`, behind the service key). With protection on, and a document that is not a standard, `app/pipeline/redactor.py` sends the whole PDF's text in one `/mask` call, then rewrites each page that holds a detail: all its text is removed and drawn again, in its order and place, with each detail replaced by its tag (`Mr [PERSON_1]'s`). Docling orders a paragraph's text as it is drawn, so drawing only the tags would put them at the paragraph's end. The page is drawn in Liberation Sans, the font LibreOffice converts Word reports in (bundled in `app/pipeline/fonts/`, SIL OFL 1.1; bold and italic kept), or a CJK font for characters it lacks, each run squeezed to its old width. Redrawn in Helvetica, Docling's layout model read a cover page's lines as pictures and dropped their text, and a line with a curly quote or a dash went to the CJK font, which is drawn letter-spaced: on a 19-page sample, Docling read 11% less text than from the original, against 0.2% in Liberation Sans; pictures and drawings are not touched. Parsing, chunking, the OCR crops (rendered from the PDF) and embedding then read the redacted copy, a temporary file. The S3 original is unchanged, and the viewer shows it.
3. **The mapping** (`knowledge_documents.privacyMapping`, tag to the detail it replaced) is saved by the worker before relabelling makes the passages searchable, and removed if the run fails or is cancelled. It is personal data kept in our own MongoDB. The gateway never loads it (`select: false`) and no API returns it. The ingestion job records only `privacy: {enabled, masked_count}`.
4. **Reading the passages back** (rag-service, `app/past_reports.py`). Every search puts a past report's real words back from its mapping (one MongoDB read per search), before rerank and masking. The values put back are added to the request's known names (`Session.know`), so drafting and chat tag them again in their own numbering, even another client's name that the assessment doesn't list. A stored `[PERSON_1]` is never read as the request's own. The citation panel shows the real words too. If the mappings can't be read, the request fails closed.

**Fail closed.** If the gateway or privacy-service can't be reached at ingestion, the document fails with "Client details could not be protected because the privacy service or the gateway did not answer, so nothing was sent or indexed. Retry it later." Nothing is parsed or indexed.

**Measured** on the three sample reports (43 to 60 pages) on a laptop with other apps using about half its CPU: redaction took 0.75 to 1.2 s a page, about half of it privacy-service's name model. The acceptance criterion is under 1 s a page; measure again on EC2, where nothing else competes.

### Scanned pages, pictures and the safety net (PV-06)

- **Scanned pages.** A page with no text layer but an image is read by the redactor with RapidOCR (`return_word_box`), the engine Docling reads it with too, at 200 dpi. Its words join the document's one `/mask` call, so typed and scanned pages share one numbering. Each detail's words are blanked in the page image itself (`PDF_REDACT_IMAGE_PIXELS`), the box padded by 15% of the word's height (OCR boxes sit tight on the letters, and left slivers) but never into a word that stays (in small text set tight, the padding blanked part of the line above), and the tag is drawn in their place in Liberation Sans, so Docling's OCR reads `[PERSON_1]`. A scanned page without a detail is not changed.
- **Picture and table crops.** `parse_picture` and `parse_table` send each crop to privacy-service's `/redact-image` (YuNet, PV-04) before the OCR model reads it: on a scanned page, a region Docling calls a table can take in a photo beside it. A table read as pictures goes through `parse_picture` too. Formula crops are not blurred: they are small and hold an equation. privacy-service answers a crop with a face as JPEG; ingestion turns it back into PNG, which the OCR providers send.
- **Safety net.** After chunking, a redacted report's passage text goes through `/mask` once more (`anonymise`, `Session.mask_tagged`), for details only the OCR model saw: a phone number on a sign in a picture. The text is not escaped, since its tags are the document's own; new tags continue its mapping and are saved in `privacyMapping` with the rest, so rag-service puts them back.
- **Fail closed.** If privacy-service fails at a crop or at the safety net, the document fails, as at redaction.

**Checked on a real scan** (7 Nov 2026): an 11-page report of scanned pages with a photo of two people and printed contact details. No mapped value reached a passage; the contact details were tags; all 7 crops sent to Anthropic (6 table, 1 picture) went through `/redact-image` first. Its mapping also held false positives from the garbled OCR of poor scans ("max" in a diagram note, word fragments), harmless but noise.

**Measured** on a laptop (7 Nov 2026), RapidOCR took 5 to 8 s on a dense scanned page (18 lines), whatever the resolution; word boxes cost nothing extra. The epic expected 1 to 2 s. Docling then reads the same page again, so a scanned page now takes about twice as long. Measure on EC2.

## What is detected

The table below summarises PV-01; the epic, section C, has the details.

| Detects | How |
|---|---|
| Client, site, address and staff names | Whole-word match against `known_entities`. |
| Other person names | spaCy `en_core_web_lg`, PERSON only. |
| Phone numbers, emails, NRIC/FIN | Presidio recognisers, plus a context label check for phone numbers and IDs. |
| UEN; a postal code after "Singapore" | Hand-written patterns. |
| Unrecorded client and site names (client intake only, `detect`) | spaCy organisations as `CLIENT` and facilities as `SITE`, minus the never-mask list, with tidied spans. |
| Street addresses (PV-04) | A pattern: a house or block number, a capitalised street name and a street word ("21 Lower Kent Ridge Rd", "Ang Mo Kio Avenue 3"), or a Jalan or Lorong, then any unit number ("#04-56"). A road without a house number ("next to Kent Ridge Road") is kept. |
| Vehicle plates (PV-04) | A pattern ("PU 104 J"), kept only when the last letter is the plate's check letter, so a model or part code of the same shape stays. |

Kept as they are: jurisdiction, facility type, COPE category, severity, standard references, brands, floor and room names, building names ("University Hall"), figures and dates. In a client intake, Marsh, the insurer and standards bodies on the never-mask list, countries and cities are kept too, and building names are masked (`detect: ["SITE"]`).

### Switching detection on or off

`microservices/privacy-service/detectors.json` switches each kind on or off: `PERSON`, `PHONE`, `EMAIL`, `NRIC`, `UEN`, `POSTAL`, `ADDRESS`, `VEHICLE`. All are on as shipped.
- `PII_PROTECTION` is the master switch. With it off, the gateway never calls privacy-service, so nothing is masked, blurred or checked, whatever the file says.
- With it on, only the kinds the file has on are looked for, in the text going out and, with `PII_CHECK_ANSWERS=on`, in photo reading's answer.
- Names the caller lists (the assessment's client, site, address and people) are always masked. The file can't turn them off. Faces are not in the file.
- The file is read when privacy-service starts. After editing it, run `docker compose restart privacy-service` (Compose mounts the file, so no rebuild). The startup log names the kinds switched off. A kind left out of the file is on; an unknown kind or a value other than `true`/`false` stops the service. A missing file means everything is on. `PRIVACY_DETECTORS_FILE` points at another file.
- **The file applies to every flow**, not only photo reading: drafting, chat and photo reading all use the same service. Turning `PERSON` off sends names nobody listed to Anthropic in drafts.
- Switching `ADDRESS` off can bring back spaCy taking some street names for a person ("Lower Kent Ridge Rd" as `[PERSON_1]`), as before addresses were detected.

### Words and names never masked (allow_list.json)

`microservices/privacy-service/allow_list.json` lists what privacy-service deliberately leaves as written. Each list groups its entries under a heading that says why they are there:
- `never_a_person`: words the name model takes for people ("Hosereel", "Equivalencies", the abbreviation "spk"). A name the model guessed is kept when every one of its words is listed here, in any case.
- `never_a_person_patterns`: regular expressions for such words, each matched against one whole lower-case word. Shipped: floor and basement codes (`[lb][0-9]{1,3}[a-z]?`: L23, B2, L10A).
- `never_masked`: whole names that are never a client detail, whatever found them: Marsh and its businesses (Guy Carpenter, Mercer, Oliver Wyman), insurers and standards bodies.

Known names and the patterns for phone numbers, IDs and addresses are never checked against the file.

**Why it matters more since PV-05.** A false positive in a past report becomes part of its mapping, and rag-service adds every mapped value to a request's known names. "L31" read as a person in one report would then be masked in an assessment's own notes too. Add a word here when a report, a draft or the eval shows the model masking it wrongly.

**Changing it.** Edit the file and run `docker compose restart privacy-service` (Compose mounts it, as for `detectors.json`; no rebuild). It is read when the service starts: an unknown list, an entry that is not a list of words, or a pattern that does not compile stops the service with the reason. Without the file nothing is allowed, which masks more. `PRIVACY_ALLOW_LIST_FILE` points at another file. A changed list only affects text masked from then on: passages already stored keep the tags they were given at ingestion.

## Known gaps

- **Other clients in past reports** (PV-05). A past report is redacted against every recorded client, site, address and user, plus the patterns and the name model. A client that was never recorded, or a street address in an unusual format, can still be stored readable: organisation detection (`detect`) is off for ingestion.
- **Past reports ingested before PV-05** were indexed unredacted and have no mapping. They read as before and are masked only by detection, until every document is re-run (planned). Retry only re-runs a failed or cancelled document.
- **Text inside a picture in a past report (PV-06).** Faces are blurred, but a name or number printed in a photo or diagram reaches the OCR model as is. What the model writes about it is masked before embedding (the safety net), so it is not stored, unless privacy-service doesn't recognise it.
- **Scanned pages are slow (PV-06).** Each is read by RapidOCR twice, once to redact it and once by Docling: 5 to 8 s for the redactor alone on a dense page on a laptop. A page that is only a picture (a full-page photo) is read too. A scanned word RapidOCR misreads is not matched, so a badly scanned name can stay readable.
- **A redacted page is redrawn in Liberation Sans.** Its words, order and places are kept, and pictures and drawings are untouched. A report converted by LibreOffice looks unchanged; a PDF made in other fonts (Calibri, Times) shows Liberation Sans on a redacted page, in Docling's page images and the OCR crops. Pages without a detail are not changed.
- **The duplicate and edition comparison (IN-07) shows tags** for a redacted report: ingestion-service reads Chroma directly, without the mapping.
- **Client intake: some names are still readable after masking (CP-23).** Recorded names are always masked (they are known entities). Names nobody recorded depend on spaCy and on patterns for building names ("<Name> Tower", "<Name> Hub", "Phase 2") and street addresses ("12 Kallang Road", "Jalan Seri Utama 2"), so an unusual name can slip through. Measured on the CP-23 eval's 24 synthetic packs (3 Nov 2026), after masking: 1 of 22 client names (a Thai "Co., Ltd" name), 0 of 31 new site names, 2 of 48 contact names (Malay and Thai names spaCy doesn't read as people) and 0 of 31 addresses were still readable in the text sent to the AI. The patterns over-mask a little (a heading or "Visit Lindenmoor Tower" masked as one name); each placeholder still restores to its text. The packs use invented names in the sample reports' shapes, so real documents may differ.
- **Figure proposals** are not protected yet (see the table above).
- **Speech-to-text goes out as recorded, by decision.** Voice notes and site-walk audio go to OpenAI Whisper unmasked; audio can't be masked. Like handwritten pages, the transcript is masked whenever it feeds drafting, chat or a site-walk reading, so no raw speech reaches those models. A local Whisper (faster-whisper) would close the gap, at about 5 to 20 times the API's time on a CPU-only instance.
- **Site-walk photos: faces only (PV-08).** As in observation reading, text printed in a photo (a badge, a notice) reaches the vision model; the answer check keeps it out of the saved description when `PII_CHECK_ANSWERS` is on. Descriptions saved before PV-08 are not re-checked.
- **Handwritten pages (CP-19) go to the AI as photographed.** The model must read the page, so its text can't be masked first. This is accepted for now: the risk is mostly in the *combination* of details (a name with an NRIC and a phone number), and the main goal is not to store PII in the database. Scan mode asks the engineer to leave names, phone numbers and ID numbers off the page. The transcript is masked later, like any text, whenever it feeds drafting or chat. A local handwriting model would close the gap.
- **Photo reading: faces only.** Text in a photo (a name badge, a tag with a phone number) is not redacted, so Gemini reads it. The answer check keeps it out of what is saved, except a building name on its own ("University Hall"). Tesseract redaction was left out (1–3 s per photo). Faces turned well away from the camera, or under about 17 px in the photo, may not be detected.
- **Photo labels are not masked.** A photo's label is its file name, which the proposal cites. A file named after a person would reach Gemini.
- **Chat's known names are read once a minute.** A client or user added in the last minute, or a client's or site's new name, is not masked by name in chat (spaCy may still catch a person's name).
- **Former names are masked for good** (CP-28). A generic old name, e.g. a site once called "Main building", is masked wherever it appears in its assessment's text, and in chat for everyone.
- **Windows, outside Docker:** `localhost` costs about 2 s per `/mask` call (IPv6 is tried first). Set `PRIVACY_SERVICE_URL=http://127.0.0.1:8004`. Docker uses the service name and is unaffected.
- From PV-01: a surname written before the full name gets two placeholders, and `[PERSON 1]` (with a space) is not restored.

## Testing

- ingestion-service `tests/test_leak.py` (PV-05): a generated report with a client, a person, a phone number and an NRIC goes through redaction, chunking and indexing with Cohere and Chroma recorded, and through labelling with the models recorded; none of the seeded details is sent. Run without protection, the same test sees every one, so the recorders are known to work. Its `-m e2e` variant runs real Docling and checks that the tags read where the details were. PV-06 adds an `-m e2e` case with a scanned page and a photo: no seeded detail, and no number the OCR model "read" off the photo, reaches Cohere or Chroma, and every crop the OCR model saw went through `/redact-image`. `tests/test_redactor.py` covers the redactor, scanned pages included; `tests/test_picture_parser.py`, `tests/test_table_parser.py` and `tests/test_anonymiser.py` the face blur and the safety net; privacy-service's `tests/test_allow_list.py` covers `allow_list.json`.
- Labelling quality: `eval.labelling.run_eval` takes `--privacy` (see Eval results).
- S5 `tests/test_leak.py` and `tests/test_vision_privacy.py` (PV-04): no seeded detail reaches Gemini in any text, every photo goes as privacy-service returned it, details Gemini adds to its answer are taken out (unless `check_answers` is off), and the reading fails closed. privacy-service's `tests/test_redact_image.py` runs the real detector on a public-domain portrait (`tests/fixtures/`).
- Photo reading quality: `eval.interpret_photos` and `eval.suggest_categories` take `--privacy`.
- `tests/test_leak.py` (Rule 10): replaces the Cohere, Anthropic and OpenAI SDK clients with recorders and runs each drafting flow, and chat on both providers, with seeded PII: a client name, "John Tan", `+65 9123 4567` and `S1234567D`. It asserts that none of them is sent.
- `tests/test_chat_privacy.py`: chat's masking, streaming unmask, quote check, document filters, rerank, fail-closed and provenance. `tests/test_privacy.py` covers `unmask_stream` itself.
- Chat quality: `eval.chat_eval prepare` and `run` take `--privacy` (see Eval results).
- `tests/test_*_privacy.py`: masking, unmasking, the unsupported flag, provenance and fail-closed behaviour, per flow.
- Quality: run the judges with and without `--privacy`, e.g. `uv run --extra dev python -m eval.judge_sections --privacy`. privacy-service must be running. The agreed margin is that each judge's mean may drop at most 0.2 with protection on (G1). The eval cases come from redacted reports, so a run measures the cost of masking (false positives, masked past reports), not how real names are handled.

## Eval results

Recorded on 2026-10-20 for PV-02. The drafter was `claude-sonnet-5-5` at medium effort, with prompts gn01-v2.11, gn05-v6 and gn07-v3. The judge was `gpt-6-luna` at **medium** reasoning (`JUDGE_REASONING=medium`; at high, each judge call took 4–5 minutes). Both runs used the same settings, so they differ only in masking. Each score averages two judge runs.

| Judge | Cases | Mean, off | Mean, on | Change | Passing, off → on |
|---|---|---|---|---|---|
| Sections | 5 | 4.55 | 4.50 | −0.05 | 3 → 2 |
| OFIs | 3 | 4.65 | 4.55 | −0.10 | 3 → 1 |
| Executive Summary | 1 | 4.56 | 4.88 | +0.32 | 1 → 1 |

Every judge is within the agreed margin (a drop of at most 0.2, G1).

| Case | Off | On | Details masked |
|---|---|---|---|
| mall-2-s7-construction | 4.75 pass | 4.55 fail | 6 |
| mixed-1-s9-fire-protection | 4.9 pass | 4.7 pass | 5 |
| office-5-s4-risk-quality | 4.7 pass | 4.7 pass | 3 |
| office-5-s5-loss-estimates | 3.9 fail | 4.45 fail | 4 |
| office-5-s7-construction | 4.5 fail | 4.1 fail | 6 |
| mall-2-ofis | 4.75 pass | 4.75 pass | 1 |
| mixed-1-ofis | 4.5 pass | 4.3 fail | 1 |
| office-5-ofis | 4.7 pass | 4.6 fail | 4 |
| office-5-summary | 4.56 pass | 4.88 pass | 7 |

**How to read it:**
- **The judge is noisy, so read the means, not single cases.** Marsh's own text, which is identical in both runs, moved by up to 0.4 per case between them (for example office-5-s4, 3.6 → 3.2; office-5-ofis, 3.85 → 4.1). The three flips from pass to fail (one sections case, two OFI cases) are within that noise.
- **The case notes hold no PII,** because they come from redacted reports. Most masked details came from past-report passages.
- **Two false positives in the notes:** spaCy read "L33-47 - site" and "alu spandrels w" as person names, so the model saw `[PERSON_1]` in their place. Such fragments can now be added to `allow_list.json` (PV-05).

To run, from `microservices/rag-service`, with privacy-service running and `PRIVACY_SERVICE_URL=http://127.0.0.1:8004` set. On Windows, also set `PYTHONUTF8=1`, since the summary case file is UTF-8 and `read_text()` would otherwise use cp1252.

```
uv run --extra dev python -m eval.judge_sections
uv run --extra dev python -m eval.judge_sections --privacy
uv run --extra dev python -m eval.judge_ofis
uv run --extra dev python -m eval.judge_ofis --privacy
uv run --extra dev python -m eval.judge_summary
uv run --extra dev python -m eval.judge_summary --privacy
```

Each result row records `privacy` (`null` for an off run), so the two runs can be told apart in `eval/results/*.jsonl`.

### Labelling (PV-05), recorded 2026-11-05: partial

`eval.labelling.run_eval --only office5-p1-20,mall2-p1-20,mixed1-p1-20,mall2-p25-28`, without and with `--privacy`. Only these four report cases could run: the other golden PDFs live in `.local-docs/golden/pdfs/`, which this machine didn't have, and the scanned NFPA cases' files here are empty. The masked run sends no known names (the eval has no client list), and the sample reports were redacted by hand already, so it measures what masking costs, not how real names are handled. Reports: `eval/labelling/results/2026-11-05-partial.md` and `2026-11-05-partial-privacy.md`.

| Candidate | Fixed-list correct, off | On | Free-text correct, off | On |
|---|---|---|---|---|
| Jev | 75% | 75% | | |
| OpenAI Decisions | 83% | 83% | | |
| Haiku 4.5 | 83% | 75% | 88% | 88% |
| Haiku 5.5 | 75% | 75% | 100% | 100% |
| GPT-6 Luna | 92% | 92% | 100% | 100% |

12 fixed-list and 8 free-text details. The one drop is a single detail: Haiku 4.5 read mall2-p1-20 as a mixed-use development with masking on, within the noise of four cases. OpenAI Decisions left one detail blank instead of guessing it wrong. Run the full golden set, both ways, where `.local-docs` is available:

```
cd microservices/ingestion-service
uv run python -m eval.labelling.run_eval
uv run python -m eval.labelling.run_eval --privacy   # privacy-service running; PRIVACY_SERVICE_URL=http://127.0.0.1:8004 on Windows
```

### Chat (PV-03), recorded 2026-10-21: judging incomplete

61 CB-01 cases (90 turns), prompt `cb01-v17`, planner `claude-haiku-5-5` at medium, answer model `claude-sonnet-5-5` at low (the model `.env` names; no OpenAI chat key was set), live transport. Off is variant `baseline`, on is `v1` (`--privacy`, with the 19 known names `docmap` read from Mongo). Both runs finished all 61 cases with no errors. With protection on, 63 of 90 turns masked at least one detail (up to 47 in one turn), and no placeholder reached a shown answer.

| Metric (code-graded) | Off | On |
|---|---|---|
| Retrieval hit | 0.222 | 0.193 |
| Quote found | 0.982 | 0.987 |
| Decline rate (unanswerable) | 0.895 | 0.895 |
| False decline | 0.045 | 0.000 |
| Clarified | 0.833 | 0.833 |
| Mean answer latency | 6.35 s | 6.71 s |

**Not yet measured:** "supported" and "on topic", the judge's metrics. The judge (`anthropic:claude-sonnet-5-5`, effort medium, 2 runs) stopped when the Anthropic account ran out of credit, so the on run has no judged rows. To finish once credit is added (each run re-judges only the rows not yet judged):

```
uv run --extra dev python -m eval.chat_eval grade --flow ../../.claude/hillclimb/pv03-chat --variant baseline --judge anthropic:claude-sonnet-5-5 --judge-effort medium --transport live --yes
uv run --extra dev python -m eval.chat_eval grade --flow ../../.claude/hillclimb/pv03-chat --variant v1 --judge anthropic:claude-sonnet-5-5 --judge-effort medium --transport live --yes
```

**Retrieval hit is understated in both runs, by how the eval matches documents, not by masking.** `docmap` matches a case's gold document to the knowledge base by exact file name. Three standards were uploaded under other names (`FM_2.81_Apr_26.pdf` is `FM 2-81.pdf`, `NFPA_25_2026.pdf` is `NFPA 25 2026.pdf`, and `NFPA_13_2019.pdf` is `nfpa-13-standard-…`), so no passage of theirs counts. The fourth, `NFPA 13-2022.pdf`, is not ingested at all (only the 2019 edition is), so its 18 turns can never score. With the three names matched in memory, retrieval hit per turn is 35/64 off and 31/64 on. Leaving out the NFPA 13 2022 turns, that is about 0.76 off and 0.67 on. In the six turns that differ, every search query is free of placeholders and the planner simply worded the search differently, so one run per case can't separate masking from the planner's variation. There is no earlier recorded retrieval-hit figure to compare against.

To run the chat eval with protection, from `microservices/rag-service` with privacy-service running and `PRIVACY_SERVICE_URL=http://127.0.0.1:8004`: `docmap` (needs `--with pymongo`), `prepare` and `prepare --privacy`, then `run --variant baseline` and `run --variant v1 --privacy` with the same model flags.

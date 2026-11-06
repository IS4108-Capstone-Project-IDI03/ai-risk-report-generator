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
| Site walk proposal (CP-22) | Yes | CP-22 | The transcript, existing location names and photo descriptions are masked before the walk-reading model and Jev. The photo itself and the audio are not (speech-to-text and photo description, rows below). |
| Photo on a chat question (CB-08, Gemini) | Faces: always checked, the engineer chooses | CB-08 | privacy-service finds faces when the photo is attached; the engineer blurs them (the default) or sends the photo as is. If the check cannot run, the photo is not kept or sent. Only the photo goes to the vision model; its description joins the question's context and is masked with the rest of the question (PV-03). Text printed on a photo cannot be masked. |
| Client intake: reading a client's documents (CP-23) | Yes | CP-23 | Every document's name and text is masked before the reading model and Jev, including a client or site not yet recorded. See "Client intake" below. The files themselves are stored in S3 and never sent. |
| Pre-survey checklist (CP-30) | Not needed | CP-30 | Only the facility type, country and standard ids are sent; S4's request has no field for client text. |
| Report export (EX-01) | Not needed | EX-01 | No AI call. The gateway refuses a file whose text still holds a placeholder (`[PERSON_2]`, `client_1`, `[PHONE 3]`), naming where it is (422). |
| Proposed figures for Sections 4 and 5 (GN-03) | **No** | (PV-02 follow-up) | `POST /figures/propose` sends observations and sections to the model unmasked. |
| Observation reading: photos, and since CP-21 any observation's text (Gemini) | Yes | PV-04 | Faces in photos are blurred; the note, transcripts and location are masked. Item labels ("Note", a photo's file name) are not. |
| Handwritten note transcription (CP-19, Gemini) | **No, by decision** | PV-04 | The page image must be read by the model, so it can't be masked. See Known gaps. |
| Ingestion: labelling, OCR crops, embedding | **No** | PV-05/06 | Past reports in Chroma were indexed unredacted (open question G4). |
| Speech-to-text | **No** | PV-08 (deferred) | |

## How a protected request works

The gateway decides whether protection is on. It sends `privacy: {enabled, known_entities}` with each request (`server/src/services/privacy.service.ts: privacyFor`). The Python services never read `PII_PROTECTION`, and without a `privacy` field they behave as before.

`known_entities` lists the assessment's client, site (name and code), address and every active user. A client or site that was renamed, or a site whose address was corrected (CP-18), also lists the names and addresses it had before, after the current one: notes written with an old name are still masked, and the placeholder restores to the first name, so they read back with the current one. Names match in any case and spacing, so a change of case alone keeps no former name.

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

Chat has no assessment, so the gateway sends every client (and any client name typed on an assessment before CP-17), every site and its address, removed sites included, with their former names (CP-18), and every active user (`chatPrivacy`). It reads them at most once a minute, so a client added, or a name corrected, in the last minute is not yet masked by its new name. It always sets `privacy` itself, replacing any the browser sent.

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

**What `detect` adds** in privacy-service (`app/masker.py`, `app/allow_list.py`):
- `CLIENT` masks spaCy's organisations as `[CLIENT_n]`, and `SITE` masks its facilities (buildings, plants, warehouses) as `[SITE_n]`. Known names still win where spans overlap.
- **A never-mask list** (`NEVER_MASK`) keeps Marsh, Marsh McLennan, FM Global, NFPA, SCDF (and Singapore Civil Defence Force), UL, VdS, LPCB, Munich Re and Swiss Re readable, whatever the model says. They are never a client, and the reading needs them. Matching is on the whole name, in any case.
- **Span tidying** (`_unlisted_parts`): spaCy's spans are loose. They run over line breaks into a form label ("Crest Tower Central\nAddress"), start with "the", or join names ("Marsh and FM Global"). Each detected span is cut per line, split at "and", a comma or "&" when one part is on the never-mask list, trimmed of spaces and a leading "the", and dropped when it is a label (ends in a colon) or only a company form ("Pte Ltd"). Without this, a placeholder would restore to the loose text, and Marsh would be masked with a client it was written next to.
- Countries and cities are never masked, so the jurisdiction can still be read.

**Fail closed (AC19).** If privacy-service is down, errors or passes the 60 s timeout, rag-service answers 503 and the gateway answers the engineer 503 with the reason ("Client details couldn't be protected…"). Nothing is sent to the model or Jev, and raw text is never the fallback. When protection is off (`privacy.enabled` false), documents are read unmasked, as every other flow.

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

## Known gaps

- **Other clients in past reports.** Known entities cover only the current assessment's client. A different client's company name or address in a stored past report is not detected, because organisation and location recognition is off. PV-05 redacts past reports at ingestion.
- **Client intake: some names are still readable after masking (CP-23).** Recorded names are always masked (they are known entities). Names nobody recorded depend on spaCy and on patterns for building names ("<Name> Tower", "<Name> Hub", "Phase 2") and street addresses ("12 Kallang Road", "Jalan Seri Utama 2"), so an unusual name can slip through. Measured on the CP-23 eval's 24 synthetic packs (3 Nov 2026), after masking: 1 of 22 client names (a Thai "Co., Ltd" name), 0 of 31 new site names, 2 of 48 contact names (Malay and Thai names spaCy doesn't read as people) and 0 of 31 addresses were still readable in the text sent to the AI. The patterns over-mask a little (a heading or "Visit Lindenmoor Tower" masked as one name); each placeholder still restores to its text. The packs use invented names in the sample reports' shapes, so real documents may differ.
- **Figure proposals and ingestion** are not protected yet (see the table above).
- **Site walks:** the audio (Whisper) and the photos (`/describe-photo`) go out unmasked, as for voice notes (PV-08). Unlike observation reading (PV-04), a site walk's photos are not blurred. Only the AI step that reads their text is protected.
- **Handwritten pages (CP-19) go to the AI as photographed.** The model must read the page, so its text can't be masked first. This is accepted for now: the risk is mostly in the *combination* of details (a name with an NRIC and a phone number), and the main goal is not to store PII in the database. Scan mode asks the engineer to leave names, phone numbers and ID numbers off the page. The transcript is masked later, like any text, whenever it feeds drafting or chat. A local handwriting model would close the gap.
- **Photo reading: faces only.** Text in a photo (a name badge, a tag with a phone number) is not redacted, so Gemini reads it. The answer check keeps it out of what is saved, except a building name on its own ("University Hall"). Tesseract redaction was left out (1–3 s per photo). Faces turned well away from the camera, or under about 17 px in the photo, may not be detected.
- **Photo labels are not masked.** A photo's label is its file name, which the proposal cites. A file named after a person would reach Gemini.
- **Chat's known names are read once a minute.** A client or user added in the last minute, or a client's or site's new name, is not masked by name in chat (spaCy may still catch a person's name).
- **Former names are masked for good** (CP-18). A generic old name, e.g. a site once called "Main building", is masked wherever it appears in its assessment's text, and in chat for everyone.
- **Windows, outside Docker:** `localhost` costs about 2 s per `/mask` call (IPv6 is tried first). Set `PRIVACY_SERVICE_URL=http://127.0.0.1:8004`. Docker uses the service name and is unaffected.
- From PV-01: a surname written before the full name gets two placeholders, and `[PERSON 1]` (with a space) is not restored.

## Testing

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
- **Two false positives in the notes:** spaCy read "L33-47 - site" and "alu spandrels w" as person names, so the model saw `[PERSON_1]` in their place. Adding such fragments to the privacy-service allow-list (`allow_list.py`) is a candidate follow-up.

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

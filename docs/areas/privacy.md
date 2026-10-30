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
| Pre-survey checklist (CP-30) | Not needed | CP-30 | Only the facility type, country and standard ids are sent; S4's request has no field for client text. |
| Proposed figures for Sections 4 and 5 (GN-03) | **No** | (PV-02 follow-up) | `POST /figures/propose` sends observations and sections to the model unmasked. |
| Observation reading: photos, and since CP-21 any observation's text (Gemini) | **No** | PV-04 | |
| Handwritten note transcription (CP-19, Gemini) | **No** | PV-04 | The page image goes to `HANDWRITING_PROVIDER`. Its text is masked later, when it feeds drafting. |
| Ingestion: labelling, OCR crops, embedding | **No** | PV-05/06 | Past reports in Chroma were indexed unredacted (open question G4). |
| Speech-to-text | **No** | PV-08 (deferred) | |

## How a protected request works

The gateway decides whether protection is on. It sends `privacy: {enabled, known_entities}` with each request (`server/src/services/privacy.service.ts: privacyFor`). The Python services never read `PII_PROTECTION`, and without a `privacy` field they behave as before.

`known_entities` lists the assessment's client, site (name and code), address and every active user.

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

Chat has no assessment, so the gateway sends every client (and any client name typed on an assessment before CP-17), every site and its address, and every active user (`chatPrivacy`). It reads them at most once a minute, so a client added in the last minute is not yet masked. It always sets `privacy` itself, replacing any the browser sent.

In rag-service (`app/chat/answer.py`):
1. **One `/mask` call** covers the conversation (earlier answers hold real names), the engineer's context and the document names (a past report's title can name its client). The planner and the answer model see the same placeholder for a name.
2. **The planner's output** is unmasked where the engineer sees it: its own reply, the search shown on screen, and the filters in the result. A document it names by placeholder is restored before matching. The queries sent to Cohere **stay masked**.
3. **Rerank** reads every candidate masked, through `retrieve(rank_texts=...)`: stored past reports can name people. The passages returned keep their stored text.
4. **The passage block** sent to the answer model is masked in a second call with the same mapping. Unlike drafting, chat masks standards' passages too.
5. **The answer streams back with real names** (`Session.unmask_stream`). A placeholder split across chunks is held back until it is complete, at most 24 characters, and restored JSON-escaped, since it lands inside `Statement("...")`. The quote check, the screen and the saved answer all read real text, checked against the original passages.
6. `chat_result.privacy` records `{enabled, masked_count}`. Both chat prompts say to copy placeholders exactly (`cb01-v17`).

If privacy-service fails, chat answers "Sorry, the chat couldn't answer: Client details couldn't be protected because the privacy service…" and calls no model or search.

**Placeholder-shaped input.** Text that already contains something like `[PERSON_1]` (typed by an engineer, or from a past report) is swapped for `[LITERAL_n]` before masking, and restored after unmasking. Without that swap, unmasking would put a real name where the input never had one. A bracketed escape such as `[ PERSON_1 ]` does not work, because the unmask pattern accepts placeholders without brackets.

## What is detected

The table below summarises PV-01; the epic, section C, has the details.

| Detects | How |
|---|---|
| Client, site, address and staff names | Whole-word match against `known_entities`. |
| Other person names | spaCy `en_core_web_lg`, PERSON only. |
| Phone numbers, emails, NRIC/FIN | Presidio recognisers, plus a context label check for phone numbers and IDs. |
| UEN; a postal code after "Singapore" | Hand-written patterns. |

Kept as they are: jurisdiction, facility type, COPE category, severity, standard references, brands, floor and room names, figures and dates.

## Known gaps

- **Other clients in past reports.** Known entities cover only the current assessment's client. A different client's company name or address in a stored past report is not detected, because organisation and location recognition is off. PV-05 redacts past reports at ingestion.
- **Figure proposals, observation reading, handwriting and ingestion** are not protected yet (see the table above).
- **Chat's known names are read once a minute.** A client or user added in the last minute is not masked by name in chat (spaCy may still catch a person's name).
- **Windows, outside Docker:** `localhost` costs about 2 s per `/mask` call (IPv6 is tried first). Set `PRIVACY_SERVICE_URL=http://127.0.0.1:8004`. Docker uses the service name and is unaffected.
- From PV-01: a surname written before the full name gets two placeholders, and `[PERSON 1]` (with a space) is not restored.

## Testing

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

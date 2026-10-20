# PII protection before external AI calls (epic E11)

Client details are swapped for typed placeholders (`[CLIENT_1]`, `[PERSON_2]`) before text goes to Anthropic, OpenAI, Gemini or Cohere. The real values are restored afterwards. The local `privacy-service` does the masking (PV-01); each caller masks its own requests.

## Protected flows

`PII_PROTECTION=required` covers **only the flows below**. Never read it as "everything is protected".

| Flow | Protected | Since | Notes |
|---|---|---|---|
| Section drafting, incl. redraft and Regenerate | Yes | PV-02 | Cohere search and rerank queries, past-report passages and the prompt are masked. |
| OFI drafting (Section 3) | Yes | PV-02 | As for sections; accepted OFI titles are masked too. |
| Executive Summary (Section 2) | Yes | PV-02 | The saved section text is masked. |
| Knowledge-base chat | **No** | PV-03 | Sends history, message and passages unmasked. |
| Photo reading (Gemini) | **No** | PV-04 | |
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
- **Chat, photos and ingestion** are not protected yet (see the table above).
- From PV-01: a surname written before the full name gets two placeholders, and `[PERSON 1]` (with a space) is not restored.

## Testing

- `tests/test_leak.py` (Rule 10): replaces the Cohere and Anthropic SDK clients with recorders and runs each drafting flow with seeded PII: a client name, "John Tan", `+65 9123 4567` and `S1234567D`. It asserts that none of them is sent.
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

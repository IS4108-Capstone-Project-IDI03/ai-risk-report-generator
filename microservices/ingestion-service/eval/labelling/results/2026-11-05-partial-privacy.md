# Labelling evaluation (2026-11-05, client details masked (PV-05))

- Prices (USD per 1M tokens, dated 2026-10-07; Haiku 5.5 2026-10-08): jev 0.042 in / 0.0 out; openai-decisions 0.1 in / 0.0 out; claude-haiku-4-5 1.0 in / 5.0 out; claude-haiku-5-5 0.1 in / 0.5 out; gpt-6-luna 0.1 in / 0.5 out
- LABEL_PAGES: 20 (OCR capped at the first 5); each case reads its whole cut. Fixed-list tables use cutoff 0.70.
- Golden cases shown: 4 (1 tune, 3 test; 0 full-length, excluded from the tables).
- Known coverage gap: every report is Singapore and only three facility types appear (office, shopping mall, mixed-use). Other countries and facility types are untested.

## Comparison

### Fixed-list details: all (cutoff 0.70)

| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |
|---|---|---|---|---|---|---|
| Jev | 12 | 75% | 100% | 75% (12 filled) | $0.00029 | 1.8s |
| OpenAI Decisions | 12 | 83% | 92% | 91% (11 filled) | $0.00061 | 2.7s |
| Haiku 4.5 | 12 | 75% | 100% | 75% (12 filled) | $0.01033 | 8.0s |
| Haiku 5.5 | 12 | 75% | 100% | 75% (12 filled) | $0.00141 | 9.5s |
| GPT-6 Luna | 12 | 92% | 100% | 92% (12 filled) | $0.00081 | 5.6s |

### Fixed-list details: reports (cutoff 0.70)

| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |
|---|---|---|---|---|---|---|
| Jev | 12 | 75% | 100% | 75% (12 filled) | $0.00029 | 1.8s |
| OpenAI Decisions | 12 | 83% | 92% | 91% (11 filled) | $0.00061 | 2.7s |
| Haiku 4.5 | 12 | 75% | 100% | 75% (12 filled) | $0.01033 | 8.0s |
| Haiku 5.5 | 12 | 75% | 100% | 75% (12 filled) | $0.00141 | 9.5s |
| GPT-6 Luna | 12 | 92% | 100% | 92% (12 filled) | $0.00081 | 5.6s |

### Fixed-list details: standards (cutoff 0.70)

| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |
|---|---|---|---|---|---|---|
| Jev | 0 | - | - | - (0 filled) | - | - |
| OpenAI Decisions | 0 | - | - | - (0 filled) | - | - |
| Haiku 4.5 | 0 | - | - | - (0 filled) | - | - |
| Haiku 5.5 | 0 | - | - | - (0 filled) | - | - |
| GPT-6 Luna | 0 | - | - | - (0 filled) | - | - |

### Free-text details: all (grounded in the page text)

| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |
|---|---|---|---|---|---|---|
| Haiku 4.5 | 8 | 88% | 88% | 86% (7 filled) | $0.01033 | 8.0s |
| Haiku 5.5 | 8 | 100% | 88% | 100% (7 filled) | $0.00141 | 9.5s |
| GPT-6 Luna | 8 | 100% | 88% | 100% (7 filled) | $0.00081 | 5.6s |

### Free-text details: reports (grounded in the page text)

| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |
|---|---|---|---|---|---|---|
| Haiku 4.5 | 8 | 88% | 88% | 86% (7 filled) | $0.01033 | 8.0s |
| Haiku 5.5 | 8 | 100% | 88% | 100% (7 filled) | $0.00141 | 9.5s |
| GPT-6 Luna | 8 | 100% | 88% | 100% (7 filled) | $0.00081 | 5.6s |

### Free-text details: standards (grounded in the page text)

| Candidate | Details scored | Correct (all) | Auto-filled | Correct when auto-filled | Cost/doc | Time/doc |
|---|---|---|---|---|---|---|
| Haiku 4.5 | 0 | - | - | - (0 filled) | - | - |
| Haiku 5.5 | 0 | - | - | - (0 filled) | - | - |
| GPT-6 Luna | 0 | - | - | - (0 filled) | - | - |

## Call errors and n/a

none

## Cutoff sweep (fixed-list group)

| Candidate | Cutoff (90% on tune, most auto-filled) | Tune auto-filled | Tune correct when auto-filled |
|---|---|---|---|
| Jev | 0.50 | 100% | 100% |
| OpenAI Decisions | 0.50 | 100% | 100% |
| Haiku 4.5 | 0.50 | 100% | 100% |
| Haiku 5.5 | 0.50 | 100% | 100% |
| GPT-6 Luna | 0.50 | 100% | 100% |

## Winners (chosen on the tune split only)

- Fixed-list: Jev at cutoff 0.50
- Free-text: GPT-6 Luna

## First-pages sufficiency

### Evidence beyond the pages read (model-free)

Whole-document cases only (extracts are mid-document on purpose).

| Case | Detail | Evidence page | Pages read |
|---|---|---|---|
| none | | | |

Full vs first-pages comparison: runs with the test split (full cases are test only).

## Mistakes

| Case | Candidate | Detail | Expected | Got | Confidence | Evidence |
|---|---|---|---|---|---|---|
| mall2-p1-20 | Haiku 4.5 | facility_type | Shopping mall | Mixed-use development | 0.95 | an eight-story premium destination mall |
| mall2-p25-28 | Haiku 4.5 | facility_type | Shopping mall | Mixed-use development | 0.95 | The mall has a diverse mix of about 300 international and local brands |
| mall2-p25-28 | Haiku 4.5 | jurisdiction | None | SG | 0.95 |  |
| mall2-p25-28 | Haiku 5.5 | facility_type | Shopping mall | Mixed-use development | 0.85 | The mall has a diverse mix of about 300 international and local brands |
| mall2-p25-28 | Haiku 5.5 | jurisdiction | None | SG | 0.85 |  |
| mall2-p25-28 | Jev | facility_type | Shopping mall | Mixed-use development | 0.92 | The mall has a diverse mix of about 300 international and local brands |
| mall2-p25-28 | Jev | jurisdiction | None | SG | 0.93 |  |
| mall2-p25-28 | GPT-6 Luna | jurisdiction | None | SG | 0.98 |  |
| mall2-p25-28 | OpenAI Decisions | facility_type | Shopping mall | null (model said 'Mixed-use development') | 0.55 | The mall has a diverse mix of about 300 international and local brands |
| mall2-p25-28 | OpenAI Decisions | jurisdiction | None | SG | 1.00 |  |
| mixed1-p1-20 | Haiku 4.5 | title | Property Risk Evaluation Report | [PROPERTY] Development | 0.95 | Property Risk Evaluation Report |
| office5-p1-20 | Haiku 5.5 | facility_type | Mixed-use development | Office | 0.70 | is a mixed-use development that occupies |
| office5-p1-20 | Jev | facility_type | Mixed-use development | Office | 0.75 | is a mixed-use development that occupies |

Run cost (fresh calls only): $0.0233. Wall time: 78s.

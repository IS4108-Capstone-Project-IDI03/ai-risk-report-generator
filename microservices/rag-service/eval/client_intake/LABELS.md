# Where the client intake answer keys come from (CP-23)

Source: the 11 redacted Marsh Property Risk Engineering reports (Mixed Use Development 1-2,
Office 0-6, Shopping Mall 1-2). Each pack is based on one report's shape: its facility type,
how the site and address are written, how the survey date and "First Survey by Marsh" / "Date
Last Surveyed" line read (first survey vs resurvey), and the contact roles ("Property Manager",
"Head of M&E", "Senior Building Manager"). A few packs keep the report's shape but swap the
facility type (warehouse, cold store, port terminal, or one that is not on the list).
Everything else is invented. **All client, person, company and site names and addresses are
made up** (Singapore style, plus a few Malaysia, Thailand and Hong Kong); none comes from a
report, which are redacted anyway. Visit dates are in 2027, after the documents' send dates.

## What a pack is

What one client sent us to start work, as the text `/extract-text` would return from each file:
emails (header lines then body), letters, site information sheets, and pasted email text.
`plans.json` holds the 24 plans (the answer keys). `golden.json` holds each pack's request to
the step (`documents`, the recorded `clients` with their sites, `facility_types`,
`jurisdictions`) and its key. Every request also lists two unrelated recorded clients, so
matching has distractors. 12 packs were written by Claude by hand (`written_by: "claude"`),
12 by GPT-6.1 Sol through `write_packs.py` (`written_by: "gpt-6.1-sol"`), so one model does
not write every test for the others. Jesper spot-checks a few.

## The answer key (per plan)

| Field | Meaning |
|---|---|
| `client` | `name`, `division` (null = none stated), `existing_id` (the recorded client it is, or null for a new one) |
| `sites[]` | `ref`, `name`, `address`, `jurisdiction` (a code from the list), `facility_type` (one of the 9, or null = off-list, the right answer is Not sure), `existing_site_id` (recorded site, or null) |
| `assessments[]` | `ref`, `site_ref`, `visit_type` (First survey, Resurvey, Follow-up visit), `site_visit_date`, `site_visit_end_date`, `report_due_date` (null = the documents do not give it), `site_contacts[]` of `name` and `role` |
| `documents[]` | `id`, `name`, `kind` (email, letter, sheet, pasted), `placement` (`client`, or `site` / `assessment` with the `ref`), `about` (what the writer is told) |
| `recorded_clients[]` | The recorded clients and sites this pack's request lists, with `has_assessments` |
| `hard_cases` | Tags, below |

For a recorded client or site the key still holds its name and address, to pair it with the
response; the fields are not scored (the form uses the recorded values).

## Scoring (scoring.py, no judge)

- Light normalisation: case, punctuation and spaces are ignored; addresses compare on words
  (80% shared, "Rd" = "Road"); dates and jurisdiction codes compare exactly.
- **Accuracy** per field: client name and division (new clients only); site name, address,
  jurisdiction, facility type (new sites only); visit type; visit start and end dates; report
  due date; contacts (name ignoring titles, then role).
- A key value of null means the right answer is empty. **Empty-when-absent** counts a null in
  the response; a **filled-when-absent** value is a made-up value. For a present key value:
  correct, **wrong** (filled, different) or **Not sure** (empty), counted apart.
- **Client and site match**: the response names the same recorded id as the key (or none for a
  new one). Naming none with `match_not_sure` for a recorded one counts as Not sure; anything
  else is wrong.
- **Placement**: the document's kind and, for site and assessment, the same site or visit.
- **Counts**: sites and visits found, and **extra** ones (a site proposed twice, or a place or
  visit the key does not have). A missing site or visit leaves its values Not sure.
- Sites pair by recorded id, then by address (or a near-identical name). A visit pairs inside
  its site by visit type and dates.

## Split

12 packs `tuning` (p01-p12), 12 `held-out` (p13-p24). Tune prompts and the confidence cutoffs
on tuning only; report held-out as the result, and do not change a prompt after seeing it.
Each hard case below appears in both halves (except where the table says otherwise).

## Hard cases

| Tag | What it tests |
|---|---|
| `missing_date` | The visit date is not stated (still to be arranged); the key is null and the right answer is empty |
| `date_changed` | A later email replaces the date; the latest wins |
| `multi_site` | Several sites in one pack, each proposed once |
| `client_typo` | The pack misspells a recorded client; it must still match |
| `similar_client_trap` | A recorded client with a similar name that is a different company; it must not match |
| `resurvey`, `follow_up` | A recorded site that has assessments: Resurvey or Follow-up visit (a new site is always First survey) |
| `multi_assessment` | Two visits to one site (p10, tuning only) |
| `off_list_facility` | Facility type not on the list; the key is null (Not sure) |
| `division`, `date_range`, `many_contacts` | Division stated; visit over two days; four contacts |
| `placement_client`, `placement_site`, `placement_assessment` | A document that belongs to the whole client, to a site, to one visit |
| `pasted`, `letter_only`, `long_pack` | Pasted email text; a pack with no emails; a pack of 10 documents and about 40,000 characters (p04, tuning only) |
| `hk`, `th`, `my` | Hong Kong, Thailand and Malaysia sites (jurisdiction other than SG) |

`new_client`, `recorded_client`, `recorded_site` and `other_facility` are descriptive tags.

## Known limits

- Plans, not real client files. Real files are messier (scanned forms, long threads).
- Names are English-style; local-language documents are not covered.
- 24 packs is small: a rate moves 4 points per pack. Say so beside every result.

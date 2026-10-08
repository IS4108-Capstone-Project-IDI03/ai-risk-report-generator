---
name: Opportunities for Improvement drafting guide (GN-05)
about: How to draft Section 3 OFIs of a Marsh PRE report. Read by generator.draft_ofis; this header is for people, not the model. Bump OFI_PROMPT_VERSION in generator.py when the guide changes.
---

## What an OFI is

An Opportunity for Improvement (OFI) is a recommendation to reduce a risk found on site.
Each one is a record with fixed fields, not prose. Write one OFI per distinct issue; two
observations about the same problem become one OFI. Not every observation needs an OFI:
leave out anything that is already adequate, or that is a fact rather than a gap.

## Fields

- **title**: short and specific, saying what to improve, as Marsh writes them: "Improve
  Hot Work Permit", "Formalize Fire Protection System Impairment", "Lock Open Hosereel
  Firewater Valve".
- **category**: "Physical Protection" whenever the fix needs a device fitted, locked,
  repaired, replaced or cleaned, or building work, even if a procedure goes with it
  ("Lock Open Hosereel Firewater Valve", "Install smoke detector"). "Management
  Programs" only when the fix is purely a procedure, programme, permit, record,
  inspection schedule or training ("Improve Hot Work Permit", "Formalize Fire
  Protection System Impairment Programme"). Housekeeping, including removing stored
  items, is Management Programs. "Other" only if neither fits.
- **type**: the closest value from the list given.
- **description**: the technical basis for the OFI: what should be done and why. Name a
  standard ("As per NFPA 25, …") only when a cited standards passage covers this exact
  issue; never name a standard you were not given a passage from. Otherwise state the
  fix without one. Two to four sentences.
- **observation**: why the OFI is raised at this site: what was found, and where, in
  plain report prose ("As observed at the Basement 1 fire pump room, …"). Only facts from
  the cited observations.
- **likelihood** and **consequence**: your judgement of the risk the OFI addresses, from
  the lists given. Code works out the priority from these two, so rate them with care:
  - Consequence is the damage if the risk occurs, not how hard the fix is. Major or
    Catastrophic only when the gap could let a fire grow unchecked or spread beyond its
    compartment: a protection system out of service or unable to work when needed, or
    a fire barrier that has failed. Moderate when the gap weakens protection, response
    or recovery but leaves it working: a procedure or permit missing a step, records
    not kept, supplies run low. Minor or Insignificant for housekeeping, planning and
    paperwork improvements.
  - Likelihood is how far the gap is already present, assuming a fire can start at any
    time (never rate it lower just because a fire must start). Likely or Almost Certain
    when the defect exists on site now and directly weakens protection (a valve shut,
    heads obstructed, a door that will not close). Possible when it depends on a
    separate lapse happening (a repair or isolation being forgotten, a procedure not
    followed). Unlikely or Very Rare for gaps in planning or records.
  - Most OFIs in Marsh's reports are Priority 2. Priority 1 is for protection that is
    out of service or a fire barrier that has failed; Priority 3 and 4 for
    improvements to plans, records and housekeeping.
- **effort**: the effort of implementation. Capital whenever any hardware, lock,
  repair, replacement or building work is needed; Procedural only when the fix is a
  change to a procedure, programme or record. Major, Moderate and Minor are the
  relative cost and time.

## Evidence

- Every OFI rests on at least one current observation (O labels). Never raise an OFI
  from a past report or a standard alone.
- Cite a standards passage (C labels) only if it bears on the fix.
- A past-report OFI (P labels) shows how Marsh words a similar OFI. Name it as the
  precedent if you adapted it, but never copy its site facts (locations, names,
  quantities, dates) into this site's OFI.
- Don't propose an OFI that matches one already accepted.

## Voice

Singapore/British English, third person, no "we" or "you". State findings plainly; no
hedging and no marketing words.

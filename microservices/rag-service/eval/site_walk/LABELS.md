# Where the site walk labels come from (CP-22)

Source: 11 redacted Marsh Property Risk Engineering reports (Mixed Use Development 1-2,
Office 0-6, Shopping Mall 1-2), template v2.0. Each finding in `golden.json` is a real
finding from one of them, re-narrated in new words. No names, no long passages.

## Severity: the report's own grade

Each Opportunity for Improvement (OFI, report section 3) carries a **Priority 1-4** from the
report's Risk Assessment Matrix (consequence x likelihood). It is the only per-finding grade
the reports give, so it is the severity source.

| Report grade | Severity | Examples (OFI observations, shortened) |
|---|---|---|
| Priority 1 | critical | Hot work check allows "3m, lower than the recommended 11m", no fire watch. Jockey pump "set to manual operation". "Combustible materials were found to be kept in fire pump room". |
| Priority 2 | high | Pressure-sensing valves "not locked open" (fire pump room). "no formalized fire protection system impairment programme". Cover plates "painted over". |
| Priority 3 | moderate | Hose reel valves "not locked open". Transfer pump outlet valve "only partially opened". Private hydrant inspection "not carried out". |
| Priority 4 | low | ERP lacks an "EV charger and PV panel" fire scenario. Wet chemical service reports not kept by the landlord. |
| Positive remark | low | See below. |

Does not map cleanly: Priority is risk-based, not defect-based. The same defect (valves not
locked open) is Priority 2 in one report and Priority 3 in another. We take the report's
number as given, not our view of the defect. Four grades to four severities is one-to-one, so
the mapping itself is clean.

**Positive findings map to low.** Sources: the "Risk Quality Rating Comments" positive
points ("Good housekeeping observed for most areas visited", "Good redundancy for critical
utilities", "Preventive maintenance programmes are in place"), and a Management Program
maturity of Established, Embedded or Optimized (smoking controls "Optimized").

**Exposure.** The reports rate boundary exposures and natural catastrophe exposures
("Light" / "Low" in every report here). These map to low. No report has a Moderate or Heavy
boundary rating, so Exposure is only ever low in this set.

Not used: the 0-10 Risk Quality Rating scores and A-E location rating (one score per main
category, not per finding), and loss estimates (per scenario).

## Category: report section to COPE

| COPE | Report section / OFI Type |
|---|---|
| Construction | 7 Construction, incl. compartmentalization: OFI Type "Fire Compartmentation" (cable penetrations); fire doors and fire shutters |
| Occupancy | 8 Occupancy, Hazards and Utilities: Type "Housekeeping", "Hot Work Permit"; utilities redundancy; smoking controls |
| Protection | 9 Fire Protection (sprinklers, detection, pumps, alarm, manual firefighting): Types "Fire Protection System ...", "Automatic Sprinkler System", "Fire Detection System", "Impairment program", "Pre-Emergency Planning" |
| Exposure | 10 External Exposures (boundary, natural catastrophe) |

Sections 11 Security and 12 Business Interruption have no finding in the set.

Judgement calls (not stated by the report):
- Hot Work Permit is a section 6 management program, but ignition control is an occupancy
  hazard. Mapped to Occupancy.
- Fire doors and shutters: typed "Fire Door", "Fire door ITM", "Obstruction of fire shutter",
  discussed under compartmentalization (section 7). Mapped to Construction.
- Impairment and emergency planning are management programs that serve fire protection.
  Mapped to Protection.

## Dropped (grade or category not defensible)

- Generator no-load test OFIs: Priority is stated, but the Type is "Fire Protection
  Maintenance" in one report and "No-Load Test for Generator" in another, so the section is
  unclear (9 or 8).
- "Verify structural integrity" (wall cracks): Type reads "Fire Detection System", which does
  not fit the content.
- Cable penetration in a mixed-use report: Type "Fire Protection System" there, but
  "Fire Compartmentation" elsewhere. Only the Fire Compartmentation ones are used.
- Effluent neutralization pit (pH): not a COPE category.
- Management Program maturity ranks Undeveloped / Formalized: no per-finding severity.

## Splits

Every case in `golden.json` has a `split`. Tune prompts only on `tuning`; `held-out` is for
checking results.

| Split | Cases | Findings | What it is |
|---|---|---|---|
| `tuning` | 28 | 172 | The first 11 walks, 10 short re-narrated walks, 2 long walks (office, mall) and 5 existing-heavy walks. |
| `held-out` | 16 | 92 | 11 short walks, the mixed-use long walk, the mixed walk and 3 existing-heavy walks. Never used for tuning. |

- Re-split on 31 Oct (Jesper): about 65% of findings to tune on, 35% held out. The 7 short
  walks whose misses were looked at after the first comparison moved to tuning, since they
  could no longer give an honest held-out score.
- Held-out walks share report findings and defect types with tuning walks (every report is
  in both), so the held-out score measures new wording and new walks, not new reports.
- If a prompt is changed because of a held-out result, that walk becomes a tuning walk.
- Long walks are typed, 4,000-8,000 words and 32 findings each: many places, repeats,
  mishearings, chit-chat. The mixed walk is a recorded walk with typed notes between the
  recordings.
- The 21 short walks added on 31 Oct and the mixed walk are re-narrated from findings the
  first 11 walks do not use.
  Office 3 repeats Office 0 word for word, so its findings are covered by the Office 0 walks.
  The same defect in another report is a separate finding (its own Priority and place).
- Each keyword set matches exactly one sentence (or segment) of its walk, so a faithful note
  matches one expected observation only. The first 11 walks were not changed.
- Mixed transcript shape: `recordings` holds normal recordings and typed notes in walk order.
  A typed note takes the next `seq`, like a recording:

```json
{"kind": "recordings", "recordings": [
  {"seq": 1, "segments": [{"start": 0.0, "end": 4.0, "text": "..."}]},
  {"seq": 2, "kind": "typed", "text": "..."},
  {"seq": 3, "segments": [{"start": 0.0, "end": 5.2, "text": "..."}]}
]}
```

Positive remarks used beyond the three above: fire resistive construction (Construction),
sprinkler, detector and suppression coverage (Protection), management of hazardous substance
storage (Occupancy) and a light boundary exposure (Exposure). All are low.

Also dropped: staff fire safety training (positive point in Office 4, Office 5, Shopping Mall
1): not clearly one COPE section. Fuel day tank level (Mixed Use 1): Type "Management of
back up power supply", section unclear like the generator OFIs.

## Existing-heavy slice (2 Nov)

Every walk above has 0 or 1 existing locations; a real assessment (Office Sample 5) has 20.
The 8 `mc-*` walks run on one made-up mixed-use site, Marina Crest, with 19 existing
locations: a hotel tower, an office tower, a podium, a car park block and three places with
no building or level. Building names are spelled inconsistently on purpose ("Tower 1 — Hotel
and Serviced Apartments", "Tower 2 (Office)" and "TOWER 2 (OFFICE)", "Podium Block - Retail &
F&B" and "Podium", "Blk C Car Park"), and one level is written "B3".

- The walks say buildings short ("Tower 1", "Podium Block", "Block C", misheard "Block See"),
  repeat places, mishear one ("bean centre"), find things at existing places, add new places
  inside existing buildings, and have findings with no place.
- A new place's expected building is the existing building's full spelling.
- Split by walk, 24 findings to `tuning` (5 walks) and 12 to `held-out` (3 walks), about
  65/35. The held-out walks were not looked at before the short-building fix was written.
- Every finding is a graded report OFI (its Priority is the severity) or a report positive
  point (low): Mixed Use 1 (kitchen nozzles P1, hot work 3m P1, isolations P2, switch/MDF room
  storage P2, cover plates P2, hose reel valves P3, lift motor room detector P3, ERP P4), Mixed
  Use 2 (pressure-sensing valves P2), Office 0 and 1 (cable penetrations P1, jockey pump P1,
  detectors P1, motor valve P1, water-proving test P2), Office 2 (hydrant inspection P3,
  valve-locking belts P3), Office 4 (pump room and stairwell storage P1), Office 5 (recessed
  heads P1), Shopping Mall 1 and 2 (shutters P2, door holder P2, in-house impairment P1, painted
  cover plates P2). Positives: fire resistive construction, good redundancy for critical
  utilities, sprinkler and detector coverage, Smoking Controls "Optimized", light boundary
  exposure.

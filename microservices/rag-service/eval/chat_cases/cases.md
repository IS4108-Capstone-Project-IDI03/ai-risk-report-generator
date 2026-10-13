# CB-01 eval cases (draft for review)

60 cases, 86 user turns. Please read each question and mark any that are unrealistic, wrongly answered, or missing something engineers care about.

Expect: **answer** (cite the source), **decline** (knowledge base can't answer), **clarify** (ask which topic), **chat** (small talk, no search).

| id | type | question (first turn) | expect | answer is in |
|---|---|---|---|---|
| fm-01 | single_fact | What air pressure and how long do we hold it for the leak test on a new dry system? | answer | FM_2.0_Apr_26.pdf p.155 |
| fm-02 | single_fact | How long do we need to keep our ITM paperwork on file for FM? | answer | FM_2.81_Apr_26.pdf p.4 |
| fm-03 | single_fact | How many spare heads should the sprinkler cabinet hold? | answer | FM_2.0_Apr_26.pdf p.56 |
| fm-04 | table_number | Walk-in freezer sits at -20F and we only have ethylene glycol available. What % mix do we need? | answer | FM_2.0_Apr_26.pdf p.25 |
| fm-05 | table_number | How often should we pull a sample of dry pendents and test them? | answer | FM_2.81_Apr_26.pdf p.7 |
| fm-06 | conditional | New system, static pressure at the riser is 180 psi. What hydro test pressure and duration? | answer | FM_2.0_Apr_26.pdf p.154 |
| fm-07 | conditional | 3,000 sq ft cold dock, no FM Approved antifreeze on the market for it, but the space never drops below 32F. Can we use plain propylene glycol and what strength? | answer | FM_2.0_Apr_26.pdf p.26 |
| fm-08 | list | When do we call a sprinkler system obstructed after a debris investigation? | answer | FM_2.81_Apr_26.pdf p.7 |
| fm-09 | multi_passage | We run an antifreeze loop in the cold store. What has to be on the placard, and how often is the solution checked? | answer | all of: FM_2.0_Apr_26.pdf p.26; FM_2.81_Apr_26.pdf p.8 |
| fm-10 | negation | Which system types can skip the inspector's test connection? | answer | FM_2.0_Apr_26.pdf p.28 |
| fm-11 | false_premise | Our valve chains use combination padlocks so nobody needs a key. That meets FM, right? | answer | FM_2.81_Apr_26.pdf p.5 |
| fm-12 | why | Why does FM want the main drain test done after the valve exercise and not before? | answer | FM_2.81_Apr_26.pdf p.6 |
| nfpa-01 | single_fact | What's the steepest roof pitch we can have over ESFR heads? | answer | NFPA 13-2022.pdf p.126 |
| nfpa-02 | single_fact | The fire department connection piping was repaired. What pressure do we retest that stub at? | answer | NFPA 13-2022.pdf p.392 |
| nfpa-03 | single_fact | On a dry pipe valve, how far above trip pressure should the low-air supervisory signal be set? | answer | NFPA 13-2022.pdf p.62 |
| nfpa-04 | table_number | For a hydraulically calculated extra hazard system, what hose stream allowance and supply duration do I design for? | answer | NFPA 13-2022.pdf p.181 |
| nfpa-05 | table_number | What density and area do I use for an EH2 area on a new system? | answer | NFPA 13-2022.pdf p.180 |
| nfpa-06 | table_number | Light hazard, old pipe-schedule system, flat non-combustible ceiling with nothing in the way. How much floor can one head cover and how far apart can they go? | answer | NFPA 13-2022.pdf p.85 |
| nfpa-07 | table_number | For a pipe-schedule ordinary hazard system, what flow and residual pressure do they want at the riser base? | answer | NFPA 13-2022.pdf p.180 |
| nfpa-08 | conditional | Site has about 450 sprinklers in total. How many spare heads should be in the cabinet? | answer | NFPA 13-2022.pdf p.132 |
| nfpa-09 | conditional | There's an unsprinklered combustible void above the ceiling in an OH area. Does that change the design area? | answer | NFPA 13-2022.pdf p.181 |
| nfpa-10 | list | What has to be written on the hydraulic nameplate at the riser? | answer | NFPA 13-2022.pdf p.393 |
| nfpa-11 | multi_passage | Can I put ESFR heads in a light hazard office, and if so how much floor can each head cover? | answer | all of: NFPA 13-2022.pdf p.126; NFPA 13-2022.pdf p.85 |
| nfpa-12 | comparison | Under the 2019 edition of NFPA 13, what goes on the placard at an antifreeze system's main valve, and is that different in the 2022 edition? | answer | all of: NFPA_13_2019.pdf p.62; NFPA 13-2022.pdf p.65 |
| nfpa-13 | comparison | What temperature rating do ESFR heads have to be in the 2019 edition of NFPA 13, and how does the 2022 edition differ? | answer | all of: NFPA_13_2019.pdf p.115; NFPA 13-2022.pdf p.126 |
| nfpa-14 | comparison | Hydro test on new sprinkler pipework: what pressure and hold time does NFPA 13 want compared with FM 2-0? | answer | all of: NFPA 13-2022.pdf p.392; FM_2.0_Apr_26.pdf p.154 |
| nfpa-15 | comparison | How often should the flow switches on wet systems get an alarm test: NFPA 25 or FM 2-81, and do they differ? | answer | all of: NFPA_25_2026.pdf p.74; FM_2.81_Apr_26.pdf p.6 |
| nfpa-16 | negation | When are quick-response heads not allowed on a density/area design? | answer | NFPA 13-2022.pdf p.85 |
| nfpa-17 | false_premise | Cold store has a dry system and we want ESFR heads on it. What's the max spacing? | answer | NFPA 13-2022.pdf p.126 |
| nfpa-18 | why | Why is there a minimum distance between sprinkler heads? | answer | NFPA 13-2022.pdf p.83 |
| rep-01 | single_fact | Have past reports flagged anything about stuff being kept in the fire pump room, and why does it matter? | answer | Office Sample 4 - PRE 2026 - REDACTED.pdf p.9 |
| rep-02 | single_fact | Do surveys ever recommend detection for lift motor rooms? What was the reasoning? | answer | Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf p.14 |
| rep-03 | list | What should an emergency response plan say about an EV charger fire, according to the reports we have? | answer | any of: Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf p.10,11; Office Sample 2 - PRE 2025 - REDACTED.pdf p.11 |
| rep-04 | multi_passage | One report found the sprinkler pumps were not tested fully and the jockey pump was in the wrong mode. What did it recommend on each? | answer | all of: Office Sample 1 - PRE 2026 - REDACTED.pdf p.9; Office Sample 1 - PRE 2026 - REDACTED.pdf p.11 |
| rep-05 | multi_passage | In a past mall survey, how did they assess the hot work permit: what was good about it and what was missing? | answer | all of: Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.10; Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.22 |
| rep-06 | filter_named | For office buildings, how often do past reports say emergency diesel generators should get a no-load test? | answer | any of: Office Sample 0 - PRE 2026 - REDACTED.pdf p.11; Office Sample 3 - PRE 2026 - REDACTED.pdf p.11 |
| rep-07 | filter_named | What do Singapore reports say about inspecting private fire hydrants? | answer | Office Sample 2 - PRE 2025 - REDACTED.pdf p.12 |
| rep-08 | filter_named | At a Singapore shopping mall, what's the problem with painted-over concealed sprinkler covers? | answer | Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.12 |
| rep-09 | filter_named | In Marsh reports on mixed-use developments, how often should waterflow switches be inspected and tested? | answer | Office Sample 6 - PRE 2026 - REDACTED.pdf p.9 |
| rep-10 | filter_named | Do Marsh office reports in Singapore say anything about high-volume low-speed fans and sprinklers? | answer | Office Sample 1 - PRE 2026 - REDACTED.pdf p.11 |
| un-01 | near_miss | How often does the Fire Safety Certificate for a Singapore building need to be renewed? | decline | — |
| un-02 | near_miss | What does SS 555 say about how far apart the down conductors on a lightning protection system should be? | decline | — |
| un-03 | near_miss | What FM-200 design concentration do I need for a server room? | decline | — |
| un-04 | near_miss | How many air changes per hour should the smoke extraction run at in a basement mall? | decline | — |
| un-05 | outside_standards | Which Eurocode 8 ground type should I assume for the structural design of a new podium block? | decline | — |
| un-06 | outside_standards | What should our cyber insurance wording cover if ransomware takes down the building systems? | decline | — |
| un-07 | filter_empty | What did the Malaysian past reports say about sprinkler impairments? | decline | — |
| un-08 | filter_empty | Pull up the warehouse past reports and tell me what they found on rack storage protection. | decline | — |
| un-09 | off_topic | Can you give me a good recipe for chicken rice? | decline | — |
| un-10 | off_topic | Write me a Python script that renames all files in a folder. | decline | — |
| conv-01 | coreference | How often do we need to take the supply strainers apart on the fire main? *(+2 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.13 |
| conv-02 | coreference | What should we be checking every week on a dry pipe valve? *(+2 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.9 |
| conv-03 | coreference | What do the reports on mixed-use developments say about their hot work permit system? *(+2 follow-ups)* | answer | Office Sample 4 - PRE 2026 - REDACTED.pdf p.22 |
| conv-04 | clarify | How often do we test the low air pressure supervisory alarms on a dry system? *(+3 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.10 |
| conv-05 | clarify | How long should the electric fire pump churn for when we test it? *(+3 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.14 |
| conv-06 | topic_switch | How often should someone walk round and check the control valves are open and locked? *(+3 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.5 |
| conv-07 | topic_switch | In the Mall 1 report, how big is the site technician team? *(+3 follow-ups)* | answer | Shopping Mall Sample 1 - PRE 2024 - REDACTED.pdf p.26 |
| conv-08 | followup_unanswerable | How often do we partial-flow trip test the dry pipe valve? *(+3 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.10 |
| conv-09 | edition_switch | What's the biggest area one standard pendent sprinkler can cover under NFPA 13? *(+3 follow-ups)* | answer | NFPA 13-2022.pdf p.85 |
| conv-10 | small_talk | How often should we look over the outside of our water tanks? *(+2 follow-ups)* | answer | FM_2.81_Apr_26.pdf p.19 |

## Each case

### fm-01 · single_fact · fm

**Engineer:** What air pressure and how long do we hold it for the leak test on a new dry system?  
Expect **answer** · source: FM_2.0_Apr_26.pdf p.155  
Reference: Pneumatic leakage test at 40 psi (2.8 bar) for a minimum of 24 hours; fix leaks causing more than 1.5 psi (0.1 bar) total loss over the 24 hours.

### fm-02 · single_fact · fm

**Engineer:** How long do we need to keep our ITM paperwork on file for FM?  
Expect **answer** · source: FM_2.81_Apr_26.pdf p.4  
Reference: At least one year, so management or the authority having jurisdiction can audit it.

### fm-03 · single_fact · fm

**Engineer:** How many spare heads should the sprinkler cabinet hold?  
Expect **answer** · source: FM_2.0_Apr_26.pdf p.56  
Reference: The minimum is based on the largest number of sprinklers in the design area of the system they serve, with a supply for each sprinkler type installed.

### fm-04 · table_number · fm

**Engineer:** Walk-in freezer sits at -20F and we only have ethylene glycol available. What % mix do we need?  
Expect **answer** · source: FM_2.0_Apr_26.pdf p.25  
Reference: 49% ethylene glycol by volume in water for a lowest ambient of -20F (-29C), per the non-FM Approved antifreeze table.

### fm-05 · table_number · fm

**Engineer:** How often should we pull a sample of dry pendents and test them?  
Expect **answer** · source: FM_2.81_Apr_26.pdf p.7  
Reference: Every 15 years, test a random sample of dry-type (dry pendent) sprinklers.

### fm-06 · conditional · fm

**Engineer:** New system, static pressure at the riser is 180 psi. What hydro test pressure and duration?  
Expect **answer** · source: FM_2.0_Apr_26.pdf p.154  
Reference: Static pressure above 150 psi means test at 50 psi above static, so 230 psi, held for 2 hours with no pressure loss (200 psi is the minimum otherwise).

### fm-07 · conditional · fm

**Engineer:** 3,000 sq ft cold dock, no FM Approved antifreeze on the market for it, but the space never drops below 32F. Can we use plain propylene glycol and what strength?  
Expect **answer** · source: FM_2.0_Apr_26.pdf p.26  
Reference: Yes: above 2,000 sq ft a non-FM Approved antifreeze system is acceptable if the area stays at or above 32F, using propylene glycol at 20% to 25% (or glycerin at 30% to 35%).

### fm-08 · list · fm

**Engineer:** When do we call a sprinkler system obstructed after a debris investigation?  
Expect **answer** · source: FM_2.81_Apr_26.pdf p.7  
Reference: If about 1/2 cup (120 ml) or more of debris is in a cross main; debris pieces could plug a sprinkler orifice; flow from a branch line is obstructed; or videoscope or ultrasonic analysis shows obstruction.

### fm-09 · multi_passage · fm

**Engineer:** We run an antifreeze loop in the cold store. What has to be on the placard, and how often is the solution checked?  
Expect **answer** · source: all of: FM_2.0_Apr_26.pdf p.26; FM_2.81_Apr_26.pdf p.8  
Reference: The placard lists the antifreeze type, percent concentration, volume required and the lowest ambient temperature designed for (2-0). The solution is tested annually, before the cold season, by specific gravity (2-81).

### fm-10 · negation · fm

**Engineer:** Which system types can skip the inspector's test connection?  
Expect **answer** · source: FM_2.0_Apr_26.pdf p.28  
Reference: Antifreeze solution systems and deluge systems do not need an inspector's test connection.

### fm-11 · false_premise · fm

**Engineer:** Our valve chains use combination padlocks so nobody needs a key. That meets FM, right?  
Expect **answer** · source: FM_2.81_Apr_26.pdf p.5  
Reference: No. FM says not to use combination locks; each control valve should have its own sturdy key-operated lock and chain, with keys limited to ITM staff and local management.

### fm-12 · why · fm

**Engineer:** Why does FM want the main drain test done after the valve exercise and not before?  
Expect **answer** · source: FM_2.81_Apr_26.pdf p.6  
Reference: Because the main drain test is often the final step in restoring system impairments such as valve closures, so it confirms the supply is open after exercising valves.

### nfpa-01 · single_fact · nfpa

**Engineer:** What's the steepest roof pitch we can have over ESFR heads?  
Expect **answer** · source: NFPA 13-2022.pdf p.126  
Reference: ESFR sprinklers can only go where the roof or ceiling slope above them is no more than 2 in 12 (16.7 percent).

### nfpa-02 · single_fact · nfpa

**Engineer:** The fire department connection piping was repaired. What pressure do we retest that stub at?  
Expect **answer** · source: NFPA 13-2022.pdf p.392  
Reference: After repair or replacement affecting the FDC, the piping between the exterior connection and the check valve is isolated and hydrostatically tested at 150 psi (10 bar).

### nfpa-03 · single_fact · nfpa

**Engineer:** On a dry pipe valve, how far above trip pressure should the low-air supervisory signal be set?  
Expect **answer** · source: NFPA 13-2022.pdf p.62  
Reference: At least 5 psi (0.3 bar) above the calculated trip pressure of the dry pipe valve.

### nfpa-04 · table_number · nfpa

**Engineer:** For a hydraulically calculated extra hazard system, what hose stream allowance and supply duration do I design for?  
Expect **answer** · source: NFPA 13-2022.pdf p.181  
Reference: Inside hose 0, 50 or 100 gpm; total combined inside and outside hose 500 gpm (1900 L/min); water supply duration 90 or 120 minutes.

### nfpa-05 · table_number · nfpa

**Engineer:** What density and area do I use for an EH2 area on a new system?  
Expect **answer** · source: NFPA 13-2022.pdf p.180  
Reference: Extra Hazard Group 2: 0.4 gpm/ft2 over 2500 ft2, or 0.38 gpm/ft2 over 3000 ft2 where the unsprinklered combustible concealed space rule applies (Table 19.2.3.1.1).

### nfpa-06 · table_number · nfpa

**Engineer:** Light hazard, old pipe-schedule system, flat non-combustible ceiling with nothing in the way. How much floor can one head cover and how far apart can they go?  
Expect **answer** · source: NFPA 13-2022.pdf p.85  
Reference: Maximum protection area 200 ft2 (18 m2) per sprinkler with maximum spacing 15 ft (4.6 m).

### nfpa-07 · table_number · nfpa

**Engineer:** For a pipe-schedule ordinary hazard system, what flow and residual pressure do they want at the riser base?  
Expect **answer** · source: NFPA 13-2022.pdf p.180  
Reference: Minimum residual pressure 20 psi (1.4 bar) with an acceptable flow at the base of the riser, including hose stream, of 850-1500 gpm (3200-5700 L/min) for 60 or 90 minutes (Table 19.2.2.1).

### nfpa-08 · conditional · nfpa

**Engineer:** Site has about 450 sprinklers in total. How many spare heads should be in the cabinet?  
Expect **answer** · source: NFPA 13-2022.pdf p.132  
Reference: At least 12 spare sprinklers, since 300 to 1000 installed sprinklers requires no fewer than 12 (under 300: six; over 1000: 24).

### nfpa-09 · conditional · nfpa

**Engineer:** There's an unsprinklered combustible void above the ceiling in an OH area. Does that change the design area?  
Expect **answer** · source: NFPA 13-2022.pdf p.181  
Reference: Yes. With unsprinklered combustible concealed spaces (unless 19.2.3.1.5.2 is met), the minimum area of sprinkler operation for that part of the building is 3000 ft2 (280 m2), applied to the system portions adjacent to the concealed space.

### nfpa-10 · list · nfpa

**Engineer:** What has to be written on the hydraulic nameplate at the riser?  
Expect **answer** · source: NFPA 13-2022.pdf p.393  
Reference: Design area location; design area size or number of sprinklers; discharge densities; required flow and residual pressure at the riser base or pump; occupancy or commodity class with max storage height and configuration; hose stream allowance; installing contractor name.

### nfpa-11 · multi_passage · nfpa

**Engineer:** Can I put ESFR heads in a light hazard office, and if so how much floor can each head cover?  
Expect **answer** · source: all of: NFPA 13-2022.pdf p.126; NFPA 13-2022.pdf p.85  
Reference: Yes. ESFR sprinklers designed to the Chapter 23/24 criteria may protect light hazard, and their area limit may follow the light hazard table, giving up to 225 ft2 (20 m2) per head for a hydraulically calculated noncombustible unobstructed ceiling.

### nfpa-12 · comparison · nfpa · NFPA 13 2019 vs 2022

**Engineer:** Under the 2019 edition of NFPA 13, what goes on the placard at an antifreeze system's main valve, and is that different in the 2022 edition?  
Expect **answer** · source: all of: NFPA_13_2019.pdf p.62; NFPA 13-2022.pdf p.65  
Reference: 2019: manufacturer type and brand, the concentration by volume of the solution, and the volume used. 2022: the concentration by volume item is replaced by the minimum use temperature of the solution; brand and volume are unchanged.

### nfpa-13 · comparison · nfpa · NFPA 13 2019 vs 2022

**Engineer:** What temperature rating do ESFR heads have to be in the 2019 edition of NFPA 13, and how does the 2022 edition differ?  
Expect **answer** · source: all of: NFPA_13_2019.pdf p.115; NFPA 13-2022.pdf p.126  
Reference: 2019: ordinary unless 9.4.2 requires intermediate or high. 2022: ordinary or intermediate is allowed by default, and 9.4.2 can still require intermediate; the high-temperature option is no longer mentioned there.

### nfpa-14 · comparison · nfpa · NFPA 13 vs FM 2-0

**Engineer:** Hydro test on new sprinkler pipework: what pressure and hold time does NFPA 13 want compared with FM 2-0?  
Expect **answer** · source: all of: NFPA 13-2022.pdf p.392; FM_2.0_Apr_26.pdf p.154  
Reference: Both: 200 psi for 2 hours without loss. Where pressure is above 150 psi, NFPA 13 adds 50 psi to system working pressure, FM 2-0 adds 50 psi to the system static pressure.

### nfpa-15 · comparison · nfpa · NFPA 25 vs FM 2-81

**Engineer:** How often should the flow switches on wet systems get an alarm test: NFPA 25 or FM 2-81, and do they differ?  
Expect **answer** · source: all of: NFPA_25_2026.pdf p.74; FM_2.81_Apr_26.pdf p.6  
Reference: NFPA 25: vane-type, paddle-type and pressure-switch-type waterflow devices are tested semiannually (mechanical water motor gongs quarterly). FM 2-81: waterflow alarms including flow switches quarterly (annually for antifreeze systems), so FM is more frequent.

### nfpa-16 · negation · nfpa

**Engineer:** When are quick-response heads not allowed on a density/area design?  
Expect **answer** · source: NFPA 13-2022.pdf p.85  
Reference: They are not permitted in extra hazard occupancies when the density/area design method is used.

### nfpa-17 · false_premise · nfpa

**Engineer:** Cold store has a dry system and we want ESFR heads on it. What's the max spacing?  
Expect **answer** · source: NFPA 13-2022.pdf p.126  
Reference: The premise is wrong: ESFR sprinklers are for wet pipe systems only, unless specifically listed for dry or preaction use. Spacing can only be given once such a listing exists (ESFR max 100 ft2, 12 ft up to 30 ft ceilings).

### nfpa-18 · why · nfpa

**Engineer:** Why is there a minimum distance between sprinkler heads?  
Expect **answer** · source: NFPA 13-2022.pdf p.83  
Reference: So an operating sprinkler does not wet adjacent sprinklers (cold-soldering them) and so sprinklers are not skipped.

### rep-01 · single_fact · report

**Engineer:** Have past reports flagged anything about stuff being kept in the fire pump room, and why does it matter?  
Expect **answer** · source: Office Sample 4 - PRE 2026 - REDACTED.pdf p.9  
Reference: A past report (Office Sample 4) raised an OFI to remove combustibles stored in the fire pump room, because they add fire load and can help fire spread. The client removed them.

### rep-02 · single_fact · report

**Engineer:** Do surveys ever recommend detection for lift motor rooms? What was the reasoning?  
Expect **answer** · source: Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf p.14  
Reference: Mixed Use Sample 1 recommended smoke detectors in the L44 and L47 lift motor rooms: unmanned, enclosed rooms where a fire could go unnoticed, so detection allows early response and limits spread.

### rep-03 · list · report

**Engineer:** What should an emergency response plan say about an EV charger fire, according to the reports we have?  
Expect **answer** · source: any of: Mixed Use Development Sample 1 - PRE 2025 - REDACTED.pdf p.10,11; Office Sample 2 - PRE 2025 - REDACTED.pdf p.11  
Reference: Actions listed: press the emergency stop near the charger (do not unplug the cable), pull the nearby fire alarm and evacuate, call 995 with charger/vehicle make and model and electrical panel locations, and refer to NFPA 70, NFPA 1, NFPA 1620 and NFPA 855. Mixed Use Sample 1 is the gold; Office Sample 2 has near-identical text.

### rep-04 · multi_passage · report

**Engineer:** One report found the sprinkler pumps were not tested fully and the jockey pump was in the wrong mode. What did it recommend on each?  
Expect **answer** · source: all of: Office Sample 1 - PRE 2026 - REDACTED.pdf p.9; Office Sample 1 - PRE 2026 - REDACTED.pdf p.11  
Reference: Office Sample 1: (1) annual flow test of the sprinkler pumps at churn, rated and 150% flow per NFPA 25 (investigate if results fall below 95% of the pump curve), since the annual water-proving test does not exercise the pumps; (2) set the jockey pump, found on manual, back to automatic so system pressure is maintained.

### rep-05 · multi_passage · report

**Engineer:** In a past mall survey, how did they assess the hot work permit: what was good about it and what was missing?  
Expect **answer** · source: all of: Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.10; Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.22  
Reference: Shopping Mall Sample 2: the permit system exists with risk assessment and method statement, and requires clearing combustibles within 4 m (below NFPA's 11 m, accepted due to space limits with fire blankets), but it lacked a fire watch during and after hot work, so an OFI was raised per NFPA 51B (fire watch 30-60 min after, monitoring a further 3 hours).

### rep-06 · filter_named · report

**Engineer:** For office buildings, how often do past reports say emergency diesel generators should get a no-load test?  
Expect **answer** · filters: {'facility_type': 'Office'} · source: any of: Office Sample 0 - PRE 2026 - REDACTED.pdf p.11; Office Sample 3 - PRE 2026 - REDACTED.pdf p.11  
Reference: Monthly, per SS 535:2018; the report found testing was only quarterly. Office Sample 0 is the gold; Office Sample 3 has identical text.

### rep-07 · filter_named · report

**Engineer:** What do Singapore reports say about inspecting private fire hydrants?  
Expect **answer** · filters: {'jurisdiction': 'SG'} · source: Office Sample 2 - PRE 2025 - REDACTED.pdf p.12  
Reference: Office Sample 2: per NFPA 25, hydrants should be inspected and maintained annually; the private hydrant had not been inspected during the annual fire certificate renewal.

### rep-08 · filter_named · report

**Engineer:** At a Singapore shopping mall, what's the problem with painted-over concealed sprinkler covers?  
Expect **answer** · filters: {'jurisdiction': 'SG', 'facility_type': 'Shopping mall'} · source: Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.12  
Reference: Shopping Mall Sample 2: painting changes the cover plate temperature rating and can delay sprinkler activation in a fire; the client plans a one-time replacement of affected plates.

### rep-09 · filter_named · report

**Engineer:** In Marsh reports on mixed-use developments, how often should waterflow switches be inspected and tested?  
Expect **answer** · filters: {'source_type': 'marsh_report', 'facility_type': 'Mixed-use development'} · source: Office Sample 6 - PRE 2026 - REDACTED.pdf p.9  
Reference: Office Sample 6 (labelled mixed-use): inspect flow switches quarterly and test every 6 months, with the signal reaching the main fire alarm panel within 90 seconds (NFPA 25).

### rep-10 · filter_named · report

**Engineer:** Do Marsh office reports in Singapore say anything about high-volume low-speed fans and sprinklers?  
Expect **answer** · filters: {'jurisdiction': 'SG', 'source_type': 'marsh_report', 'facility_type': 'Office'} · source: Office Sample 1 - PRE 2026 - REDACTED.pdf p.11  
Reference: Office Sample 1: HVLS fans should be interlocked to shut down on a waterflow alarm (NFPA 13 20.8.1) so they do not disturb the sprinkler discharge pattern; four fans at Tower Block level 1 had no interlock.

### un-01 · near_miss · unanswerable

**Engineer:** How often does the Fire Safety Certificate for a Singapore building need to be renewed?  
Expect **decline** · source: —  
Reference: Decline. Searched all 16 text PDFs for 'Fire Safety Cert', 'FSC', 'certificate of statutory', 'fire permit': 0 hits. Past reports name SCDF only as the licensing body for petroleum/flammables storage; NFPA/FM say nothing about Singapore statutory certificates. (NFPA 25 PDF has no text layer, but it is an ITM standard, not a Singapore statute.)

### un-02 · near_miss · unanswerable

**Engineer:** What does SS 555 say about how far apart the down conductors on a lightning protection system should be?  
Expect **decline** · source: —  
Reference: Decline. Searched 'SS 555', 'SS555': 0 hits. Past reports only say a building has a lightning protection system tested annually (e.g. Office Sample 0 p41); NFPA 13/FM mention lightning only as a hazard/ignition source. No down-conductor spacing anywhere.

### un-03 · near_miss · unanswerable

**Engineer:** What FM-200 design concentration do I need for a server room?  
Expect **decline** · source: —  
Reference: Decline. Searched 'FM-200', 'heptafluoro', 'HFC-227', 'NOAEL', '% by volume': 0 hits. FM 2.81 p21 only gives ITM checks for gaseous systems (container pressure within 10%/5%) and refers to Data Sheet 4-9 for design, which is not in the knowledge base. NFPA 13 'concentration' hits are antifreeze solution.

### un-04 · near_miss · unanswerable

**Engineer:** How many air changes per hour should the smoke extraction run at in a basement mall?  
Expect **decline** · source: —  
Reference: Decline. Searched 'air changes', 'extraction rate', 'smoke extract', 'smoke exhaust': only hits are past reports describing that an engineered smoke control system exists (Office 4 p35, Office 5 p31, Office 6 p37, no design rates) and FM 2.0 gravity heat/smoke vent flowcharts (vent sizing for sprinkler recommendations, not mechanical extraction rates). No air-change or extraction-rate figure.

### un-05 · outside_standards · unanswerable

**Engineer:** Which Eurocode 8 ground type should I assume for the structural design of a new podium block?  
Expect **decline** · source: —  
Reference: Decline. Searched 'Eurocode': 0 hits. NFPA 13 Annex has sprinkler seismic bracing and a note on peak ground acceleration zone factors (p582) but nothing on structural building design codes. Structural earthquake design is outside the knowledge base.

### un-06 · outside_standards · unanswerable

**Engineer:** What should our cyber insurance wording cover if ransomware takes down the building systems?  
Expect **decline** · source: —  
Reference: Decline. Searched 'cyber', 'ransomware', 'data breach': 0 hits in all text PDFs. Cyber risk/cover is outside fire and property-protection standards and past reports.

### un-07 · filter_empty · unanswerable

**Engineer:** What did the Malaysian past reports say about sprinkler impairments?  
Expect **decline** · source: —  
Reference: Decline, no Malaysian reports. Searched 'Malaysia', 'Kuala', 'Johor': 0 hits (only 'Malay Street', a street name inside Mall Sample 1, p23/26/39). All 11 past reports are Singapore.

### un-08 · filter_empty · unanswerable

**Engineer:** Pull up the warehouse past reports and tell me what they found on rack storage protection.  
Expect **decline** · source: —  
Reference: Decline, no warehouse past reports. Searched 'warehouse' in the 11 past reports: 0 hits. 'Warehouse' appears only in FM 2.0, FM 2.81, NFPA 13 (standards, not past reports). Facility types present: office, mixed-use, shopping mall.

### un-09 · off_topic · unanswerable

**Engineer:** Can you give me a good recipe for chicken rice?  
Expect **decline** · source: —  
Reference: Decline / redirect. Not a property-risk question.

### un-10 · off_topic · unanswerable

**Engineer:** Write me a Python script that renames all files in a folder.  
Expect **decline** · source: —  
Reference: Decline / redirect. Not a property-risk question.

### conv-01 · coreference · conversation

1. **Engineer:** How often do we need to take the supply strainers apart on the fire main?  
   Expect **answer** · topic: FM ITM of fire service mains: supply strainers · source: FM_2.81_Apr_26.pdf p.13  
   Reference: Annually: disassemble and inspect in-line supply strainers for holes, corrosion or mechanical damage.

2. **Engineer:** And if we find debris in it?  
   Expect **answer** · topic: fire service mains: debris found · source: FM_2.81_Apr_26.pdf p.13  
   Reference: Conduct a complete system flushing when obstructions (debris) are discovered: flush mains and lead-in connections to system risers through hydrants at dead ends or flushing outlets.

3. **Engineer:** What about after we flow test a hydrant?  
   Expect **answer** · topic: fire service mains: strainers after hydrant flow test · source: FM_2.81_Apr_26.pdf p.13  
   Reference: Flush the in-line supply strainers until clear after any significant flow (flow above a main-drain test, e.g. hydrant flow testing, dry/preaction/deluge valve trip or flushing).

### conv-02 · coreference · conversation

1. **Engineer:** What should we be checking every week on a dry pipe valve?  
   Expect **answer** · topic: FM ITM weekly checks for dry system valve · source: FM_2.81_Apr_26.pdf p.9  
   Reference: Weekly: system valve air and water pressures, and the quick-opening device in-service condition (plus valve enclosure above 40F/4C).

2. **Engineer:** And the monthly ones?  
   Expect **answer** · topic: FM ITM monthly checks for dry system valve · source: FM_2.81_Apr_26.pdf p.9  
   Reference: Monthly: automatic drain valve open and free to move; priming-water level in the system valve; condition of the compressed air supply; indicating desiccant in air dryers.

3. **Engineer:** What's the lowest temperature we can let the valve room get to?  
   Expect **answer** · topic: dry system valve enclosure minimum temperature · source: FM_2.81_Apr_26.pdf p.9  
   Reference: Keep the system valve enclosure above 40F (4C); checked weekly.

### conv-03 · coreference · conversation

1. **Engineer:** What do the reports on mixed-use developments say about their hot work permit system?  
   Expect **answer** · topic: hot work permit systems in past reports · source: Office Sample 4 - PRE 2026 - REDACTED.pdf p.22  
   Reference: Office Sample 4: formal hot work permit system, subject to sign-off/approval by the FSM, with a building supervisor inspecting the work site to verify precautions.

2. **Engineer:** what about in malls?  
   Expect **answer** · topic: hot work permit systems in mall past reports · source: Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.22  
   Reference: Mall Sample 2: formalized system with risk assessment and method statement submitted for approval; checklist requires combustibles cleared within 4 m (NFPA suggests 11 m); an OFI adds a fire watch after hot work.

3. **Engineer:** Did they get a recommendation on it?  
   Expect **answer** · topic: hot work permit recommendation in mall reports · source: Shopping Mall Sample 2 - PRE 2025 - REDACTED.pdf p.10  
   Reference: Yes, Mall Sample 2 OFI 2025-01 'Improve Hot Work Permit': per NFPA 51B require constant fire watch during and at least 30-60 minutes after hot work, then monitor the area for at least 3 hours more.

### conv-04 · clarify · conversation

1. **Engineer:** How often do we test the low air pressure supervisory alarms on a dry system?  
   Expect **answer** · topic: FM ITM supervisory alarms dry system · source: FM_2.81_Apr_26.pdf p.10  
   Reference: Annually (quarterly for systems protecting areas constantly kept below freezing).

2. **Engineer:** And the waterflow alarms?  
   Expect **answer** · topic: FM ITM waterflow alarm test frequency · source: FM_2.81_Apr_26.pdf p.6  
   Reference: Quarterly (annually for antifreeze systems), by flowing water through a system test connection.

3. **Engineer:** Does that change for freezers or antifreeze systems?  
   Expect **clarify** · topic: ambiguous: supervisory alarms vs waterflow alarms · source: —  
   Reference: Ask which test is meant: supervisory alarms (quarterly below freezing) or waterflow alarms (annually for antifreeze).

4. **Engineer:** The waterflow alarms.  
   Expect **answer** · topic: waterflow alarm frequency for antifreeze systems · source: FM_2.81_Apr_26.pdf p.6  
   Reference: Annually instead of quarterly for antifreeze systems; no separate freezer-room interval is given for waterflow alarms.

### conv-05 · clarify · conversation

1. **Engineer:** How long should the electric fire pump churn for when we test it?  
   Expect **answer** · topic: FM electric fire pump churn test duration · source: FM_2.81_Apr_26.pdf p.14  
   Reference: A minimum of 10 minutes in automatic mode.

2. **Engineer:** And the diesel one?  
   Expect **answer** · topic: FM diesel fire pump churn test duration · source: FM_2.81_Apr_26.pdf p.15  
   Reference: A minimum of 30 minutes in automatic mode.

3. **Engineer:** How often do we have to run that test?  
   Expect **clarify** · topic: ambiguous: electric vs diesel churn test frequency · source: —  
   Reference: Ask whether electric or diesel pump (monthly vs weekly). Giving both intervals with the pump type labelled is a borderline acceptable answer.

4. **Engineer:** The diesel one.  
   Expect **answer** · topic: diesel fire pump churn test frequency · source: FM_2.81_Apr_26.pdf p.13  
   Reference: Weekly for diesel pumps (monthly for electric); do not isolate the pump during churn testing.

### conv-06 · topic_switch · conversation

1. **Engineer:** How often should someone walk round and check the control valves are open and locked?  
   Expect **answer** · topic: FM ITM control valve visual inspection · source: FM_2.81_Apr_26.pdf p.5  
   Reference: Weekly visual inspection for full-open, secured and accessible, recorded on a form.

2. **Engineer:** And the proper full exercise?  
   Expect **answer** · topic: FM ITM control valve full-travel exercise · source: FM_2.81_Apr_26.pdf p.5  
   Reference: Annually: full-travel exercise of all control valves, recording turns-to-close and turns-to-reopen.

3. **Engineer:** Different topic. Does the Office 4 report mention a smoke control system?  
   Expect **answer** · topic: Office 4 report smoke control system · source: Office Sample 4 - PRE 2026 - REDACTED.pdf p.35  
   Reference: Yes: the subterranean mall is protected by an engineered smoke control system of smoke curtains and extraction fans in multiple zones.

4. **Engineer:** What triggers it?  
   Expect **answer** · topic: Office 4 smoke control activation · source: Office Sample 4 - PRE 2026 - REDACTED.pdf p.35  
   Reference: It is controlled and synchronized by an addressable smoke detection system.

### conv-07 · topic_switch · conversation

1. **Engineer:** In the Mall 1 report, how big is the site technician team?  
   Expect **answer** · topic: Mall Sample 1 staffing · source: Shopping Mall Sample 1 - PRE 2024 - REDACTED.pdf p.26  
   Reference: Property management team: 2 managers, 3 property executives, 2 admin and 13 site technicians.

2. **Engineer:** What shifts do they work?  
   Expect **answer** · topic: Mall Sample 1 technician shifts · source: Shopping Mall Sample 1 - PRE 2024 - REDACTED.pdf p.26  
   Reference: Technicians work 2 shifts daily: 8:30am-4:30pm and 2:30pm-10:30pm.

3. **Engineer:** Switching topic: what does FM want us to do with sealed concealed sprinklers?  
   Expect **answer** · topic: FM ITM sealed concealed sprinklers · source: FM_2.81_Apr_26.pdf p.7  
   Reference: Annually do a physical and visual inspection: physically inspect at least 10% per room, visually inspect the rest; rotate the sample each year.

4. **Engineer:** And if one of them is faulty?  
   Expect **answer** · topic: FM concealed sprinkler deficiency follow-up · source: FM_2.81_Apr_26.pdf p.7  
   Reference: If a deficiency is noted in one sprinkler, physically inspect all sprinklers in that room.

### conv-08 · followup_unanswerable · conversation

1. **Engineer:** How often do we partial-flow trip test the dry pipe valve?  
   Expect **answer** · topic: FM dry valve partial-flow trip test · source: FM_2.81_Apr_26.pdf p.10  
   Reference: Annually; check the trip point (and trip time) agrees with the last full-flow trip test.

2. **Engineer:** And the full-flow one?  
   Expect **answer** · topic: FM dry system full-flow trip test · source: FM_2.81_Apr_26.pdf p.10  
   Reference: Every 3 years, or every 10 years for systems with nitrogen; videoscope or ultrasonic evaluation can be used instead.

3. **Engineer:** How much does a full-flow trip test usually cost in Singapore?  
   Expect **decline** · topic: cost of full-flow trip test (not in knowledge base) · source: —  
   Reference: Decline: costs/contractor pricing are not in the knowledge base (searched 'cost', 'price', 'SGD' in FM 2.81: only unrelated mentions of Wi-Fi valve supervision savings (p34) and laser alignment (p44); ITM tables give frequencies only).

4. **Engineer:** Ok. What's the longest water delivery time allowed on that test?  
   Expect **answer** · topic: FM full-flow trip test maximum water delivery time · source: FM_2.81_Apr_26.pdf p.10  
   Reference: 60 seconds to the hydraulically remote area unless an FM data sheet for the occupancy says otherwise.

### conv-09 · edition_switch · conversation

1. **Engineer:** What's the biggest area one standard pendent sprinkler can cover under NFPA 13?  
   Expect **answer** · topic: NFPA 13 max coverage area standard pendent sprinkler · source: NFPA 13-2022.pdf p.85  
   Reference: 225 ft2 (20 m2) maximum (NFPA 13-2022, 10.2.4.2.2).

2. **Engineer:** And in the 2019 edition?  
   Expect **answer** · topic: NFPA 13-2019 max coverage area standard pendent sprinkler · source: NFPA_13_2019.pdf p.81  
   Reference: Same in the 2019 edition: 225 ft2 (20 m2), 10.2.4.2.2.

3. **Engineer:** What about standard sidewalls in that one?  
   Expect **answer** · topic: NFPA 13-2019 max coverage area standard sidewall sprinkler · source: NFPA_13_2019.pdf p.88  
   Reference: 196 ft2 (18 m2) in NFPA 13-2019, 10.3.3.2.2.

4. **Engineer:** Is that the same in the current edition?  
   Expect **answer** · topic: NFPA 13-2022 max coverage area standard sidewall sprinkler · source: NFPA 13-2022.pdf p.94  
   Reference: Yes, NFPA 13-2022 10.3.3.2.2 also gives 196 ft2 (18 m2).

### conv-10 · small_talk · conversation

1. **Engineer:** How often should we look over the outside of our water tanks?  
   Expect **answer** · topic: FM ITM water tank exterior inspection · source: FM_2.81_Apr_26.pdf p.19  
   Reference: Monthly: check for obvious leaks, damage, erosion, obstructions and exposures; repair leaks and damage.

2. **Engineer:** Any rule about what can be stored or growing near them?  
   Expect **answer** · topic: FM water tank clearance to combustibles · source: FM_2.81_Apr_26.pdf p.19  
   Reference: Keep combustible yard storage, combustible waste and vegetation at least 50 ft (15 m) from the tank.

3. **Engineer:** thanks, that's helpful  
   Expect **chat** · source: —  
   Reference: Short friendly acknowledgement; no retrieval, no citations.

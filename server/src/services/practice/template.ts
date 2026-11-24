// F-12: the fixed template every practice assessment is made from (ADR 0003): a made-up cold
// store with its locations, observations, checklist, site walk, OFIs and proposed figures.
// Prepared text only, so making one costs no AI. The report's drafted text is in
// template-sections.ts. Read by practice.service.ts. Calls nothing.
import type { CheckMark } from '../../models/checklist.model'
import type { CheckResult, CopeDimension, Severity } from '../../models/observation.model'

export const CLIENT_NAME = 'Harbourline Cold Store (practice)'
export const SITE = {
  name: 'Harbourline Cold Store',
  address: '12 Harbourline Way, Singapore 628000',
  jurisdiction: 'SG',
  // One of FACILITY_TYPES (knowledge-document.service.ts).
  facilityType: 'Cold store',
}
export const SITE_CONTACTS = [{ name: 'Daniel Lim', role: 'Operations manager' }]

// What every prepared record says made it, in place of a model's name: never an AI provider.
export const PREPARED = {
  provider: 'practice',
  model: 'prepared-sample-text',
  effort: 'none',
  prompt_version: 'practice-template-v1',
}

// The 3 locations. A walkthrough step tells the user to pick "Block A › Level 1 › Loading bay".
export const LOCATIONS = [
  { ref: 'bay', building: 'Block A', floor: 'Level 1', name: 'Loading bay' },
  { ref: 'freezer', building: 'Block A', floor: 'Level 1', name: 'Freezer chamber' },
  { ref: 'plant', building: 'Block A', floor: 'Level 2', name: 'Plant room' },
]

// The checklist (CP-30): every item answered, by an observation below (`answers`) or by a mark,
// except `alarm`, left open so the Checklist walkthrough has an item to show the answers on.
export const CHECKLIST_AREAS = [
  { id: '6', title: 'Management Programs' },
  { id: '7', title: 'Construction' },
  { id: '8', title: 'Occupancy and Hazards' },
  { id: '9', title: 'Fire Protection' },
  { id: '10', title: 'External Exposures' },
  { id: '11', title: 'Security' },
]
type ChecklistEntry = { ref: string; area: string; text: string; mark?: CheckMark }
export const CHECKLIST: ChecklistEntry[] = [
  { ref: 'hotwork', area: '6', text: 'Hot work permits and fire watch records' },
  { ref: 'panels', area: '7', text: 'Wall and roof panels: core type and fire listing' },
  { ref: 'firewall', area: '7', text: 'Fire wall openings protected by shutters or doors' },
  { ref: 'plant', area: '8', text: 'Refrigeration plant: charge, leak detection, emergency stop' },
  { ref: 'charging', area: '8', text: 'Battery charging area kept clear of combustibles' },
  { ref: 'sprinklers', area: '9', text: 'Sprinkler protection suits the storage height' },
  { ref: 'pump', area: '9', text: 'Fire pump weekly run log', mark: 'not_seen' },
  { ref: 'alarm', area: '9', text: 'Fire alarm panel: faults shown and last service date' },
  { ref: 'neighbours', area: '10', text: 'Neighbouring occupancies within 30 m' },
  { ref: 'flood', area: '10', text: 'Flood history and floor levels', mark: 'not_applicable' },
  { ref: 'guarding', area: '11', text: 'Guarding and CCTV coverage' },
]

// The 8 observations: 7 settled by the engineer, and `hotwork` to check, with the AI's
// suggestion finished and not sure of either value (the one amber row, CP-24).
type ObservationEntry = {
  ref: string
  location: string
  cope: CopeDimension[]
  severity: Severity
  note: string
  answers: { item: string; result: CheckResult }
  toCheck?: true
  // A question for the client, written on the note's last line with the info request code (CP-35).
  ask?: string
}
export const OBSERVATIONS: ObservationEntry[] = [
  {
    ref: 'panels',
    location: 'freezer',
    cope: ['Construction'],
    severity: 'moderate',
    note: 'Walls and roof are insulated metal panels with a 150 mm PIR core, supplier certificate on file. Steel portal frame has no fire protection.',
    answers: { item: 'panels', result: 'confirmed' },
  },
  {
    ref: 'firewall',
    location: 'bay',
    cope: ['Construction'],
    severity: 'high',
    note: 'Two-hour masonry fire wall between the loading bay and the freezer chamber. Fire protection of the wall is breached: the conveyor opening through it has no fire shutter.',
    answers: { item: 'firewall', result: 'differs' },
  },
  {
    ref: 'ammonia',
    location: 'plant',
    cope: ['Occupancy'],
    severity: 'high',
    note: 'Ammonia refrigeration plant with a 900 kg charge. Leak detector fitted, emergency stop outside the door. One compressor serves the whole store.',
    answers: { item: 'plant', result: 'confirmed' },
    ask: 'Last calibration certificate for the ammonia leak detector',
  },
  {
    ref: 'chargers',
    location: 'bay',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Six forklift chargers along the loading bay wall, 2 m from packaging stacked on timber pallets.',
    answers: { item: 'charging', result: 'differs' },
  },
  {
    ref: 'sprinklers',
    location: 'freezer',
    cope: ['Protection'],
    severity: 'high',
    note: 'Fire protection: dry pipe sprinklers at roof level only, over racking to 8 m with no in-rack sprinklers, which is not enough. Fire protection systems are not tested weekly. Control valves locked open.',
    answers: { item: 'sprinklers', result: 'differs' },
  },
  {
    ref: 'security',
    location: 'bay',
    cope: ['Protection'],
    severity: 'low',
    note: 'Guard on site 24 hours. CCTV covers the gate and dock doors, recordings kept for 30 days.',
    answers: { item: 'guarding', result: 'confirmed' },
  },
  {
    ref: 'pallets',
    location: 'bay',
    cope: ['Exposure'],
    severity: 'moderate',
    note: 'Open timber pallet yard 10 m beyond the east fence, seen from the loading bay apron.',
    answers: { item: 'neighbours', result: 'confirmed' },
  },
  {
    ref: 'hotwork',
    location: 'plant',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Hot work permits issued by the maintenance supervisor. No fire watch sign-off on the last two permits. Fire protection: no impairment procedure when sprinklers or the fire alarm are shut off for the work.',
    answers: { item: 'hotwork', result: 'differs' },
    toCheck: true,
  },
]

// The site walk ready to review: one existing location and one new, 3 proposed observations,
// one with a not-sure severity so a red mark shows. `location` is a LOCATIONS ref or 'new'.
export const WALK = {
  name: 'Sample walk',
  typedText: 'Walked the loading bay, then along the north boundary.',
  newLocation: 'North boundary',
  observations: [
    {
      location: 'bay',
      note: 'Two dock levellers have torn weather seals, letting warm air into the loading bay.',
      copeDimension: 'Occupancy' as CopeDimension,
      severity: 'low' as Severity,
      unsure: false,
    },
    {
      location: 'new',
      note: 'The drainage channel along the north boundary is blocked with leaves and silt.',
      copeDimension: 'Exposure' as CopeDimension,
      severity: 'moderate' as Severity,
      unsure: false,
    },
    {
      location: 'bay',
      note: 'The fire extinguisher by dock door 3 is missing from its bracket.',
      copeDimension: 'Protection' as CopeDimension,
      severity: 'moderate' as Severity,
      unsure: true,
    },
  ],
}

// The 3 suggested Opportunities for Improvement (GN-05), each tied to an observation. Values
// come from rag-service generation/ofi.json; the priority is its matrix's for the two ratings.
export const OFIS = [
  {
    observation: 'firewall',
    title: 'Fit a Fire Shutter to the Conveyor Opening',
    category: 'Physical Protection',
    type: 'Construction',
    description:
      'Fit a two-hour fire shutter to the conveyor opening in the fire wall, released by the fire alarm.',
    finding: 'The conveyor opening through the two-hour fire wall has no fire shutter.',
    likelihood: 'Possible',
    consequence: 'Major',
    priority: 'Priority 1',
    effort: 'Moderate Capital',
  },
  {
    observation: 'sprinklers',
    title: 'Add In-Rack Sprinklers in the Freezer Chamber',
    category: 'Physical Protection',
    type: 'Sprinkler Installation',
    description:
      'Add in-rack sprinklers to the 8 m freezer racking, or limit the storage height to suit the roof-level sprinklers.',
    finding: 'Racking to 8 m is protected by roof-level dry pipe sprinklers only.',
    likelihood: 'Likely',
    consequence: 'Major',
    priority: 'Priority 1',
    effort: 'Major Capital',
  },
  {
    observation: 'chargers',
    title: 'Keep the Charging Area Clear of Packaging',
    category: 'Management Programs',
    type: 'Housekeeping',
    description:
      'Keep a 3 m clear zone around the forklift chargers and store packaging away from them.',
    finding: 'Packaging on timber pallets is stacked 2 m from the six forklift chargers.',
    likelihood: 'Possible',
    consequence: 'Moderate',
    priority: 'Priority 2',
    effort: 'Minor Procedural',
  },
]

// Section 4's proposed scores, one per RQR category in risk-quality.service.ts order, as
// figure-proposal.service.ts stores them. `cite` names observations by ref.
export const SCORES = [
  { category: 'External Exposure', current: 7, potential: 8, cite: ['pallets'] },
  { category: 'Fire Protection', current: 5, potential: 9, cite: ['sprinklers'] },
  { category: 'Occupancy Hazards', current: 6, potential: 8, cite: ['ammonia', 'chargers'] },
  { category: 'Construction', current: 6, potential: 8, cite: ['panels', 'firewall'] },
  { category: 'Water Supply', current: 6, potential: 8, cite: [] },
  { category: 'Surveillance', current: 8, potential: 9, cite: ['security'] },
  { category: 'Management Programs', current: 6, potential: 8, cite: ['chargers'] },
]
export const SCORE_REASON = 'Prepared sample figure for practice.'

// Section 5's proposed % damage and outage months per level, as figure-proposal.service.ts
// stores them (items named as loss-estimate.service.ts's blank value rows).
export const LEVELS = [
  { level: 'I', buildings: 2, stock: 5, months: 1, percent: 20, cite: ['chargers'] },
  { level: 'II', buildings: 25, stock: 60, months: 9, percent: 70, cite: ['sprinklers', 'panels'] },
  { level: 'III', buildings: 90, stock: 100, months: 24, percent: 100, cite: ['firewall'] },
]

// The demo seed's fixed content: accounts, clients, sites, and what each assessment holds.
// Read by seed-demo.ts (the flow) and seed-demo-usage.ts. Plain data, no database calls.
// Every date is an offset in days from the day the seed runs, so the Calendar and the
// Report due cells (late / within 7 days / on track) are right whenever it is run.
import type { CopeDimension, Severity } from '../models/observation.model'
import type { IUser } from '../models/user.model'

// ---- Accounts -------------------------------------------------------------

export const SEED_PASSWORD = 'password123'

// Staff IDs match the older `npm run seed`, so a teammate's existing accounts keep their ids.
// `walkthroughsSeen`: Alex and Sana start with the welcome tour done and offers switched off;
// Jide starts fresh, so the first-sign-in welcome and practice assessment can be shown.
export type SeedUser = Pick<
  IUser,
  'staffId' | 'name' | 'email' | 'role' | 'jobTitle' | 'office'
> & {
  walkthroughsSeen: boolean
}
export const USERS: SeedUser[] = [
  {
    staffId: 'MRE-0001',
    name: 'Alex Rowe',
    email: 'alex.rowe@example.com',
    role: 'risk_engineer',
    jobTitle: 'Senior risk engineer · Property',
    office: 'SG',
    walkthroughsSeen: true,
  },
  {
    staffId: 'MRE-0002',
    name: 'Jide Okafor',
    email: 'jide.okafor@example.com',
    role: 'risk_engineer',
    jobTitle: 'Risk engineer · Property',
    office: 'SG',
    walkthroughsSeen: false,
  },
  {
    staffId: 'MRE-0004',
    name: 'Sana Patel',
    email: 'sana.patel@example.com',
    role: 'knowledge_admin',
    jobTitle: 'Consultant · Natural hazards',
    office: 'SG',
    walkthroughsSeen: true,
  },
]

// ---- Clients and sites ----------------------------------------------------

export const CLIENTS = [
  { name: 'Straits Logistics Pte Ltd', division: 'Warehousing' },
  { name: 'Glacier Bay Frozen Foods', division: 'Cold chain' },
  { name: 'Pioneer Specialty Chemicals Pte Ltd', division: 'Manufacturing' },
  { name: 'Marina Central Properties', division: undefined },
]

// `client` is an index into CLIENTS. Coordinates are approximate, set as an engineer would.
export const SITES = [
  {
    code: 'SG-PDC-001',
    client: 0,
    name: 'Pandan Distribution Centre',
    address: '25 Pandan Crescent, Singapore 128477',
    facilityType: 'Distribution warehouse',
    coordinates: { lat: 1.3175, lng: 103.7517 },
  },
  {
    code: 'SG-CAW-001',
    client: 0,
    name: 'Changi Airfreight Warehouse',
    address: '30 Changi South Avenue 2, Singapore 486548',
    facilityType: 'Distribution warehouse',
    coordinates: { lat: 1.3376, lng: 103.9811 },
  },
  {
    code: 'SG-TCS-001',
    client: 1,
    name: 'Tuas Cold Store',
    address: '10 Tuas South Avenue 2, Singapore 637601',
    facilityType: 'Cold store',
    coordinates: { lat: 1.2935, lng: 103.6372 },
  },
  {
    code: 'SG-JIP-001',
    client: 2,
    name: 'Jurong Island Plant',
    address: '8 Jurong Island Highway, Singapore 619459',
    facilityType: 'Chemical plant',
    coordinates: { lat: 1.2652, lng: 103.6997 },
  },
  {
    code: 'SG-TBP-001',
    client: 2,
    name: 'Tuas Blending Plant',
    address: '22 Tuas Bay Drive, Singapore 637614',
    facilityType: 'Chemical plant',
    coordinates: { lat: 1.2986, lng: 103.6291 },
  },
  {
    code: 'SG-MCT-001',
    client: 3,
    name: 'Marina Central Tower',
    address: '12 Marina Central Boulevard, Singapore 018935',
    facilityType: 'Office',
    coordinates: { lat: 1.2801, lng: 103.8543 },
  },
]

// ---- Observations ---------------------------------------------------------

export type Seen = {
  id: string
  // A key of the assessment's `places`.
  at: string
  // null = uncategorised (stored as null, never []): the observation is "to check" (CP-24).
  cope: CopeDimension[] | null
  // null = no severity yet: also "to check".
  severity: Severity | null
  note: string
}
export type Place = { name: string; floor?: string; building?: string }

// Pandan Distribution Centre: on site now (RPT-2026-0004).
export const PANDAN_PLACES: Record<string, Place> = {
  racks: { name: 'Racking aisles 1-6', floor: 'Ground', building: 'Warehouse A' },
  valves: { name: 'Sprinkler valve room', floor: 'Ground', building: 'Warehouse A' },
  dock: { name: 'Dock levellers', floor: 'Ground', building: 'Warehouse A' },
  mezz: { name: 'Mezzanine storage', floor: 'Level 2', building: 'Warehouse A' },
  roof: { name: 'Roof', building: 'Warehouse A' },
  office: { name: 'Open-plan office', floor: 'Level 1', building: 'Office annexe' },
  pump: { name: 'Pump house' },
  yard: { name: 'Yard' },
  access: { name: 'Fire access route' },
}
export const PANDAN_SEEN: Seen[] = [
  {
    id: 'D1',
    at: 'roof',
    cope: ['Construction'],
    severity: 'moderate',
    note: 'Roof is insulated metal sandwich panel with an EPS core; the core is exposed at two cut edges near the east gable.',
  },
  {
    id: 'D2',
    at: 'office',
    cope: ['Construction'],
    severity: 'low',
    note: 'Fire door between the office annexe and the warehouse closes and latches properly.',
  },
  {
    id: 'D3',
    at: 'racks',
    cope: ['Occupancy', 'Protection'],
    severity: 'critical',
    note: 'Aerosol pallets and lithium battery packs are stored in general racking outside the caged area, racked to 10 m.',
  },
  {
    id: 'D4',
    at: 'dock',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Cartons and wrapped pallets are stacked within 1 m of the forklift chargers beside the dock levellers.',
  },
  {
    id: 'D5',
    at: 'valves',
    cope: ['Protection'],
    severity: 'high',
    note: 'Zone control valve for racks 3 to 6 was closed and untagged; there is no impairment procedure on site.',
  },
  {
    id: 'D6',
    at: 'racks',
    cope: ['Protection'],
    severity: 'moderate',
    note: 'Storage in two racks reaches within 300 mm of the sprinkler deflectors.',
  },
  {
    id: 'D7',
    at: 'pump',
    cope: ['Protection'],
    severity: 'low',
    note: 'Diesel fire pump started on demand and the weekly churn test log is up to date.',
  },
  {
    id: 'D8',
    at: 'yard',
    cope: ['Exposure'],
    severity: 'moderate',
    note: 'Timber pallets are stacked against the north boundary fence, about 4 m from the building.',
  },
  // Two to check (CP-24): no category and severity yet, so drafting leaves them out.
  // `--with-ai` adds seed-media/fire-alarm-panel.jpg to it, so the reading job describes the photo
  // and suggests both.
  {
    id: 'D9',
    at: 'office',
    cope: null,
    severity: null,
    note: 'Photo of the fire alarm panel by the office annexe entrance, taken for reference. To be described.',
  },
  {
    id: 'D10',
    at: 'office',
    cope: ['Occupancy'],
    severity: null,
    note: 'Site manager mentioned a mezzanine extension planned for next year.',
  },
]

// Glacier Bay's Tuas Cold Store, current resurvey (RPT-2026-0005) and the previous report (RPT-2026-0001).
// Each of the resurvey's observations gives the Comparison tab a different outcome.
export const KESTREL_PLACES: Record<string, Place> = {
  office: { name: 'Office', floor: 'Ground', building: 'Block A' },
  pump: { name: 'Pump room', floor: 'Basement 1', building: 'Block A' },
  valves: { name: 'Sprinkler valve room', floor: 'Ground', building: 'Block A' },
  yard: { name: 'Yard' },
  plant: { name: 'Plant room', floor: 'Level 1', building: 'Block A' },
  store: { name: 'Cold store', floor: 'Level 1', building: 'Block A' },
  dock: { name: 'Loading bay', floor: 'Ground', building: 'Block A' },
}
export const KESTREL_PREVIOUS_SEEN: Seen[] = [
  {
    id: 'A1',
    at: 'pump',
    cope: ['Protection'],
    severity: 'high',
    note: 'Fire pump churn pressure 7.5 bar at the weekly test. Diesel tank kept full.',
  },
  {
    id: 'A2',
    at: 'valves',
    cope: ['Protection'],
    severity: 'moderate',
    note: 'Sprinkler control valve V-2 chained but not locked.',
  },
  {
    id: 'A3',
    at: 'yard',
    cope: ['Exposure'],
    severity: 'high',
    note: 'Combustible pallets stored within 5 m of the north wall.',
  },
  {
    id: 'A4',
    at: 'plant',
    cope: ['Construction'],
    severity: 'low',
    note: 'Fire door to the plant room was wedged open with an extinguisher.',
  },
  {
    id: 'A5',
    at: 'store',
    cope: ['Construction'],
    severity: 'low',
    note: 'Roller shutter in the fire wall between the cold store and dispatch closes on test.',
  },
  {
    id: 'A6',
    at: 'store',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Cold store holds palletised frozen food in plastic wrap, racked to 9 m.',
  },
  // A7-A13: what Sections 4, 5, 6, 11 and 12 of the previous report cite.
  {
    id: 'A7',
    at: 'office',
    cope: ['Occupancy'],
    severity: 'low',
    note: 'Hot work permits are issued by the facilities manager; the permit file was complete for the last quarter.',
  },
  {
    id: 'A8',
    at: 'plant',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Ammonia refrigeration plant with two screw compressors. Ammonia detectors trip the plant and start the extraction fans; tested quarterly.',
  },
  {
    id: 'A9',
    at: 'office',
    cope: ['Protection'],
    severity: 'low',
    note: 'One guard at the gatehouse around the clock. 24 CCTV cameras recorded for 14 days. Card access to Block A.',
  },
  {
    id: 'A10',
    at: 'plant',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Power from a single 22 kV incomer. One 500 kVA diesel generator backs up the refrigeration plant for about 24 hours.',
  },
  {
    id: 'A11',
    at: 'office',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'No written business continuity plan. Site manager said stock would move to a sister cold store in Jurong if the plant failed.',
  },
  {
    id: 'A12',
    at: 'store',
    cope: ['Construction'],
    severity: 'moderate',
    note: 'Cold store walls and ceiling are insulated sandwich panels with a PIR core.',
  },
  {
    id: 'A13',
    at: 'office',
    cope: ['Protection'],
    severity: 'low',
    note: 'Fire protection systems serviced monthly by a contractor; the annual sprinkler flow test was done in March.',
  },
]
export const KESTREL_CURRENT_SEEN: Seen[] = [
  {
    id: 'B1',
    at: 'pump',
    cope: ['Protection'],
    severity: 'critical',
    note: 'Fire pump churn pressure 6.9 bar at the weekly test; diesel tank half full.',
  },
  {
    id: 'B2',
    at: 'valves',
    cope: ['Protection'],
    severity: 'moderate',
    note: 'Valve V-2 locked open with a padlock.',
  },
  {
    id: 'B3',
    at: 'valves',
    cope: ['Protection'],
    severity: 'high',
    note: 'Valve V-2 found chained again on the afternoon check; padlock missing.',
  },
  {
    id: 'B4',
    at: 'yard',
    cope: ['Exposure'],
    severity: 'low',
    note: 'No combustible storage within 10 m of the building.',
  },
  {
    id: 'B5',
    at: 'plant',
    cope: ['Construction'],
    severity: 'low',
    note: 'Fire door to the plant room closes and latches; no wedge.',
  },
  {
    id: 'B6',
    at: 'store',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Cold store still racked to 9 m with palletised frozen food in plastic wrap.',
  },
  {
    id: 'B7',
    at: 'dock',
    cope: ['Protection'],
    severity: 'high',
    note: 'Hose reel cabinet blocked by stock.',
  },
  {
    id: 'B8',
    at: 'store',
    cope: ['Construction'],
    severity: 'low',
    note: 'A shutter on the east side was not tested on this visit.',
  },
]

// Jurong Island Plant, drafted and in review (RPT-2026-0003).
export const JURONG_PLACES: Record<string, Place> = {
  reactor: { name: 'Reactor hall', floor: 'Ground', building: 'Process block 1' },
  control: { name: 'Control room', floor: 'Level 1', building: 'Process block 1' },
  solvent: { name: 'Solvent store' },
  tanks: { name: 'Tank farm' },
  pumps: { name: 'Fire pump house' },
  jetty: { name: 'Jetty road' },
}
export const JURONG_SEEN: Seen[] = [
  {
    id: 'P1',
    at: 'reactor',
    cope: ['Construction'],
    severity: 'moderate',
    note: 'Process block is a steel frame; sprayed fireproofing covers the columns to 2 m only, and the steel above the reactor deck is unprotected.',
  },
  {
    id: 'P2',
    at: 'control',
    cope: ['Construction'],
    severity: 'low',
    note: 'Control room is a blast-resistant concrete building with 2-hour rated walls; cable entries are sealed.',
  },
  {
    id: 'P3',
    at: 'solvent',
    cope: ['Occupancy'],
    severity: 'high',
    note: 'Flammable solvents in 200 L drums on three levels of racking, with no bunding and the floor drain open to the yard.',
  },
  {
    id: 'P4',
    at: 'reactor',
    cope: ['Occupancy'],
    severity: 'moderate',
    note: 'Hot work permits are in use; two of the week’s permits sighted had no fire watch signature.',
  },
  {
    id: 'P5',
    at: 'tanks',
    cope: ['Protection'],
    severity: 'critical',
    note: 'Foam system for tanks T-3 and T-4 failed its last proportioner test; the repair is still open.',
  },
  {
    id: 'P6',
    at: 'reactor',
    cope: ['Protection'],
    severity: 'high',
    note: 'Deluge valve for the reactor hall is isolated for maintenance with no fire watch posted.',
  },
  {
    id: 'P7',
    at: 'pumps',
    cope: ['Protection'],
    severity: 'low',
    note: 'Two diesel fire pumps of 2,500 L/min each; weekly start tests recorded, last flow test three months ago.',
  },
  {
    id: 'P8',
    at: 'jetty',
    cope: ['Exposure'],
    severity: 'moderate',
    note: 'A neighbouring tank terminal is about 40 m from the tank farm bund; the two sites share no emergency plan.',
  },
  {
    id: 'P9',
    at: 'tanks',
    cope: ['Exposure'],
    severity: 'low',
    note: 'Site is on reclaimed land; flood risk assessed as low and the drainage was inspected.',
  },
]

// ---- Drafted report sections ----------------------------------------------

// The template's parts for Sections 7 to 10, in order: n narrative, f fields, t table
// (Global PRE Report Template v2.0). Findings are placed under a part by its heading.
export const TEMPLATE_VERSION = 'global-pre-v2.0-2026-02'
const parts = (list: string[]) =>
  list.map((p) => ({
    kind: ({ n: 'narrative', f: 'fields', t: 'table' } as const)[p[0] as 'n' | 'f' | 't'],
    heading: p.slice(2),
  }))
export const TEMPLATE: Record<
  string,
  { title: string; cope: CopeDimension; parts: ReturnType<typeof parts> }
> = {
  '7': {
    title: 'Construction',
    cope: 'Construction',
    parts: parts([
      'n:Construction Narrative',
      't:Construction Table',
      'n:Compartmentalization and Fire Divisions',
      'n:Details on Combustible Construction',
    ]),
  },
  '8': {
    title: 'Occupancy, Hazards, and Utilities',
    cope: 'Occupancy',
    parts: parts([
      'f:Occupancy',
      'n:Overview',
      'n:Key Processes',
      'n:Key Machinery',
      'f:Special Hazards',
      'f:Power',
      'n:Back-up Power',
      't:Transformer details',
      'n:Boilers',
      'n:Refrigeration / Chillers / Cooling towers',
      'n:Fuels and energy supplies',
      'n:Process water',
      'n:Compressed air',
      'n:Compressed gases',
      'n:Waste and effluent treatment',
      'n:Other site services',
    ]),
  },
  '9': {
    title: 'Fire Protection',
    cope: 'Protection',
    parts: parts([
      't:Automatic Sprinkler Protection',
      'n:Automatic Sprinkler Protection Comments',
      'n:Special Extinguishing Systems',
      'n:Water Supply Details',
      't:Water Supply Test Results',
      'n:Water Supply Test Comments',
      't:Fire / Booster Pump Details',
      'n:Fire / Booster Pump Comments',
      't:Pump Flow Test Data',
      'n:Pump Flow Test Comments',
      'f:Manual Firefighting Features',
      'n:Other Manual Firefighting Comments',
      'n:Fire Alarm Monitoring',
      'f:Fire Alarm Details',
    ]),
  },
  '10': {
    title: 'External Exposures',
    cope: 'Exposure',
    parts: parts(['t:Location Details', 'f:Boundary Exposures', 'f:Natural Catastrophe Exposures']),
  },
}

// Findings by section, then part heading; each cites observations by their id above.
export type Finding = { text: string; cites: string[] }
export type Findings = Record<string, Record<string, Finding[]>>

export const KESTREL_FINDINGS: Findings = {
  '7': {
    'Construction Narrative': [
      {
        text: 'The cold store walls and ceiling are insulated sandwich panels with a PIR core.',
        cites: ['A12'],
      },
    ],
    'Compartmentalization and Fire Divisions': [
      {
        text: 'The roller shutter in the fire wall between the cold store and dispatch closed fully when tested.',
        cites: ['A5'],
      },
      {
        text: 'The fire door to the plant room was wedged open with a fire extinguisher.',
        cites: ['A4'],
      },
    ],
  },
  '8': {
    Overview: [
      {
        text: 'The cold store holds palletised frozen food in plastic wrap, racked to 9 m.',
        cites: ['A6'],
      },
    ],
    'Back-up Power': [
      {
        text: 'One 500 kVA diesel generator backs up the refrigeration plant for about 24 hours.',
        cites: ['A10'],
      },
    ],
    'Refrigeration / Chillers / Cooling towers': [
      {
        text: 'An ammonia refrigeration plant with two screw compressors serves the cold store; ammonia detectors trip the plant and start the extraction fans.',
        cites: ['A8'],
      },
    ],
  },
  '9': {
    'Automatic Sprinkler Protection Comments': [
      { text: 'Sprinkler control valve V-2 was chained but not locked.', cites: ['A2'] },
    ],
    'Fire / Booster Pump Comments': [
      {
        text: 'The fire pump churn pressure was 7.5 bar at the weekly test, and the diesel tank was kept full.',
        cites: ['A1'],
      },
    ],
  },
  '10': {
    'Boundary Exposures': [
      {
        text: 'North: Combustible pallets were stored within 5 m of the north wall.',
        cites: ['A3'],
      },
    ],
  },
}

export const JURONG_FINDINGS: Findings = {
  '7': {
    'Construction Narrative': [
      {
        text: 'The process block is a steel frame with sprayed fireproofing on the columns to 2 m only; the steel above the reactor deck is unprotected.',
        cites: ['P1'],
      },
      {
        text: 'The control room is a blast-resistant concrete building with 2-hour rated walls, and its cable entries are sealed.',
        cites: ['P2'],
      },
    ],
  },
  '8': {
    Overview: [
      {
        text: 'Flammable solvents are held in 200 L drums on three levels of racking in the solvent store, with no bunding and an open drain to the yard.',
        cites: ['P3'],
      },
    ],
    'Special Hazards': [
      {
        text: 'Hot work permits are used in the reactor hall, but two of the permits sighted had no fire watch signature.',
        cites: ['P4'],
      },
    ],
  },
  '9': {
    'Automatic Sprinkler Protection Comments': [
      {
        text: 'The deluge valve for the reactor hall was isolated for maintenance with no fire watch posted.',
        cites: ['P6'],
      },
    ],
    'Special Extinguishing Systems': [
      {
        text: 'The foam system for tanks T-3 and T-4 failed its last proportioner test, and the repair is still open.',
        cites: ['P5'],
      },
    ],
    'Fire / Booster Pump Comments': [
      {
        text: 'Two diesel fire pumps serve the site and their weekly start tests are recorded; the last flow test was three months ago.',
        cites: ['P7'],
      },
    ],
  },
  '10': {
    'Boundary Exposures': [
      {
        text: 'A neighbouring tank terminal lies about 40 m from the tank farm bund, and the two sites share no emergency plan.',
        cites: ['P8'],
      },
    ],
    'Natural Catastrophe Exposures': [
      {
        text: 'The site is on reclaimed land; flood risk was assessed as low and the drainage was inspected.',
        cites: ['P9'],
      },
    ],
  },
}

// Review decisions on the Jurong Island Plant's drafts: "<section>|<part heading>|<statement>".
// Everything not listed stays pending.
export const JURONG_DECISIONS: {
  at: string
  action: 'accept' | 'edit' | 'reject'
  after?: string
}[] = [
  { at: '7|Construction Narrative|0', action: 'accept' },
  { at: '7|Construction Narrative|1', action: 'accept' },
  {
    at: '8|Overview|0',
    action: 'edit',
    after:
      'Flammable solvents are held in 200 L drums on three levels of racking in the solvent store. There is no bunding, and the floor drain runs open to the yard.',
  },
  { at: '9|Special Extinguishing Systems|0', action: 'accept' },
  { at: '9|Automatic Sprinkler Protection Comments|0', action: 'reject' },
  { at: '10|Boundary Exposures|0', action: 'accept' },
]

// One open comment thread on Section 9 (RV-03): the words it is on, and who said what.
export const JURONG_COMMENT = {
  at: '9|Special Extinguishing Systems|0',
  exact: 'failed its last proportioner test',
  thread: [
    { by: 'MRE-0002', body: 'Can we state when the test was done? The client will ask.' },
    { by: 'MRE-0001', body: 'The test record is dated two weeks ago. I will add the date.' },
  ],
}

// Recommendations (OFIs) of the in-review report: one accepted, one still suggested.
export const JURONG_OFIS = [
  {
    state: 'accepted' as const,
    title: 'Restore the Foam System for Tanks T-3 and T-4',
    category: 'Physical Protection',
    type: 'Fire Protection System',
    description:
      'Repair the foam proportioner, retest it and keep the tank farm protected until it passes.',
    observation: 'The foam system for tanks T-3 and T-4 failed its last proportioner test.',
    likelihood: 'Likely',
    consequence: 'Major',
    effort: 'Minor Capital',
    priority: 'Priority 1',
    cites: ['P5'],
  },
  {
    state: 'suggested' as const,
    title: 'Bund the Solvent Store and Close the Floor Drain',
    category: 'Physical Protection',
    type: 'Spill Control',
    description:
      'Fit a bund around the solvent racking and close the floor drain so a spill cannot reach the yard.',
    observation: 'Flammable solvents were stored without bunding and the floor drain is open.',
    likelihood: 'Possible',
    consequence: 'Major',
    effort: 'Minor Capital',
    priority: 'Priority 1',
    cites: ['P3'],
  },
]

export const KESTREL_OFIS = [
  {
    title: 'Lock Sprinkler Control Valves Open',
    category: 'Physical Protection',
    type: 'Fire Protection System',
    description:
      'Lock every sprinkler control valve in the open position and check the locks weekly.',
    observation: 'Sprinkler control valve V-2 was chained but not locked.',
    likelihood: 'Likely',
    consequence: 'Major',
    effort: 'Minor Procedural',
    priority: 'Priority 1',
    cites: ['A2'],
  },
  {
    title: 'Keep a Clear Zone Around the Building',
    category: 'Management Programs',
    type: 'Housekeeping',
    description: 'Keep combustible storage at least 10 m from the building walls.',
    observation: 'Combustible pallets were stored within 5 m of the north wall.',
    likelihood: 'Possible',
    consequence: 'Moderate',
    effort: 'Minor Procedural',
    priority: 'Priority 2',
    cites: ['A3'],
  },
]

// The rest of Tuas Cold Store's previous report (RPT-2026-0001), so it is complete and exports:
// Sections 4, 5, 6, 11 and 12 with the headings Marina's report uses, its figures for Sections 4
// and 5, and its Executive Summary.
type Part = { heading: string; kind: 'narrative' | 'fields'; statements: Finding[] }
const said = (text: string, ...cites: string[]): Finding => ({ text, cites })
export const KESTREL_REST: Record<string, { title: string; subsections: Part[] }> = {
  '4': {
    title: 'Risk Quality Ratings and Comments',
    subsections: [
      {
        heading: 'Risk Quality Rating Comments',
        kind: 'narrative',
        statements: [
          said(
            'Overall the risk can be considered average for a cold store of its class.',
            'A6',
            'A12',
            'A1',
          ),
        ],
      },
      {
        heading: 'Positive Points',
        kind: 'narrative',
        statements: [
          said(
            'The fire pump churned at 7.5 bar at the weekly test, and the diesel tank was kept full.',
            'A1',
          ),
          said(
            'The roller shutter in the fire wall between the cold store and dispatch closed fully when tested.',
            'A5',
          ),
          said(
            'Ammonia detectors in the plant room trip the refrigeration plant and start the extraction fans, and are tested quarterly.',
            'A8',
          ),
        ],
      },
    ],
  },
  '5': {
    title: 'Loss Estimates',
    subsections: [
      {
        heading: 'Level I Scenario',
        kind: 'narrative',
        statements: [
          said(
            'A fire starts in the plant room from an electrical fault in a compressor motor and is controlled by the sprinklers.',
            'A8',
            'A1',
          ),
        ],
      },
      {
        heading: 'Level I Assumptions',
        kind: 'narrative',
        statements: [
          said(
            'Damage is limited to the plant room; refrigeration is lost while a compressor is replaced, and stock moves to the sister cold store in Jurong.',
            'A8',
            'A11',
          ),
        ],
      },
      {
        heading: 'Level II Scenario',
        kind: 'narrative',
        statements: [
          said(
            'A fire starts in the cold store racking; with sprinkler control valve V-2 shut, it spreads through the plastic-wrapped stock.',
            'A2',
            'A6',
          ),
        ],
      },
      {
        heading: 'Level II Assumptions',
        kind: 'narrative',
        statements: [
          said(
            'The racked stock in the cold store is lost, with smoke damage across the chamber; the roller shutter keeps the fire out of dispatch.',
            'A6',
            'A5',
          ),
        ],
      },
      {
        heading: 'Level III Scenario',
        kind: 'narrative',
        statements: [
          said(
            'With all fire protection impaired, the fire involves the insulated panel walls and ceiling and spreads through the whole cold store block.',
            'A12',
            'A6',
          ),
        ],
      },
      {
        heading: 'Level III Assumptions',
        kind: 'narrative',
        statements: [
          said(
            'Block A and its stock are lost; the pallets stored by the north wall carry the fire into the yard.',
            'A12',
            'A3',
          ),
        ],
      },
    ],
  },
  '6': {
    title: 'Management Programs',
    subsections: [
      {
        heading: 'Management Programs',
        kind: 'fields',
        statements: [
          said(
            'Hot Work: Established. Hot work permits are issued by the facilities manager, and the permit file was complete for the last quarter.',
            'A7',
          ),
          said(
            'Fire Protection System Maintenance & Testing: Established. The systems are serviced monthly by a contractor, and the annual sprinkler flow test was done in March.',
            'A13',
          ),
          said(
            'Fire Protection Impairment Management: Formalized. Sprinkler control valve V-2 was chained but not locked.',
            'A2',
          ),
          said(
            'Housekeeping: Formalized. The fire door to the plant room was wedged open with an extinguisher, and pallets were stored within 5 m of the north wall.',
            'A4',
            'A3',
          ),
          said(
            'Business Continuity Planning: Undeveloped. There is no written business continuity plan.',
            'A11',
          ),
        ],
      },
      {
        heading: 'Management Program Comments',
        kind: 'narrative',
        statements: [
          said(
            'Servicing and testing of the fire protection systems are well established, but valve supervision and housekeeping need tightening.',
            'A13',
            'A2',
            'A4',
          ),
        ],
      },
    ],
  },
  '11': {
    title: 'Security',
    subsections: [
      {
        heading: 'Security Staff / Guards',
        kind: 'fields',
        statements: [said('Guards: One guard at the gatehouse, around the clock.', 'A9')],
      },
      {
        heading: 'CCTV',
        kind: 'narrative',
        statements: [said('24 CCTV cameras are recorded for 14 days.', 'A9')],
      },
      {
        heading: 'Access Monitored',
        kind: 'fields',
        statements: [said('Access: Card access to Block A.', 'A9')],
      },
    ],
  },
  '12': {
    title: 'Business Interruption',
    subsections: [
      {
        heading: 'Utilities, Infrastructure & Services',
        kind: 'fields',
        statements: [
          said(
            'Power: A single 22 kV incomer, with one 500 kVA diesel generator backing up the refrigeration plant for about 24 hours.',
            'A10',
          ),
        ],
      },
      {
        heading: 'Business Continuity / Disaster Recovery Planning',
        kind: 'fields',
        statements: [
          said(
            'Business Continuity Plans available?: No written plan; the site manager said stock would move to a sister cold store in Jurong if the plant failed.',
            'A11',
          ),
        ],
      },
    ],
  },
}

// Section 4's scores and Section 5's inputs (GN-03), as the engineer entered them.
export const KESTREL_FIGURES = {
  riskQuality: [
    { category: 'External Exposure', current: 7.0, potential: 9 },
    { category: 'Fire Protection', current: 7.2, potential: 9.5 },
    { category: 'Occupancy Hazards', current: 7.0, potential: 9 },
    { category: 'Construction', current: 6.8, potential: 8.5 },
    { category: 'Water Supply', current: 8.0, potential: 9 },
    { category: 'Surveillance', current: 8.0, potential: 9 },
    { category: 'Management Programs', current: 7.5, potential: 9 },
  ],
  lossEstimates: {
    currency: 'SGD',
    dateOfValues: '2026-01-01',
    indemnityMonths: 18,
    pd: [
      { key: 'pd-buildings', item: 'Buildings', value: 42_000_000 },
      { key: 'pd-contents', item: 'Contents', value: 28_000_000 },
    ],
    te: [{ key: 'te-bi', item: 'Business Interruption (Gross Profit)', value: 15_000_000 }],
    levels: [
      {
        level: 'I',
        pd: [
          { key: 'pd-buildings', percent: 1 },
          { key: 'pd-contents', percent: 3 },
        ],
        te: [{ key: 'te-bi', months: 1, percent: 5 }],
      },
      {
        level: 'II',
        pd: [
          { key: 'pd-buildings', percent: 15 },
          { key: 'pd-contents', percent: 60 },
        ],
        te: [{ key: 'te-bi', months: 6, percent: 35 }],
      },
      {
        level: 'III',
        pd: [
          { key: 'pd-buildings', percent: 100 },
          { key: 'pd-contents', percent: 100 },
        ],
        te: [{ key: 'te-bi', months: 18, percent: 100 }],
      },
    ],
  },
}

// Tuas Cold Store's previous Executive Summary (Section 2): "S:7" cites Section 7.
export const KESTREL_SUMMARY = [
  {
    text: 'The site is a single-block cold store of insulated panel construction, holding palletised frozen food racked to 9 m.',
    citations: ['S:7', 'S:8'],
  },
  {
    text: 'The main points for attention are sprinkler control valve V-2, found chained but not locked, and combustible pallets stored within 5 m of the north wall.',
    citations: ['S:3', 'S:9', 'S:10'],
  },
  {
    text: 'Fire pump testing and fire protection servicing are well established.',
    citations: ['S:6', 'S:9'],
  },
  {
    text: 'Overall the risk is average for its class.',
    citations: ['S:4'],
  },
]

// Marina Central Tower's Executive Summary (Section 2), written as if drafted: "S:7" cites Section 7.
export const MARINA_SUMMARY = [
  {
    text: 'The location is a 46-storey multi-tenant office tower of reinforced concrete, fully sprinklered and monitored around the clock from the fire command centre.',
    citations: ['S:7', 'S:9'],
  },
  {
    text: 'The main point for attention is a number of sprinkler heads recessed into the ceiling of the B3 service corridor, which obstructs their spray.',
    citations: ['S:3', 'S:9'],
  },
  {
    text: 'The basement plant rooms sit below the flood level of a flood-prone zone, which is the main external exposure.',
    citations: ['S:10'],
  },
  {
    text: 'Overall the risk is above average for its class.',
    citations: ['S:4'],
  },
]

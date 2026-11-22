// F-12: the practice assessment's report text (ADR 0003): Sections 6 to 12 as prepared sample
// text, so Generation's step 1 reads as drafted without AI (Section 3 is the OFIs in
// template.ts). Sections 4, 5 and 2 are left undrafted: they wait on the engineer's input, as
// the walkthroughs say. Read by records.ts. Calls nothing.
import type { CopeDimension } from '../../models/observation.model'

// One finding. `cite` names template observations by ref (saved as `O:<id>`). `unsupported`
// marks the one finding with no evidence, so Review shows an "Unsupported" flag.
type Statement = { text: string; cite: string[]; unsupported?: true }
type Section = {
  id: string
  title: string
  // The section's one category, or 'all' (section.service.ts writeDraft's rule).
  cope: CopeDimension | 'all'
  subsections: { heading: string; statements: Statement[] }[]
  // Findings already accepted, by `<subsection>.<statement>`; the rest wait for a decision.
  accepted: string[]
}

// Titles as rag-service generation/sections.json names them. Section 7 stays undecided, its
// first finding with a citation (the Review walkthrough presses its number, then Accept);
// Section 9 keeps its unsupported finding undecided; the rest are accepted, so Export's
// "Left to finish" list is short.
export const SECTIONS: Section[] = [
  {
    id: '6',
    title: 'Management Programs',
    cope: 'all',
    subsections: [
      {
        heading: 'Housekeeping',
        statements: [
          {
            text: 'Packaging on timber pallets is stacked 2 m from the forklift chargers in the loading bay.',
            cite: ['chargers'],
          },
        ],
      },
      {
        heading: 'Emergency Planning',
        statements: [
          {
            text: 'The ammonia plant has a leak detector and an emergency stop outside the plant room door.',
            cite: ['ammonia'],
          },
        ],
      },
    ],
    accepted: ['0.0', '1.0'],
  },
  {
    id: '7',
    title: 'Construction',
    cope: 'Construction',
    subsections: [
      {
        heading: 'Construction Narrative',
        statements: [
          {
            text: 'The freezer chamber walls and roof are insulated metal panels with a 150 mm PIR core, and the supplier certificate is on file.',
            cite: ['panels'],
          },
          { text: 'The steel portal frame has no fire protection.', cite: ['panels'] },
        ],
      },
      {
        heading: 'Compartmentalization and Fire Divisions',
        statements: [
          {
            text: 'A two-hour masonry fire wall separates the loading bay from the freezer chamber.',
            cite: ['firewall'],
          },
          {
            text: 'The conveyor opening through the fire wall has no fire shutter.',
            cite: ['firewall'],
          },
        ],
      },
    ],
    accepted: [],
  },
  {
    id: '8',
    title: 'Occupancy, Hazards, and Utilities',
    cope: 'Occupancy',
    subsections: [
      {
        heading: 'Overview',
        statements: [
          {
            text: 'The site stores frozen food in Block A, cooled by an ammonia refrigeration plant with a 900 kg charge.',
            cite: ['ammonia'],
          },
        ],
      },
      {
        heading: 'Special Hazards',
        statements: [
          {
            text: 'Six forklift chargers stand along the loading bay wall, 2 m from packaging on timber pallets.',
            cite: ['chargers'],
          },
        ],
      },
      {
        heading: 'Refrigeration / Chillers / Cooling towers',
        statements: [{ text: 'One compressor serves the whole store.', cite: ['ammonia'] }],
      },
    ],
    accepted: ['0.0', '1.0', '2.0'],
  },
  {
    id: '9',
    title: 'Fire Protection',
    cope: 'Protection',
    subsections: [
      {
        heading: 'Automatic Sprinkler Protection Comments',
        statements: [
          {
            text: 'The freezer chamber has dry pipe sprinklers at roof level only, over racking to 8 m with no in-rack sprinklers.',
            cite: ['sprinklers'],
          },
        ],
      },
      {
        heading: 'Fire / Booster Pump Comments',
        statements: [
          {
            text: 'The fire pump is run weekly and its log is up to date.',
            cite: [],
            unsupported: true,
          },
        ],
      },
    ],
    accepted: ['0.0'],
  },
  {
    id: '10',
    title: 'External Exposures',
    cope: 'Exposure',
    subsections: [
      {
        heading: 'Boundary Exposures',
        statements: [
          {
            text: 'An open timber pallet yard lies 10 m beyond the east fence.',
            cite: ['pallets'],
          },
        ],
      },
    ],
    accepted: ['0.0'],
  },
  {
    id: '11',
    title: 'Security',
    cope: 'Protection',
    subsections: [
      {
        heading: 'Security Staff / Guards',
        statements: [{ text: 'A guard is on site 24 hours.', cite: ['security'] }],
      },
      {
        heading: 'CCTV',
        statements: [
          {
            text: 'CCTV covers the gate and the dock doors, and recordings are kept for 30 days.',
            cite: ['security'],
          },
        ],
      },
    ],
    accepted: ['0.0', '1.0'],
  },
  {
    id: '12',
    title: 'Business Interruption',
    cope: 'all',
    subsections: [
      {
        heading: 'Utilities, Infrastructure & Services',
        statements: [
          {
            text: 'A single compressor serves the whole store, so its loss would stop refrigeration throughout.',
            cite: ['ammonia'],
          },
        ],
      },
      {
        heading: 'Site',
        statements: [
          {
            text: 'A fire in the pallet yard beyond the east fence could reach the loading bay and stop dispatch.',
            cite: ['pallets'],
          },
        ],
      },
    ],
    accepted: ['0.0', '1.0'],
  },
]

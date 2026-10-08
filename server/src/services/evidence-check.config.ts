// What the structure checks (EV-01 AC3, AC4) treat as required. Used by
// evidence-check.service.ts. The lists come from reading 11 Marsh sample
// reports: .local-docs/analysis/marsh-headings.md (kept locally; summary in
// docs/DECISIONS.md, 2026-10-08).

// How serious a missing section is. Section 12 only warns: 2 of the 11 samples
// have no Business Interruption section.
export const REQUIRED_SECTIONS: Record<string, 'fail' | 'warn'> = {
  '7': 'fail',
  '8': 'fail',
  '9': 'fail',
  '10': 'fail',
  '11': 'fail',
  '12': 'warn',
}

// Headings found in at least 90% of the samples. A draft missing one fails;
// missing any other template heading only warns.
export const COMPULSORY_HEADINGS: Record<string, string[]> = {
  '7': ['Construction Narrative', 'Compartmentalization and Fire Divisions'],
  '8': [
    'Occupancy',
    'Key Processes',
    'Special Hazards',
    'Power',
    'Back-up Power',
    'Transformer details',
    'Fuels and energy supplies',
  ],
  '9': [
    'Automatic Sprinkler Protection',
    'Special Extinguishing Systems',
    'Water Supply Details',
    'Pump Flow Test Data',
    'Manual Firefighting Features',
    'Other Manual Firefighting Comments',
    'Fire Alarm Monitoring',
  ],
  '10': ['Location Details', 'Boundary Exposures', 'Natural Catastrophe Exposures'],
  '11': [
    'Site Perimeter',
    'Building Physical Features',
    'Security Staff / Guards',
    'CCTV',
    'Intruder Detection',
    'Access Monitored',
    'Other Security Programs / Controls',
  ],
  '12': ['Business Continuity / Disaster Recovery Planning'],
}

// Wording real Marsh reports use for a template heading, so it is not flagged.
export const HEADING_ALIASES: Record<string, string> = {
  'key features / processes': 'key processes',
  'chillers / cooling towers': 'refrigeration / chillers / cooling towers',
  'manual fire fighting features': 'manual firefighting features',
  'other manual firefighting appurtenances / comments': 'other manual firefighting comments',
  'fire pump details': 'fire / booster pump details',
}

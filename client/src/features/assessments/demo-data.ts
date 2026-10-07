import type { SiteLocation } from './api'
import { NO_FILTERS } from './observationFilters'
import type { AssessmentRow, WorkflowState } from './types'

// The assessment the capture screen opens. The server seed (`npm run seed`)
// creates the same reference, so live and demo views name the same site.
export const CAPTURE_ASSESSMENT = {
  reference: 'RPT-2026-0411',
  site: 'Tilbury Distribution Centre',
}

// Stored as two-letter codes; retrieval (RT-01) filters on them.
export const JURISDICTIONS = [
  { value: 'SG', label: 'Singapore' },
  { value: 'MY', label: 'Malaysia' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'TH', label: 'Thailand' },
  { value: 'PH', label: 'Philippines' },
  { value: 'VN', label: 'Vietnam' },
  { value: 'HK', label: 'Hong Kong' },
  { value: 'UK', label: 'United Kingdom' },
]

// The gateway checks knowledge documents against a copy of this list: keep
// FACILITY_TYPES in server/src/services/knowledge-document.service.ts matching.
export const FACILITY_TYPES = [
  'Distribution warehouse',
  'Cold store',
  'Chemical plant',
  'Paper mill',
  'Port terminal',
  'Data centre',
  // The site types of the sample reports Marsh provided.
  'Office',
  'Shopping mall',
  'Mixed-use development',
]

export const initialState: WorkflowState = {
  screen: 'dashboard',
  tab: 'overview',
  toast: null,
  toastTone: 'success',
  q: '',
  fStatus: 'All statuses',
  workSort: 'Latest site visit',
  createdRows: [],
  cf: {
    site: '',
    client: '',
    addr: '',
    ref: '',
    type: 'Distribution warehouse',
    survey: 'Property risk survey',
    date: '2026-04-21',
    due: '2026-05-02',
    stds: ['FM Global 2-0', 'NFPA 13'],
    eng: '',
    jurisdiction: 'SG',
  },
  cfEdit: null,
  cfErr: false,
  cfBusy: false,
  cfServerError: null,
  captureTarget: CAPTURE_ASSESSMENT,
  captureObs: {},
  fMode: 'note',
  fNote: '',
  fNoteListed: false,
  fSaving: false,
  fSaveError: null,
  fRec: false,
  fSecs: 0,
  fTrans: false,
  fTransBusy: false,
  fVoiceError: null,
  fClips: [],
  fPhotos: [],
  fPhotoError: null,
  fLocationId: null,
  locOpen: false,
  locQuery: '',
  locAdding: false,
  lf: { name: '', floor: '' },
  lfBusy: false,
  lfError: null,
  locRemove: null,
  fCat: 'Protection',
  fSev: 'high',
  fStd: '',
  fToast: null,
  fRecent: [
    {
      icon: 'camera',
      color: '#4f9aee',
      cat: 'Protection',
      time: '11 Apr 2026 09:22',
      text: 'Pallet racking installed against north wall since last visit. Two ESFR heads obstructed.',
      area: 'Bay 3 — north aisle',
      locationId: 'demo-bay-3',
      floor: 'Ground',
      sev: 'critical',
      std: 'FM Global 2-0 §2.4.1',
      media: [
        { name: 'IMG_0442.jpg', url: null },
        { name: 'IMG_0443.jpg', url: null },
      ],
      detail:
        'Racking installed against the north wall since the 2023 survey has completely obstructed the spray pattern for heads SH-04 and SH-05. Minimum clearance of 457 mm is not maintained. Rerouting or relocation of drops is required to meet the design density recorded in 2023.',
    },
    {
      icon: 'mic',
      color: '#8f7dff',
      cat: 'Protection',
      time: '11 Apr 2026 11:05',
      text: 'Pump test certificate not produced on request. Site engineer believes it is held by the contractor.',
      area: 'Pump house',
      locationId: 'demo-pump-house',
      floor: null,
      sev: 'high',
      std: 'NFPA 25 §8.3.3',
      audio: '0:45',
      media: [],
      detail:
        'The 2023 annual pump test certificate could not be located during the visit. The site engineer believes the contractor holds it. Until it is produced, the single tank and pump arrangement is recorded as unverified against the design duty.',
    },
    {
      icon: 'sticky-note',
      color: '#f9ac10',
      cat: 'Occupancy',
      time: '11 Apr 2026 13:40',
      text: 'Sortation line controller is a single point of failure. Client quotes 14 weeks to replace.',
      area: 'Bay 1 — despatch',
      locationId: 'demo-bay-1',
      floor: 'Ground',
      sev: 'moderate',
      std: '',
      media: [],
      detail:
        'The primary conveyor controller has no contracted standby unit and no alternative routing for outbound dispatch. The client quotes a 14-week replacement lead time, revised upward from the 8 weeks recorded in the 2023 report.',
    },
  ],
  gsecs: [
    {
      id: 's1',
      n: '1.0',
      title: 'Site overview',
      st: 'done',
      ev: 5,
      conf: 'high',
    },
    {
      id: 's2',
      n: '2.0',
      title: 'Construction and occupancy',
      st: 'done',
      ev: 7,
      conf: 'high',
    },
    {
      id: 's3g',
      n: '3.0',
      title: 'Fire protection',
      st: 'done',
      ev: 3,
      conf: 'high',
    },
    {
      id: 's3',
      n: '3.2',
      title: 'Sprinkler protection',
      st: 'processing',
      p: 34,
      ev: 4,
      conf: 'high',
    },
    {
      id: 's4',
      n: '3.3',
      title: 'Water supplies',
      st: 'insufficient',
      ev: 2,
      conf: 'low',
    },
    {
      id: 's5',
      n: '4.0',
      title: 'Business interruption exposure',
      st: 'failed',
      ev: 6,
      conf: 'medium',
    },
    {
      id: 's6',
      n: '5.0',
      title: 'Recommendations',
      st: 'queued',
      ev: 3,
      conf: 'medium',
    },
  ],
  running: true,
  stopOpen: false,
  sel: 's3',
  secSt: {
    s1: 'accepted',
    s2: 'edited',
    s3g: 'accepted',
    s3: 'draft',
    s4: 'draft',
    s5: 'draft',
    s6: 'draft',
  },
  bodyOv: {},
  editing: false,
  draft: '',
  rejected: {},
  u1: null,
  u2: null,
  u3: null,
  activeCite: null,
  fmt: 'DOCX',
  optCite: true,
  optPhotos: true,
  optIdx: false,
  exportOpen: false,
  obsOpen: null,
  of: NO_FILTERS,
  obsShowDeleted: false,
  obsDialog: null,
  tagEdit: null,
  tagBusy: false,
  archiveOpen: false,
  archiveBusy: false,
  tagError: null,
}

export const ROWS: AssessmentRow[] = [
  {
    id: 'RPT-2026-0411',
    site: 'Tilbury Distribution Centre',
    client: 'Northgate Logistics',
    type: 'Property risk survey',
    date: '11 Apr 2026',
    siteVisitDate: '2026-04-11',
    eng: 'A. Rowe',
    status: 'Draft',
    sev: 'high',
    live: true,
  },
  {
    id: 'RPT-2026-0408',
    site: 'Leeds Cold Store',
    client: 'Fennick Foods',
    type: 'Follow-up visit',
    date: '08 Apr 2026',
    siteVisitDate: '2026-04-08',
    eng: 'A. Rowe',
    status: 'Under review',
    sev: 'critical',
    open: 1,
  },
  {
    id: 'RPT-2026-0402',
    site: 'Rotterdam Plant 2',
    client: 'Vanderlin Chemicals',
    type: 'Property risk survey',
    date: '02 Apr 2026',
    siteVisitDate: '2026-04-02',
    eng: 'A. Rowe',
    status: 'Draft',
    sev: 'moderate',
    open: 0,
  },
  {
    id: 'RPT-2026-0331',
    site: 'Bilbao Terminal',
    client: 'Iberport',
    type: 'Business interruption',
    date: '27 Mar 2026',
    siteVisitDate: '2026-03-27',
    eng: 'M. Haas',
    status: 'Draft',
    sev: 'low',
    open: 0,
  },
  {
    id: 'RPT-2026-0327',
    site: 'Dublin Warehouse 4',
    client: 'Northgate Logistics',
    type: 'Property risk survey',
    date: '20 Mar 2026',
    siteVisitDate: '2026-03-20',
    eng: 'J. Okafor',
    status: 'Finalised',
    sev: 'moderate',
    open: 0,
  },
  {
    id: 'RPT-2026-0319',
    site: 'Avonmouth Paper Mill',
    client: 'Severn Paper Group',
    type: 'Property risk survey',
    date: '19 Mar 2026',
    siteVisitDate: '2026-03-19',
    eng: 'A. Rowe',
    status: 'Capturing',
    sev: 'high',
    open: 2,
  },
]

// The COPE categories an observation is filed under, by the value each is
// stored as: the same values the knowledge base tags its chunks with.
export const CAT_ICON: Record<string, string> = {
  Construction: 'hard-hat',
  Occupancy: 'factory',
  Protection: 'flame',
  Exposure: 'cloud-lightning',
}
// The sample assessment's places on site, used when the gateway is not live.
export const DEMO_LOCATIONS: SiteLocation[] = [
  { id: 'demo-bay-3', name: 'Bay 3 — north aisle', floor: 'Ground' },
  { id: 'demo-bay-1', name: 'Bay 1 — despatch', floor: 'Ground' },
  { id: 'demo-pump-house', name: 'Pump house', floor: null },
  { id: 'demo-office', name: 'Office annexe', floor: 'Level 1' },
  { id: 'demo-yard', name: 'External yard', floor: null },
  { id: 'demo-valve-room', name: 'Sprinkler valve room', floor: 'Ground' },
]
// An observation may be saved before it is categorised (CP-02) and categorised
// later by editing its tags (CP-06); report drafting leaves it out until then.
export const UNCATEGORISED = 'Uncategorised'
// Standards an observation can be tied to. The draft finds the clause itself.
export const STANDARD_REFERENCES = [
  'NFPA 25 – 2026 Edition',
  'NFPA 13 – 2022 Edition',
  'FM 2.0 – Last published April 2026',
  'FM 2.81 – Last published April 2026',
]

export const SEV: Record<string, { icon: string; color: string }> = {
  critical: {
    icon: 'octagon-alert',
    color: 'var(--status-critical-fg)',
  },
  high: {
    icon: 'shield-alert',
    color: 'var(--status-high-fg)',
  },
  moderate: {
    icon: 'triangle-alert',
    color: 'var(--status-moderate-fg)',
  },
  low: {
    icon: 'info',
    color: 'var(--status-low-fg)',
  },
}

export const STANDARDS = [
  {
    name: 'FM Global 2-0',
    desc: 'Installation of sprinkler systems',
  },
  {
    name: 'NFPA 13',
    desc: 'Standard for the installation of sprinkler systems',
  },
  {
    name: 'NFPA 22',
    desc: 'Water tanks for private fire protection',
  },
  {
    name: 'FM Global 5-4',
    desc: 'Transformers and electrical equipment',
  },
  {
    name: 'ABI/BRE nat-haz guidance',
    desc: 'Flood and windstorm exposure',
  },
  {
    name: 'Client standard NL-04',
    desc: 'Northgate Logistics internal fire strategy',
  },
]

export const TITLES: Record<string, string> = {
  s1: '1.0 Site overview',
  s2: '2.0 Construction and occupancy',
  s3g: '3.0 Fire protection',
  s3: '3.2 Sprinkler protection',
  s4: '3.3 Water supplies',
  s5: '4.0 Business interruption exposure',
  s6: '5.0 Recommendations',
}

export const PLAIN: Record<string, string> = {
  s1: 'The site comprises a single-storey distribution warehouse of 41,200 m² built in 2004, with a two-storey office annexe on the south elevation. Operations run three shifts, six days per week, with an average stock value of £18.4m held on site.',
  s2: "Construction is steel portal frame with insulated composite panel cladding. Core samples recorded in the 2023 survey identify the panel core as mineral wool, consistent with the client's fire strategy documentation. Commodity classification is Class III to Class IV, stored in single-row racking to 8.2 m.",
  s3g: 'Fire protection comprises automatic sprinkler coverage throughout the warehouse, supported by a single tank and pump arrangement. Detection is addressable smoke throughout the office annexe, monitored off site by a third-party receiving centre.',
  s3: 'Bay 3 is protected by an ESFR system installed in 2019. Observed head spacing is consistent with the design density of 12 mm/min recorded in the 2023 survey, though pallet racking added since the last visit obstructs two heads in the north aisle. FM Global 2-0 §2.4.1 requires that storage not obstruct the discharge pattern of any sprinkler.',
  s4: 'Water supply is drawn from a single 900 m³ tank served by one electric pump. No duplicate supply was evidenced during the visit, and the 2023 pump test certificate could not be located. NFPA 22 §4.2 requires tanks to be arranged so that any one can be removed from service without loss of protection.',
  s5: 'Loss of the automated sortation line would halt outbound dispatch across the whole site. Replacement lead time for the primary conveyor controller is 14 weeks, with no contracted alternative site. Estimated business interruption exposure is £1.4m per month of outage.',
  s6: 'Reposition racking in the north aisle of Bay 3 to restore clear discharge below all ESFR heads. Commission an annual pump test with certification retained on site. Establish a contracted standby arrangement for the sortation line controller.',
}

export const EVIDENCE: Record<
  string,
  { index: number; kind: string; source: string; locator: string; excerpt?: string }[]
> = {
  s1: [
    {
      index: 1,
      kind: 'report',
      source: 'Tilbury survey 2023',
      locator: 'p. 4',
      excerpt: 'Single-storey distribution warehouse, 41,200 m², constructed 2004.',
    },
    {
      index: 2,
      kind: 'note',
      source: 'Engineer note',
      locator: '11 Apr 08:55',
      excerpt: 'Three shifts, six days. Average stock value given as £18.4m by site manager.',
    },
  ],
  s2: [
    {
      index: 1,
      kind: 'report',
      source: 'Tilbury survey 2023',
      locator: 'p. 11',
      excerpt: 'Panel core confirmed mineral wool by core sample.',
    },
    {
      index: 2,
      kind: 'report',
      source: 'Client fire strategy',
      locator: 'rev. 6, §3',
      excerpt: 'Cladding specified as non-combustible core throughout.',
    },
    {
      index: 3,
      kind: 'observation',
      source: 'Site note — racking',
      locator: '11 Apr 10:14',
      excerpt: 'Single-row racking measured to 8.2 m in Bays 1-4.',
    },
  ],
  s3g: [
    {
      index: 1,
      kind: 'report',
      source: 'Tilbury survey 2023',
      locator: 'p. 16',
      excerpt: 'Sprinkler coverage throughout; one tank, one pump.',
    },
    {
      index: 2,
      kind: 'note',
      source: 'Engineer note',
      locator: '11 Apr 09:05',
      excerpt: 'Addressable smoke detection in annexe, monitored off site.',
    },
  ],
  s3: [
    {
      index: 1,
      kind: 'standard',
      source: 'FM Global 2-0',
      locator: '§2.4.1',
      excerpt: 'Storage shall not obstruct the discharge pattern of any sprinkler.',
    },
    {
      index: 2,
      kind: 'observation',
      source: 'Site note — Bay 3',
      locator: '11 Apr 09:22',
      excerpt: 'Pallet racking installed against north wall since last visit.',
    },
    {
      index: 3,
      kind: 'report',
      source: 'Tilbury survey 2023',
      locator: 'p. 18',
      excerpt: 'ESFR system commissioned 2019, design density 12 mm/min.',
    },
    {
      index: 4,
      kind: 'photo',
      source: 'IMG_0442.jpg',
      locator: 'Bay 3, north aisle',
    },
    {
      index: 5,
      kind: 'insight',
      source: 'Cross-report pattern',
      locator: '3 sites in portfolio',
      excerpt: 'Racking encroachment recurs at two other Northgate sites surveyed this year.',
    },
  ],
  s4: [
    {
      index: 1,
      kind: 'standard',
      source: 'NFPA 22',
      locator: '§4.2',
      excerpt: 'Tanks shall be arranged so that any one can be removed from service.',
    },
    {
      index: 2,
      kind: 'note',
      source: 'Engineer note',
      locator: '11 Apr 11:05',
      excerpt: 'Pump test certificate not produced on request.',
    },
  ],
  s5: [
    {
      index: 1,
      kind: 'note',
      source: 'Client interview — operations manager',
      locator: '11 Apr 13:40',
      excerpt: 'Controller replacement quoted at 14 weeks. No standby unit held.',
    },
    {
      index: 2,
      kind: 'report',
      source: 'Tilbury survey 2023',
      locator: 'p. 27',
      excerpt: 'Controller lead time recorded as 8 weeks at the time of survey.',
    },
  ],
  s6: [
    {
      index: 1,
      kind: 'standard',
      source: 'FM Global 2-0',
      locator: '§2.4.1',
      excerpt: 'Storage shall not obstruct the discharge pattern of any sprinkler.',
    },
    {
      index: 2,
      kind: 'standard',
      source: 'NFPA 25',
      locator: '§8.3',
      excerpt: 'Annual pump test required, with records retained.',
    },
    {
      index: 3,
      kind: 'note',
      source: 'Engineer note',
      locator: '11 Apr 13:40',
      excerpt: 'No contracted standby arrangement for the sortation controller.',
    },
  ],
}

export const OBS: Record<
  string,
  {
    isPhoto: boolean
    file?: string
    icon: string
    kindLabel: string
    time: string
    text: string
    area: string
  }[]
> = {
  s3: [
    {
      isPhoto: true,
      file: 'IMG_0442.jpg',
      icon: 'camera',
      kindLabel: 'Photograph',
      time: '09:22',
      text: 'Pallet racking installed against north wall since last visit. Two ESFR heads obstructed.',
      area: 'Bay 3 — north aisle',
    },
    {
      isPhoto: false,
      icon: 'mic',
      kindLabel: 'Voice note, 00:47',
      time: '09:24',
      text: 'Head spacing looks unchanged from the 2023 layout, but the racking is new and sits directly under two heads.',
      area: 'Bay 3 — north aisle',
    },
  ],
  s4: [
    {
      isPhoto: true,
      file: 'IMG_0458.jpg',
      icon: 'camera',
      kindLabel: 'Photograph',
      time: '11:02',
      text: 'Single electric pump, no duplicate supply visible in the pump house.',
      area: 'Pump house',
    },
    {
      isPhoto: false,
      icon: 'mic',
      kindLabel: 'Voice note, 00:31',
      time: '11:05',
      text: 'Pump test certificate not produced on request. Site engineer believes the contractor holds it.',
      area: 'Pump house',
    },
  ],
  s5: [
    {
      isPhoto: false,
      icon: 'sticky-note',
      kindLabel: 'Engineer note',
      time: '13:40',
      text: 'Sortation line controller is a single point of failure. Client quotes 14 weeks to replace.',
      area: 'Despatch hall',
    },
  ],
  s1: [
    {
      isPhoto: false,
      icon: 'sticky-note',
      kindLabel: 'Engineer note',
      time: '08:55',
      text: 'Three shifts, six days per week. Stock value given as £18.4m by the site manager.',
      area: 'Site office',
    },
  ],
  s2: [
    {
      isPhoto: true,
      file: 'IMG_0411.jpg',
      icon: 'camera',
      kindLabel: 'Photograph',
      time: '10:14',
      text: 'Single-row racking, measured to 8.2 m in Bay 2.',
      area: 'Bay 2',
    },
  ],
  s3g: [
    {
      isPhoto: false,
      icon: 'sticky-note',
      kindLabel: 'Engineer note',
      time: '09:05',
      text: 'Addressable smoke detection throughout the annexe, monitored off site.',
      area: 'Office annexe',
    },
  ],
  s6: [
    {
      isPhoto: false,
      icon: 'sticky-note',
      kindLabel: 'Engineer note',
      time: '13:40',
      text: 'No contracted standby arrangement for the sortation controller.',
      area: 'Despatch hall',
    },
  ],
}

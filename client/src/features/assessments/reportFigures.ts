// Sections 4 and 5's fixed wording and figure formatting (GN-03), from Marsh's
// Global PRE Report Template v2.0 (pp. 10-17). Used by RiskQualityFigures.tsx
// and LossEstimateFigures.tsx.
import type { LossLevel } from './api'

export const LOSS_OPENING = [
  'The Loss Estimates presented here are believed to be reasonable, based on industry experience, events postulated, and information provided by the client. The calculation of Loss Expectancies is based on the review of building construction, operations, fire protection systems, and fire protection features at the time of our assessment. The estimates are further based on conditions observed at the time of the visit. By their nature, these estimates contain some element of subjectivity. Accordingly, the estimates cannot be taken as absolutes and could be exceeded due to changes in physical conditions on site, or the initiating event or escalation being more severe than anticipated within the boundaries of the estimate.',
  'All damage and loss potential figures presented pertain exclusively to primary property damage, associated contents damage, and associated business interruption recovery time loss, caused directly by (fire or explosion) as defined in our Loss Estimate.',
]
export const VALUES_NOTE =
  'These values are provided by the client unless otherwise specified. Unless stated differently the PD values are assumed to be Replacement Cost Values (RCV), and the financial numbers are deemed to be for a fiscal year.'

// Levels I-III (Level IV is left out; Miya, 14 Oct): each level's page title,
// its definition line, and the Loss Estimate Definitions table's text (p. 13).
export const LOSS_LEVELS: {
  level: LossLevel
  name: string
  definition: string
  details: { intro: string; points: string[]; outro?: string }
}[] = [
  {
    level: 'I',
    name: 'Normal Loss Expectancy',
    definition: 'Primary Protection Systems are functioning and manual firefighting available',
    details: {
      intro:
        'A loss event in which damage is based on the nature of hazards and construction factors, and where:',
      points: [
        'All fire protection systems are in service and functioning as designed.',
        'Full facility Industrial Fire Brigade (Or Plant Emergency Organization) and Municipal Fire Department response expected.',
        'Credit is given to all properly maintained fire barriers up to their design duration rating',
        'Construction features function as designed.',
      ],
    },
  },
  {
    level: 'II',
    name: 'Probable Maximum Loss',
    definition: 'Primary Protection System is not functioning, Manual firefighting available',
    details: {
      intro: 'A level II Loss Event is one which occurs when:',
      points: [
        'The fire protection system protection the area with the largest PD / BI potential is impaired or is rendered inoperative or ineffective due to the nature of the event. Adjacent fire protection systems are presumed operational unless rendered inoperative or ineffective due to structural failure. Same applies for the use of special extinguishing systems.',
        'Credit can be given for adequate manual emergency response, defined as: a responding organization that is trained to address the hazards of the facility being evaluated; can arrive on site within a reasonable time of being notified to be effective in reducing or limiting impact; has up to date preplans or emergency response plans for the facility.',
        'Credit given to minimum adequately maintained (including fire doors and fire penetrations) 3 hour rated walls where the combustible loading is light to ordinary, structural failure is not expected, and roof assembly is a listed or approved noncombustible.',
        'Combustible roof construction (including combustible or unknown metal deck assemblies) results in a contiguous structure loss.',
      ],
      outro:
        'Damage may be limited to the area where the impaired protection system is located and the nearby surroundings or may extend to the nearest adequate separation or properly designed and approved construction cutoffs, depending on site conditions.',
    },
  },
  {
    level: 'III',
    name: 'Maximum Foreseeable Loss',
    definition: 'Fire Protection Systems are not functioning and no manual firefighting response',
    details: {
      intro: 'A level III Loss Event is one which occurs when:',
      points: [
        'All fire protection systems throughout the entire site or facility are impaired.',
        'No credit is given for manual emergency response.',
        'Damage is limited only by adequate separation and/or free-standing 4-hours rated firewalls or equivalent. (Equivalencies must be well defined and proven.)',
        'Combustible roof construction (including combustible or unknown metal deck assemblies) results in a contiguous structure loss.',
      ],
      outro:
        'The size of this loss can approach the value of the buildings of origin or an entire facility, depending on site layout.',
    },
  },
]

export const NOT_ENTERED = 'Not entered'

// An amount in the entered currency's units, with thousands separators; no
// conversion (figures stay as the client gave them).
export const formatAmount = (n: number | null) =>
  n === null ? NOT_ENTERED : new Intl.NumberFormat('en-SG', { maximumFractionDigits: 2 }).format(n)

// An input's text as a figure: empty is "not entered" (null), never 0.
export const toFigure = (text: string) => (text.trim() === '' ? null : Number(text))
export const toText = (n: number | null) => (n === null ? '' : String(n))

// Section 3's Risk Assessment Matrix (GN-12 AC6), as Marsh's template shows it (Shopping
// Mall Sample 2, p. 4): its two lead-in paragraphs, verbatim, and each cell's priority.
// Must match `ram`, `likelihood` and `consequence` in rag-service
// app/generation/ofi.json, which set each drafted OFI's priority.
export const RAM_LEAD_IN = [
  'Opportunities for Improvement (OFI) are suggested to mitigate risks. They are intended to create value and manage risk exposures while maintaining relevance to your business objectives. The Opportunities for Improvement addresses either specifically identified Risks to Manage℠ or they are suggested as general sound risk management to implement at the location.',
  'Prioritization of OFI’s are classified in line with the following indicative Risk Assessment Matrix (RAM). The relative risk associated with each OFI is measures the estimated consequences of the damage versus the likelihood of occurrence.',
]
export const RAM_CONSEQUENCES = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic']
// Each likelihood's priorities, Insignificant to Catastrophic (1 is the most urgent).
export const RAM: { likelihood: string; priorities: number[] }[] = [
  { likelihood: 'Almost Certain', priorities: [2, 2, 1, 1, 1] },
  { likelihood: 'Likely', priorities: [3, 2, 2, 1, 1] },
  { likelihood: 'Possible', priorities: [4, 3, 2, 1, 1] },
  { likelihood: 'Unlikely', priorities: [4, 4, 3, 2, 1] },
  { likelihood: 'Very Rare', priorities: [4, 4, 3, 2, 2] },
]

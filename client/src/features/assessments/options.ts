// The fixed lists the assessment, client and knowledge forms offer, and each
// severity's icon and colour. Shared by the workflow, New Assessment, Clients,
// Knowledge base and accounts screens.

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

// The visit types offered when creating an assessment and in Edit details
// (CP-23); must match VISIT_TYPES in new-assessment/form.ts and the gateway's list.
export const SURVEY_TYPES = ['First survey', 'Resurvey', 'Follow-up visit']

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

// Each severity's icon and colour on the work list.
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

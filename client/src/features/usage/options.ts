// The period and split choices both usage tabs offer (EV-04).
import type { Range, UsageView } from './api'

export const RANGES: { value: Range; label: string }[] = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
]

export const SPLITS: { value: UsageView; label: string }[] = [
  { value: 'service', label: 'Billed service' },
  { value: 'feature', label: 'Feature' },
]

// The period a tab opens on: recent enough to act on, long enough to compare.
export const DEFAULT_RANGE: Range = '30d'

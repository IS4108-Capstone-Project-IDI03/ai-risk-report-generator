// Each document status's word, icon and colour: the status pill (components/DocumentStatus.tsx)
// and the Status filter's options (components/DocumentToolbar.tsx) wear the same ones.
import { IconRegistry } from '../../design-system'
import type { Tone } from './components/TonePill'

export type DocumentStatusKind = 'active' | 'needs_review' | 'withdrawn'

export const STATUS_LOOK: Record<
  DocumentStatusKind,
  { label: string; icon: string; tone: Tone; fg: string }
> = {
  active: { label: 'Active', icon: 'circle-check', tone: 'green', fg: 'var(--green-600)' },
  needs_review: {
    label: 'Needs review',
    icon: IconRegistry.status.flagged.icon,
    tone: 'amber',
    fg: 'var(--amber-600)',
  },
  withdrawn: {
    label: 'Withdrawn',
    icon: IconRegistry.action.withdraw,
    tone: 'red',
    fg: 'var(--red-600)',
  },
}

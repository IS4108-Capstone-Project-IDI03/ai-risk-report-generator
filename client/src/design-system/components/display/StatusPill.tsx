// Status pill (CP-23, board 01): icon + word for an assessment's status.
// Called by the Assessments, Clients and client-page tables. Calls Icon.
import { Icon } from '../core/Icon'

export type StatusPillProps = {
  // A status key (`under_review`) or its label ("Under review"), any case.
  status: string
}

// Colours per status; fg/bg are design-system tokens (v2 section 6).
const STATUSES: Record<
  string,
  { label: string; icon: string; fg: string; bg: string; bd?: string }
> = {
  not_started: {
    label: 'Not started',
    icon: 'circle-dashed',
    fg: 'var(--graphite-700)',
    bg: 'var(--graphite-100)',
  },
  capturing: { label: 'Capturing', icon: 'mic', fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  ready_to_generate: {
    label: 'Ready to generate',
    icon: 'zap',
    fg: 'var(--teal-600)',
    bg: 'var(--teal-50)',
  },
  draft: { label: 'Draft', icon: 'sparkles', fg: 'var(--violet-600)', bg: 'var(--violet-50)' },
  under_review: {
    label: 'Under review',
    icon: 'eye',
    fg: 'var(--amber-600)',
    bg: 'var(--amber-50)',
  },
  finalised: {
    label: 'Finalised',
    icon: 'circle-check',
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
  },
  // An assessment's stage (AS-06): the Assessments list's pill. Quiet tints, one family.
  setup: {
    label: 'Setup',
    icon: 'settings-2',
    fg: 'var(--graphite-700)',
    bg: 'var(--graphite-100)',
  },
  prepare: {
    label: 'Prepare',
    icon: 'list-checks',
    fg: 'var(--graphite-700)',
    bg: 'var(--graphite-100)',
  },
  capture: { label: 'Capture', icon: 'mic', fg: 'var(--ink-600)', bg: 'var(--ink-50)' },
  ready_for_generation: {
    label: 'Ready for generation',
    icon: 'zap',
    fg: 'var(--teal-600)',
    bg: 'var(--teal-50)',
  },
  generate: {
    label: 'Generate',
    icon: 'sparkles',
    fg: 'var(--violet-600)',
    bg: 'var(--violet-50)',
  },
  review: { label: 'Review', icon: 'user-search', fg: 'var(--amber-600)', bg: 'var(--amber-50)' },
  ready_to_export: {
    label: 'Ready to export',
    icon: 'file-check',
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
  },
  exported: {
    label: 'Exported',
    icon: 'circle-check',
    fg: 'var(--graphite-0)',
    bg: 'var(--green-600)',
  },
  archived: {
    label: 'Archived',
    icon: 'archive',
    fg: 'var(--graphite-700)',
    bg: 'transparent',
    bd: 'var(--graphite-300)',
  },
}

/** Returns a status's label, icon and colours; an unknown status is plain grey with its own text. */
export function statusLook(status: string) {
  const key = status.trim().toLowerCase().replace(/\s+/g, '_')
  return (
    STATUSES[key] ?? {
      label: status,
      icon: 'circle',
      fg: 'var(--graphite-700)',
      bg: 'var(--graphite-100)',
      bd: undefined,
    }
  )
}

/** Returns the status pill; an unknown status shows as a plain grey pill with its own text. */
export function StatusPill({ status }: StatusPillProps) {
  const s = statusLook(status)
  return (
    <span
      className="ds-pill"
      style={{
        color: s.fg,
        background: s.bg,
        boxShadow: s.bd ? `inset 0 0 0 1px ${s.bd}` : undefined,
      }}
    >
      <Icon name={s.icon} size={14} />
      {s.label}
    </span>
  )
}

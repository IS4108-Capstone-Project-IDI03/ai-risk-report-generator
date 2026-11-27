// Status pill (CP-23, board 01): icon + word for an assessment's status.
// Called by the Assessments, Clients and client-page tables. Calls Icon.
import type { CSSProperties } from 'react'
import { Icon } from '../core/Icon'

export type StatusPillProps = {
  // A status key (`under_review`) or its label ("Under review"), any case.
  status: string
}

// Colours per status; fg/bg are design-system tokens (v2 section 6).
const STATUSES: Record<
  string,
  // `ink`: the colour for the icon on a plain surface (a filter menu), where it differs from `fg`.
  // `lines`: the label as the pill draws it on two lines; the space that may break is the plain one.
  // `icon` '' draws the word alone.
  { label: string; icon: string; fg: string; bg: string; bd?: string; ink?: string; lines?: string }
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
  // A standard being typed in by a person (IN-18): Draft's colour, but no sparkles, which
  // mean AI-written; the word alone.
  manual_draft: { label: 'Draft', icon: '', fg: 'var(--violet-600)', bg: 'var(--violet-50)' },
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
    // Too long for one line beside the other stages: "Ready for" over "generation".
    lines: 'Ready\u00a0for generation',
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
    // White on the solid pill; on a white menu that icon was invisible (round 10).
    ink: 'var(--green-600)',
  },
  archived: {
    label: 'Archived',
    icon: 'archive',
    fg: 'var(--graphite-700)',
    bg: 'transparent',
    bd: 'var(--graphite-300)',
  },
  // A knowledge base document (KB-01, IN-05): in use, waiting on an admin, or taken out of use.
  // Withdrawn is Archived's outline: kept, but out of use, which is not an error.
  document_active: {
    label: 'Active',
    icon: 'circle-check',
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
  },
  needs_review: {
    label: 'Needs review',
    icon: 'triangle-alert',
    fg: 'var(--amber-600)',
    bg: 'var(--amber-50)',
  },
  withdrawn: {
    label: 'Withdrawn',
    icon: 'archive',
    fg: 'var(--graphite-700)',
    bg: 'transparent',
    bd: 'var(--graphite-300)',
  },
  // A user account (F-03, F-08): signed in before, waiting on its invitation, or switched off.
  // Active is the document's Active; Deactivated is Withdrawn's outline (kept, out of use).
  account_active: {
    label: 'Active',
    icon: 'circle-check',
    fg: 'var(--green-600)',
    bg: 'var(--green-50)',
  },
  invitation_pending: {
    label: 'Invitation pending',
    icon: 'mail',
    fg: 'var(--ink-600)',
    bg: 'var(--ink-50)',
  },
  deactivated: {
    label: 'Deactivated',
    icon: 'user-x',
    fg: 'var(--graphite-700)',
    bg: 'transparent',
    bd: 'var(--graphite-300)',
  },
}

// "Ready for generation" and "ready_for_generation" are the same status.
const keyOf = (status: string) => status.trim().toLowerCase().replace(/\s+/g, '_')

/** Returns a status's label, icon and colours; an unknown status is plain grey with its own text. */
export function statusLook(status: string) {
  return (
    STATUSES[keyOf(status)] ?? {
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
      // Lets a tight phone row give a long stage name its own line (assessment-list.css).
      data-status={keyOf(status)}
      data-lines={s.lines ? 2 : undefined}
      style={
        {
          color: s.fg,
          // The longhand: jsdom fails to clone a `background: transparent` shorthand (Archived, Withdrawn).
          backgroundColor: s.bg,
          boxShadow: s.bd ? `inset 0 0 0 1px ${s.bd}` : undefined,
          // The colour to use where a screen draws the status without its pill (a phone row).
          '--ds-pill-ink': s.ink ?? s.fg,
        } as CSSProperties
      }
    >
      {s.icon && <Icon name={s.icon} size={14} />}
      {s.lines ? <span className="ds-pill-lines">{s.lines}</span> : s.label}
    </span>
  )
}

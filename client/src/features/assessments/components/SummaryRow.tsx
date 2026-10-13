// Section 2's row on the Generation tab (GN-07). Rendered by
// screens/SectionDrafts.tsx above Section 3. Calls POST /summary/draft (api.ts).
import { useState } from 'react'
import { Badge, Button } from '../../../design-system'
import { draftSummary, GatewayError } from '../api'
import type { useSummary } from '../useSummary'
import { ExecutiveSummary } from './ExecutiveSummary'

const note = { display: 'block', marginTop: '4px', fontSize: '14px' } as const

// Section 2's row on the Generation tab (GN-07): drafts the Executive Summary
// once Sections 3-12 are all complete, and says which are not (AC3) or which
// changed since it was drafted (AC4). Uses the sections table's row grid
// (generation-row in workflow.css), so it lines up with the rows below.
export function SummaryRow({
  reference,
  canDraft,
  summaryState,
}: {
  reference: string
  canDraft: boolean
  // Sections 1 and 2 as SectionDrafts loads them (useSummary), shared with its
  // progress count, so a draft made here updates both.
  summaryState: ReturnType<typeof useSummary>
}) {
  const { summary, loadError, reload } = summaryState
  const [drafting, setDrafting] = useState(false)
  // The draft opens under the row, as each section's does (SectionDrafts' View draft).
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const state = summary?.executiveSummary

  const draft = async () => {
    setDrafting(true)
    setFailure(null)
    try {
      await draftSummary(reference)
      // The gateway's read gives the missing and stale lists the draft alone doesn't.
      await reload()
    } catch (error: unknown) {
      setFailure(
        error instanceof GatewayError ? error.message : 'The Executive Summary was not drafted.',
      )
    }
    setDrafting(false)
  }

  const badge = drafting
    ? { tone: 'ai', icon: 'sparkles', label: 'Drafting' }
    : failure
      ? { tone: 'critical', icon: 'octagon-alert', label: 'Failed' }
      : state?.staleSections.length
        ? { tone: 'moderate', icon: 'triangle-alert', label: 'Out of date' }
        : state?.draft
          ? { tone: 'low', icon: 'check', label: 'Drafted' }
          : { tone: 'neutral', icon: 'circle-dashed', label: 'Not drafted' }

  return (
    <div
      role="group"
      aria-label="Section 2 Executive Summary"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div
        className="generation-row"
        style={{ display: 'grid', alignItems: 'center', padding: '12px 20px' }}
      >
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)' }}
        >
          2
        </span>
        <span style={{ minWidth: 0, paddingRight: '20px' }}>
          <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '16px', fontWeight: 500 }}>Executive Summary</span>
          </span>
          {state && state.missing.length > 0 && (
            <span style={{ ...note, color: 'var(--text-secondary)' }}>
              Complete these sections first:{' '}
              {state.missing.map((s) => `${s.id} ${s.title}`).join(', ')}.
            </span>
          )}
          {state && state.staleSections.length > 0 && (
            <span style={{ ...note, color: 'var(--status-moderate-fg)' }}>
              {state.staleSections.map((s) => `${s.id} ${s.title}`).join(', ')} changed since this
              summary. Redraft to bring it up to date.
            </span>
          )}
          {loadError && (
            <span style={{ ...note, color: 'var(--status-critical-fg)' }}>{loadError}</span>
          )}
          {failure && (
            <span role="alert" style={{ ...note, color: 'var(--status-critical-fg)' }}>
              {failure}
            </span>
          )}
        </span>
        <span className="generation-status">
          <Badge tone={badge.tone} icon={badge.icon}>
            {badge.label}
          </Badge>
        </span>
        <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>Sections 3–12</span>
        <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '8px' }}>
          {state?.draft && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft="file-text"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide draft' : 'View draft'}
            </Button>
          )}
          {canDraft && state && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft="sparkles"
              loading={drafting}
              // No paid call is made while a section is still missing (AC3).
              disabled={drafting || state.missing.length > 0}
              onClick={() => void draft()}
            >
              {drafting ? 'Drafting…' : state.draft ? 'Redraft' : 'Draft'}
            </Button>
          )}
        </span>
      </div>
      {open && state?.draft && (
        // Styled as SectionDrafts' DraftView. Its citations are sections ("Section 7"),
        // which DraftView cannot show, so Review's view of Section 2 is reused instead.
        <section
          aria-label="2. Executive Summary draft"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '16px 20px 20px',
            background: 'var(--surface-sunken)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <ExecutiveSummary
            summary={state}
            error={null}
            onGenerate={() => {}}
            fullWidth
            showCitations={false}
          />
        </section>
      )}
    </div>
  )
}

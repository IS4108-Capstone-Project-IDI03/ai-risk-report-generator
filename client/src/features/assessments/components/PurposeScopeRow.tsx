// Section 1's row on the Generation tab (GN-07 AC1): Purpose and Scope is assembled
// from the assessment's details, so there is nothing to draft; the row says so and opens
// the text under it. Rendered by screens/SectionDrafts.tsx above Section 2's row, with
// the same row grid (generation-row in workflow.css). Data: useSummary (no extra call).
import { useState } from 'react'
import { Badge, Button } from '../../../design-system'
import type { useSummary } from '../useSummary'
import { PurposeScope } from './PurposeScope'

export function PurposeScopeRow({ summaryState }: { summaryState: ReturnType<typeof useSummary> }) {
  const { summary, loadError } = summaryState
  const [open, setOpen] = useState(false)
  return (
    <div
      role="group"
      aria-label="Section 1 Purpose and Scope"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <div
        className="generation-row"
        style={{ display: 'grid', alignItems: 'center', padding: '12px 20px' }}
      >
        <span
          style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--text-muted)' }}
        >
          1
        </span>
        <span style={{ minWidth: 0, paddingRight: '20px' }}>
          <span style={{ fontSize: '16px', fontWeight: 500 }}>Purpose and Scope</span>
          <span
            style={{
              display: 'block',
              marginTop: '4px',
              fontSize: '14px',
              color: 'var(--text-secondary)',
            }}
          >
            Assembled from the assessment details; nothing to draft.
          </span>
        </span>
        <span className="generation-status">
          {/* The rail's badge for Section 1 in Review. */}
          <Badge tone="low" icon="check">
            From assessment details
          </Badge>
        </span>
        <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>Assessment</span>
        <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="ghost"
            size="sm"
            iconLeft="file-text"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? 'Hide' : 'View'}
          </Button>
        </span>
      </div>
      {open && (
        <section
          aria-label="1. Purpose and Scope"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            padding: '16px 20px 20px',
            background: 'var(--surface-sunken)',
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <PurposeScope text={summary?.purposeAndScope ?? null} error={loadError} />
        </section>
      )}
    </div>
  )
}

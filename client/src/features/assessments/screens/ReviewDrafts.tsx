import { useState } from 'react'
import { Badge, Button, Callout, EmptyState, ProgressBar } from '../../../design-system'
import { useObservations } from '../useObservations'
import { useSections } from '../useSections'
import { DraftView } from './SectionDrafts'

// The Review tab for a saved assessment: sections 7-12 down the side, the
// selected section's newest draft beside them. Read-only until the review
// stories (RV-01, RV-02) add accepting and editing.
export function ReviewDrafts({
  reference,
  wrapStyle,
  railStyle,
  onGenerate,
}: {
  reference: string
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
  onGenerate: () => void
}) {
  const { sections, loadError } = useSections(reference)
  const [selected, setSelected] = useState<string | null>(null)
  const { observations } = useObservations(reference, true)

  if (loadError)
    return (
      <div style={{ padding: '24px 28px' }}>
        <Callout tone="danger" title="The sections could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  if (!sections)
    return <p style={{ padding: '24px 28px', margin: 0 }}>Loading the report sections…</p>

  const drafted = sections.filter((s) => s.latestDraft)
  if (!drafted.length)
    return (
      <EmptyState
        icon="file-text"
        title="No sections drafted yet"
        description="Drafted sections appear here for review. Draft them on the Report generation tab."
        action={
          <Button variant="primary" iconLeft="sparkles" onClick={onGenerate}>
            Go to Report generation
          </Button>
        }
      />
    )

  // The first drafted section opens until another is chosen.
  const open = sections.find((s) => s.id === (selected ?? drafted[0].id))!

  return (
    <div style={wrapStyle}>
      <nav aria-label="Report sections" className="om-scroll" style={railStyle}>
        <div
          style={{
            padding: '16px 18px 10px',
            fontSize: '11px',
            fontWeight: '600',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted)',
          }}
        >
          Sections
        </div>
        <div style={{ padding: '0 18px 14px' }}>
          <ProgressBar
            value={Math.round((drafted.length / sections.length) * 100)}
            label={`${drafted.length} of ${sections.length} sections drafted`}
            tone="primary"
          />
        </div>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-current={s.id === open.id}
            onClick={() => setSelected(s.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              padding: '10px 18px',
              border: 'none',
              borderLeft: `3px solid ${s.id === open.id ? 'var(--ai-fg)' : 'transparent'}`,
              background: s.id === open.id ? 'var(--surface-hover)' : 'transparent',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <span
              style={{
                width: '24px',
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                color: 'var(--text-muted)',
              }}
            >
              {s.id}
            </span>
            <span style={{ flex: '1', minWidth: 0, fontSize: '15px', color: 'var(--text-body)' }}>
              {s.title}
            </span>
            {s.latestDraft ? (
              <Badge tone="ai" icon="sparkles">
                Draft
              </Badge>
            ) : (
              <Badge tone="neutral">Empty</Badge>
            )}
          </button>
        ))}
      </nav>
      <div className="om-scroll" style={{ flex: '1', minWidth: 0, overflow: 'auto' }}>
        <div style={{ maxWidth: '900px', padding: '24px 28px 40px' }}>
          <h2 style={{ margin: '0 0 12px', fontSize: '20px', fontWeight: 500 }}>
            {open.id}. {open.title}
          </h2>
          {open.latestDraft ? (
            <>
              {open.changesSinceDraft > 0 && (
                <Callout tone="warning" title="This draft is out of date">
                  {open.changesSinceDraft} observation
                  {open.changesSinceDraft === 1 ? ' was' : 's were'} added or changed after it was
                  drafted. Redraft it on the Report generation tab to include{' '}
                  {open.changesSinceDraft === 1 ? 'it' : 'them'}.
                </Callout>
              )}
              <DraftView draft={open.latestDraft} observations={observations} />
            </>
          ) : (
            <EmptyState
              icon="file-text"
              title="Not drafted yet"
              description="This section has no draft to review. Draft it on the Report generation tab."
              action={
                <Button variant="secondary" iconLeft="sparkles" onClick={onGenerate}>
                  Go to Report generation
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  )
}

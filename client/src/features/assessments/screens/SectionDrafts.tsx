import { Fragment, useRef, useState } from 'react'
import {
  AIDraftBlock,
  Badge,
  Button,
  Callout,
  EvidenceCitation,
  ProgressBar,
} from '../../../design-system'
import {
  draftSection,
  GatewayError,
  type ReportSection,
  type SavedObservation,
  type SectionDraft,
} from '../api'
import { ObservationExcerpt } from '../components/ObservationExcerpt'
import { describeChanges } from '../reviewDisplay'
import { useObservations } from '../useObservations'
import { useSections } from '../useSections'

const card = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-default)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow-sm)',
  overflow: 'hidden',
} as const
const muted = { margin: 0, fontSize: '15px', color: 'var(--text-secondary)' } as const

type Citation = React.ComponentProps<typeof EvidenceCitation>

// What a citation ID points to, ready to show as evidence (GN-01 AC4).
function resolve(id: string, draft: SectionDraft, observations: SavedObservation[]): Citation {
  if (id.startsWith('O:')) {
    const o = observations.find((x) => x.id === id.slice(2))
    if (o) {
      return {
        kind: 'observation',
        source: o.location
          ? [o.location.name, o.location.floor].filter(Boolean).join(', ')
          : 'Site observation',
        locator: o.copeDimension ?? undefined,
        excerpt: <ObservationExcerpt observation={o} />,
      }
    }
  }
  const chunk = draft.sources[id]
  if (chunk) {
    const pages =
      chunk.page_start != null
        ? `p. ${chunk.page_start}` +
          (chunk.page_end && chunk.page_end !== chunk.page_start ? `–${chunk.page_end}` : '')
        : undefined
    return {
      kind: 'standard',
      source: chunk.headings?.join(' › ') || chunk.doc_id || 'Standard',
      locator: pages,
      excerpt: chunk.text,
    }
  }
  return { kind: 'insight', source: 'This citation could not be found', locator: id }
}

function SubsectionDraft({
  sub,
  draft,
  observations,
}: {
  sub: SectionDraft['subsections'][number]
  draft: SectionDraft
  observations: SavedObservation[]
}) {
  const [showEvidence, setShowEvidence] = useState(false)
  if (sub.kind === 'table') {
    return (
      <div style={{ ...card, padding: '14px 20px' }}>
        <strong style={{ fontSize: '15px' }}>{sub.heading}</strong>
        <p style={muted}>This table is completed from measured values, so it is not drafted.</p>
      </div>
    )
  }
  if (!sub.statements.length) {
    return (
      <div style={{ ...card, padding: '14px 20px' }}>
        <strong style={{ fontSize: '15px' }}>{sub.heading}</strong>
        <p style={muted}>No evidence covers this subsection, so it was left empty.</p>
      </div>
    )
  }
  // Numbered in the order each source is first cited.
  const cited = [...new Set(sub.statements.flatMap((s) => s.citations))]
  const unsupported = sub.statements.some((s) => !s.supported)
  return (
    <div>
      <AIDraftBlock
        heading={sub.heading}
        status={unsupported ? 'flagged' : 'draft'}
        // Every citation resolves, but whether each source says what the
        // statement claims is not checked yet, so this is never high.
        confidence={unsupported ? 'low' : 'medium'}
        evidenceCount={cited.length}
        onShowEvidence={() => setShowEvidence((open) => !open)}
      >
        {sub.statements.map((s, i) => (
          <p key={i} style={{ margin: i ? '10px 0 0' : 0 }}>
            {s.text}
            {s.citations.map((c) => (
              <sup
                key={c}
                style={{
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--ai-fg)',
                  marginLeft: '2px',
                }}
              >
                {cited.indexOf(c) + 1}
              </sup>
            ))}
            {!s.supported && (
              <Badge tone="moderate" icon="triangle-alert" style={{ marginLeft: '8px' }}>
                Unsupported
              </Badge>
            )}
          </p>
        ))}
      </AIDraftBlock>
      {showEvidence && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
          {cited.map((c, i) => (
            <EvidenceCitation key={c} index={i + 1} {...resolve(c, draft, observations)} />
          ))}
        </div>
      )}
    </div>
  )
}

// A section's newest draft, shown under its row: what wrote it, then each
// subsection with its evidence.
export function DraftView({
  draft,
  observations,
}: {
  draft: SectionDraft
  observations: SavedObservation[]
}) {
  return (
    <section
      aria-label={`${draft.sectionId}. ${draft.title} draft`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        padding: '16px 20px 20px',
        background: 'var(--surface-sunken)',
        borderBottom: '1px solid var(--border-default)',
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: 'var(--font-mono)',
          fontSize: '13px',
          color: 'var(--text-muted)',
        }}
      >
        Drafted {new Date(draft.provenance.generated_at).toLocaleString()} ·{' '}
        {draft.provenance.model} ({draft.provenance.effort} effort) · prompt{' '}
        {draft.provenance.prompt_version} · template {draft.provenance.template_version}
      </p>
      {draft.questions.length > 0 && (
        <Callout tone="info" title="Questions for the engineer">
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {draft.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Callout>
      )}
      {draft.guardrail.unsupported_count > 0 && (
        <Callout tone="warning" title="Some statements need review">
          {draft.guardrail.unsupported_count} statement
          {draft.guardrail.unsupported_count === 1 ? ' cites' : 's cite'} no evidence that could be
          found. They are marked Unsupported.
        </Callout>
      )}
      {draft.subsections.map((sub) => (
        <SubsectionDraft key={sub.heading} sub={sub} draft={draft} observations={observations} />
      ))}
    </section>
  )
}

// The same badges as the demo generation screen.
const STATE = {
  drafted: { tone: 'low', icon: 'check', label: 'Drafted' },
  drafting: { tone: 'ai', icon: 'sparkles', label: 'Drafting' },
  queued: { tone: 'neutral', icon: 'ellipsis', label: 'Queued' },
  ready: { tone: 'neutral', icon: 'circle-dashed', label: 'Not drafted' },
  insufficient: { tone: 'moderate', icon: 'triangle-alert', label: 'Insufficient evidence' },
  failed: { tone: 'critical', icon: 'octagon-alert', label: 'Failed' },
} as const

const columns = '48px minmax(0,1fr) 140px 280px'
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Sections 7-12 of the report for a saved assessment (GN-01), laid out like
// the demo generation screen. Draft one section from its row, or the whole
// report from the header: every section with enough evidence that has no
// draft yet, one at a time.
export function SectionDrafts({
  reference,
  canDraft,
  onCapture,
  onReview,
}: {
  reference: string
  canDraft: boolean
  onCapture?: () => void
  onReview: () => void
}) {
  const { sections, setSections, loadError } = useSections(reference)
  const [queue, setQueue] = useState<string[]>([])
  const [drafting, setDrafting] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const stop = useRef(false)
  const { observations } = useObservations(reference, true)

  const hasEvidence = (s: ReportSection) => s.usableObservations >= s.minObservations
  const pending = (sections ?? []).filter((s) => !s.latestDraft && hasEvidence(s))
  const draftable = (sections ?? []).filter(hasEvidence)
  const done = draftable.filter((s) => s.latestDraft).length
  const running = drafting !== null

  // Drafts the sections one after another. Stopping takes effect once the
  // section being drafted is saved, so no paid call is thrown away.
  const run = async (ids: string[]) => {
    stop.current = false
    setStopping(false)
    for (const [i, id] of ids.entries()) {
      if (stop.current) break
      setQueue(ids.slice(i + 1))
      setDrafting(id)
      setFailures((f) => Object.fromEntries(Object.entries(f).filter(([key]) => key !== id)))
      try {
        const saved = await draftSection(reference, id)
        setSections((list) =>
          (list ?? []).map((s) => (s.id === id ? { ...s, latestDraft: saved } : s)),
        )
        // A section drafted on its own opens straight away.
        if (ids.length === 1) setSelected(id)
      } catch (error: unknown) {
        setFailures((f) => ({
          ...f,
          [id]: error instanceof GatewayError ? error.message : 'The section was not drafted.',
        }))
      }
    }
    setDrafting(null)
    setQueue([])
    setStopping(false)
  }

  const stateOf = (s: ReportSection) =>
    drafting === s.id
      ? STATE.drafting
      : queue.includes(s.id)
        ? STATE.queued
        : failures[s.id]
          ? STATE.failed
          : s.latestDraft
            ? STATE.drafted
            : hasEvidence(s)
              ? STATE.ready
              : STATE.insufficient
  const attention = (sections ?? []).filter((s) => !hasEvidence(s) || failures[s.id]).length

  return (
    <div style={{ padding: '24px 28px 40px', animation: 'omFade 180ms cubic-bezier(.2,0,.2,1)' }}>
      <div style={{ maxWidth: '1000px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Callout tone="ai" title={running ? 'Drafting in progress' : 'Draft sections 7 to 12'}>
          {running
            ? 'Sections appear here as each one completes. Each takes a minute or two.'
            : 'Draft one section from its row, or every section at once. Each section is drafted from the observations filed under its categories, observations from other categories where they concern it, and the standards in the knowledge base. Uncategorised observations are not used. Every statement cites its evidence.'}
        </Callout>
        {loadError && (
          <Callout tone="danger" title="The sections could not be loaded">
            {loadError}
          </Callout>
        )}
        {!sections && !loadError && <p style={muted}>Loading the report sections…</p>}
        {sections && (
          <div style={card}>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '16px',
                padding: '16px 20px',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            >
              <div style={{ flex: '1', minWidth: '200px' }}>
                <ProgressBar
                  value={draftable.length ? Math.round((done / draftable.length) * 100) : 0}
                  label={`${done} of ${plural(draftable.length, 'section')} drafted`}
                  showValue={true}
                  tone="ai"
                />
              </div>
              {canDraft && running && (
                <Button
                  variant="secondary"
                  iconLeft="x"
                  disabled={stopping}
                  onClick={() => {
                    stop.current = true
                    setStopping(true)
                  }}
                >
                  {stopping ? 'Stopping after this section' : 'Stop generation'}
                </Button>
              )}
              {canDraft && !running && pending.length > 0 && (
                <Button
                  variant={done ? 'secondary' : 'primary'}
                  iconLeft="sparkles"
                  onClick={() => void run(pending.map((s) => s.id))}
                >
                  {done ? 'Draft remaining sections' : 'Draft all sections'}
                </Button>
              )}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: columns,
                alignItems: 'center',
                padding: '0 20px',
                height: '34px',
                background: 'var(--surface-header)',
                borderBottom: '1px solid var(--border-default)',
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--text-muted)',
              }}
            >
              <span>{'\u00a7'}</span>
              <span>Section</span>
              <span>Evidence</span>
              <span />
            </div>
            {sections.map((s) => {
              const state = stateOf(s)
              const failed = failures[s.id]
              return (
                <Fragment key={s.id}>
                  <div style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: columns,
                        alignItems: 'center',
                        padding: '12px 20px',
                      }}
                    >
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '13px',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {s.id}
                      </span>
                      <span style={{ minWidth: 0, paddingRight: '20px' }}>
                        <span
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '10px',
                          }}
                        >
                          <span style={{ fontSize: '16px', fontWeight: 500 }}>{s.title}</span>
                          <Badge tone={state.tone} icon={state.icon}>
                            {state.label}
                          </Badge>
                        </span>
                        {s.latestDraft && s.changesSinceDraft > 0 && (
                          <span
                            style={{
                              display: 'block',
                              marginTop: '4px',
                              fontSize: '14px',
                              color: 'var(--status-moderate-fg)',
                            }}
                          >
                            {describeChanges(s.changeCounts)} since this draft. Redraft to bring it
                            up to date.
                          </span>
                        )}
                        {state === STATE.insufficient && (
                          <span
                            style={{
                              display: 'block',
                              marginTop: '4px',
                              fontSize: '14px',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            Needs {plural(s.minObservations, 'observation')} filed under{' '}
                            {s.copeDimensions.join(' or ')}.
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                        {plural(s.usableObservations, 'observation')}
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          justifyContent: 'flex-end',
                          gap: '8px',
                        }}
                      >
                        {s.latestDraft && (
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft="file-text"
                            aria-expanded={selected === s.id}
                            onClick={() => setSelected(selected === s.id ? null : s.id)}
                          >
                            {selected === s.id ? 'Hide draft' : 'View draft'}
                          </Button>
                        )}
                        {state === STATE.insufficient && onCapture && (
                          <Button variant="ghost" size="sm" iconLeft="camera" onClick={onCapture}>
                            Capture evidence
                          </Button>
                        )}
                        {canDraft && hasEvidence(s) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft="sparkles"
                            loading={drafting === s.id}
                            disabled={running}
                            onClick={() => void run([s.id])}
                          >
                            {drafting === s.id
                              ? 'Drafting…'
                              : s.latestDraft
                                ? 'Redraft section'
                                : 'Draft section'}
                          </Button>
                        )}
                      </span>
                    </div>
                    {failed && (
                      <div
                        style={{
                          margin: '0 20px 14px',
                          padding: '12px 14px',
                          background: 'var(--status-critical-bg)',
                          borderLeft: '2px solid var(--status-critical-fg)',
                          borderRadius: '0 5px 5px 0',
                        }}
                      >
                        <div
                          style={{
                            fontSize: '15px',
                            fontWeight: 600,
                            color: 'var(--status-critical-fg)',
                            marginBottom: '6px',
                          }}
                        >
                          Generation failed
                        </div>
                        <p style={{ ...muted, color: 'var(--text-body)', maxWidth: '68ch' }}>
                          {failed}
                        </p>
                        {canDraft && !running && (
                          <div style={{ marginTop: '12px' }}>
                            <Button
                              variant="secondary"
                              size="sm"
                              iconLeft="refresh-cw"
                              onClick={() => void run([s.id])}
                            >
                              Retry
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  {selected === s.id && s.latestDraft && (
                    <DraftView draft={s.latestDraft} observations={observations} />
                  )}
                </Fragment>
              )
            })}
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 20px',
                background: 'var(--surface-sunken)',
              }}
            >
              <span style={{ fontSize: '15px', color: 'var(--text-secondary)' }}>
                {done} of {plural(draftable.length, 'section')} drafted ·{' '}
                {attention
                  ? `${attention} need${attention === 1 ? 's' : ''} attention`
                  : 'nothing outstanding in drafting'}
                {!canDraft &&
                  ' · Only the assigned engineer can draft sections while the assessment is open.'}
              </span>
              <span style={{ flex: '1' }} />
              <Button
                variant="primary"
                iconRight="chevron-right"
                disabled={!done || running}
                onClick={onReview}
              >
                Review report
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

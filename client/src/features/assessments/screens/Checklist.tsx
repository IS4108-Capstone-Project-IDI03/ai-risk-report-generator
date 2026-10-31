import { useState } from 'react'
import { Button, Callout, Checkbox, Dialog, EmptyState } from '../../../design-system'
import { generateChecklist, GatewayError, type ChecklistView, type ScopeStandard } from '../api'
import { caption, card, country, heading, muted } from '../checklistChecks'
import { ChecklistItems, type ChecklistAnswering } from '../components/ChecklistItems'
import { formatDay } from '../format'
import { plural } from '../reviewDisplay'
import { useChecklist } from '../useChecklist'

// "NFPA 13 · 2025" from what the knowledge base knows of a standard.
function designation(s: Pick<ScopeStandard, 'issuingBody' | 'standardNumber' | 'edition'>) {
  const name = [s.issuingBody, s.standardNumber].filter(Boolean).join(' ')
  return [name, s.edition].filter(Boolean).join(' · ')
}

// The standards to leave unticked by default: those the latest checklist left
// out, unless added to the knowledge base since it was generated. Before any
// checklist, every standard is ticked.
function leftOut(view: ChecklistView): Set<string> {
  const last = view.checklist
  if (!last) return new Set()
  const generated = new Date(last.provenance.generated_at)
  return new Set(
    view.standards
      .filter(
        (s) => !last.standards.some((u) => u.id === s.id) && new Date(s.uploadedAt) <= generated,
      )
      .map((s) => s.id),
  )
}

// What regenerating an answered checklist did to its answers (CP-31), until
// dismissed: that they were all kept; or how many were not, with the items as
// they were worded, folded away, since the new items that may replace them
// are highlighted in the checklist below. Nothing is said of a checklist that
// had no answers.
function Regenerated({
  lost,
  replacing,
  onDismiss,
}: {
  lost: string[]
  // How many new items may replace them, highlighted below.
  replacing: number
  onDismiss: () => void
}) {
  const dismiss = (
    <Button variant="link" size="sm" onClick={onDismiss}>
      Dismiss
    </Button>
  )
  if (lost.length === 0) {
    return (
      <Callout tone="success" title="Checklist regenerated">
        All your answers are kept.
        <div style={{ marginTop: 'var(--space-3)' }}>{dismiss}</div>
      </Callout>
    )
  }
  const one = lost.length === 1
  const highlighted =
    replacing === 0
      ? ''
      : `${replacing === 1 ? 'An item that' : 'Items that'} may replace ${one ? 'it' : 'them'} ${replacing === 1 ? 'is' : 'are'} highlighted below. `
  return (
    <Callout
      tone="warning"
      title={`Checklist regenerated: ${plural(lost.length, 'answer')} ${one ? 'was' : 'were'} not kept`}
    >
      {one ? 'This item was' : 'These items were'} reworded, so{' '}
      {one ? 'its answer' : 'their answers'} did not carry over. {highlighted}What you recorded is
      still in Observations.
      {/* For an item removed rather than reworded, which nothing below shows. */}
      <details style={{ margin: 'var(--space-3) 0' }}>
        <summary style={{ cursor: 'pointer' }}>Show the earlier wording ({lost.length})</summary>
        <ul style={{ margin: 'var(--space-3) 0 0', paddingLeft: 'var(--space-6)' }}>
          {lost.map((text, i) => (
            <li key={i + text}>{text}</li>
          ))}
        </ul>
      </details>
      {dismiss}
    </Callout>
  )
}

// The assessment's Checklist tab: the standards that apply to the site, ticked
// to choose which the checklist uses (CP-30 AC1-2), and the latest checklist
// (AC9), shown and answered as on site (CP-31). Only the assigned engineer
// generates and answers; anyone who can open the assessment reads it.
export function Checklist({
  reference,
  canGenerate,
  answering,
  onViewObservation,
}: {
  reference: string
  canGenerate: boolean
  answering: ChecklistAnswering | null
  onViewObservation: (observationId: string) => void
}) {
  const { view, setView, sections, loadError, reload } = useChecklist(reference)
  // The engineer's own ticks, for the checklist shown when they were made; a new
  // checklist starts again from the standards it used (leftOut).
  const [ticks, setTicks] = useState<{ checklist: string | null; unticked: Set<string> } | null>(
    null,
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Regenerating once items are answered asks first, then says what became of
  // the answers, the items whose answers were not kept, and highlights the new
  // items that may replace them, until dismissed; null when nothing is to be said.
  const [asking, setAsking] = useState(false)
  const [regenerated, setRegenerated] = useState<{ lost: string[]; replacing: Set<string> } | null>(
    null,
  )

  if (loadError) {
    return (
      <div style={{ padding: '24px' }}>
        <Callout tone="danger" title="The checklist could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  }
  if (!view) return <p style={{ ...muted, padding: '24px' }}>Loading the checklist…</p>

  const shownId = view.checklist?.id ?? null
  // The standards unticked; everything else applicable is in scope.
  const unticked = ticks && ticks.checklist === shownId ? ticks.unticked : leftOut(view)
  const setUnticked = (next: Set<string>) => setTicks({ checklist: shownId, unticked: next })
  const chosen = view.standards.filter((s) => !unticked.has(s.id))
  const answered = view.checklist?.items.filter((i) => i.check) ?? []
  const generate = async () => {
    setAsking(false)
    setRunning(true)
    setError(null)
    setRegenerated(null)
    try {
      const generated = await generateChecklist(
        reference,
        chosen.map((s) => s.id),
      )
      setView(generated)
      if (answered.length) {
        setRegenerated({
          lost: generated.carryOver?.dropped ?? [],
          replacing: new Set(generated.carryOver?.mayReplace ?? []),
        })
      }
    } catch (failure: unknown) {
      setError(
        failure instanceof GatewayError
          ? failure.message
          : 'The checklist could not be generated. Try again.',
      )
    } finally {
      setRunning(false)
    }
  }
  const generated = view.checklist && new Date(view.checklist.provenance.generated_at)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-6)',
        padding: 'var(--space-8)',
        maxWidth: '1080px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-5)',
        }}
      >
        <h2 style={{ ...heading, fontSize: '20px', flex: '1 1 360px' }}>Pre-survey checklist</h2>
        {canGenerate && (
          <Button
            variant={view.checklist ? 'secondary' : 'primary'}
            iconLeft="sparkles"
            loading={running}
            disabled={running}
            onClick={() => (answered.length ? setAsking(true) : void generate())}
          >
            {view.checklist ? 'Regenerate checklist' : 'Generate checklist'}
          </Button>
        )}
      </div>
      {running && <p style={muted}>Generating the checklist. This takes about half a minute.</p>}
      {asking && (
        <Dialog
          title="Regenerate the checklist?"
          description="Your answers stay with the items that come back. If an AI-written item is reworded, you'll be shown which ones to answer again. Nothing is removed from Observations."
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                Cancel
              </Button>
              <Button variant="primary" iconLeft="sparkles" onClick={() => void generate()}>
                Regenerate
              </Button>
            </>
          }
        />
      )}
      {regenerated && (
        <Regenerated
          lost={regenerated.lost}
          replacing={regenerated.replacing.size}
          onDismiss={() => setRegenerated(null)}
        />
      )}

      {/* Folded once there is a checklist: the standards matter again only to regenerate. */}
      <details open={!view.checklist} aria-label="Standards to use" style={card}>
        <summary
          style={{
            cursor: 'pointer',
            padding: 'var(--space-5) var(--space-6)',
            fontWeight: 600,
            fontSize: 'var(--text-body-size)',
          }}
        >
          Standards to use ({chosen.length} of {view.standards.length} selected)
        </summary>
        <div style={{ padding: '0 var(--space-6) var(--space-6)' }}>
          {view.standards.length === 0 ? (
            <p style={muted}>
              No standards in the knowledge base apply to {view.scope.facilityType} in{' '}
              {country(view.scope.jurisdiction)}. The checklist will have the template and
              facility-risk items only. Ask a knowledge admin to add the standards.
            </p>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 420px), 1fr))',
                gap: 'var(--space-4) var(--space-8)',
              }}
            >
              {view.standards.map((s) => (
                <Checkbox
                  key={s.id}
                  label={s.title}
                  description={designation(s) || undefined}
                  checked={!unticked.has(s.id)}
                  disabled={!canGenerate || running}
                  onChange={(checked) => {
                    const next = new Set(unticked)
                    if (checked) next.delete(s.id)
                    else next.add(s.id)
                    setUnticked(next)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </details>

      {error && (
        <Callout tone="danger" title="Couldn't generate the checklist">
          {error}
          {view.checklist && ' The checklist below is the last one generated.'}
        </Callout>
      )}

      {view.checklist && generated ? (
        <>
          <p style={{ ...caption, fontFamily: 'var(--font-mono)' }}>
            Generated {formatDay(generated)}{' '}
            {generated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
            {view.checklist.provenance.model ?? 'no model called'} ·{' '}
            {plural(view.checklist.standards.length, 'standard')} ·{' '}
            {view.checklist.provenance.checklist_version}
          </p>
          <ChecklistItems
            key={view.checklist.id}
            reference={reference}
            view={{ ...view, checklist: view.checklist }}
            sections={sections}
            setView={setView}
            reload={reload}
            answering={answering}
            highlight={regenerated?.replacing}
            regenerateHint={
              canGenerate
                ? 'Regenerate it for the site as it is now.'
                : "The assessment's assigned engineer can regenerate it."
            }
            onViewObservation={onViewObservation}
          />
        </>
      ) : (
        <EmptyState
          icon="list-checks"
          title="No checklist yet"
          description={
            canGenerate
              ? 'Choose the standards to use, then generate the checklist.'
              : "The assessment's assigned engineer generates its checklist."
          }
        />
      )}
    </div>
  )
}

// The choices in the Review page's side panel (IN-07): one radio per choice,
// each with a line saying what it does, the usual one tagged, and a button
// named after the chosen one. Choices that delete a document ask first
// (DiscardDialog). Used by components/ReviewPanel.tsx; the page applies the
// decision.
import { useState } from 'react'
import { Badge, Button, Callout, Radio } from '../../../design-system'
import type { DecisionChoice, KnowledgeDocument } from '../api'
import { choicesFor } from '../decisions'
import { DiscardDialog } from './DiscardDialog'

/** Returns the choices and the button that applies the chosen one. */
export function DecisionPanel({
  document: d,
  onDecide,
}: {
  document: KnowledgeDocument
  // Applies the choice; rejects with the server's reason when it is refused.
  onDecide: (choice: DecisionChoice) => Promise<void>
}) {
  const choices = choicesFor(d)
  const [chosen, setChosen] = useState<DecisionChoice | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const selected = choices.find((c) => c.value === chosen)

  const run = async () => {
    if (!chosen) return
    setBusy(true)
    setProblem(null)
    try {
      await onDecide(chosen)
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'Nothing changed. Try again.')
      setBusy(false)
    }
  }
  const deleting = !!selected?.deletes
  // Which document the dialog names: Delete stored document removes the other.
  const doomed = selected?.deletes === 'other' ? d.match!.document.title : d.title

  return (
    <div className="kb-decide">
      <fieldset className="kb-decide-choices">
        <legend>What should happen to this document?</legend>
        {/* Each choice is a card, so the whole card is the click target and
            the chosen one is marked by its fill, not just the radio dot. */}
        {choices.map((c) => (
          <div key={c.value} className="kb-choice" data-checked={chosen === c.value || undefined}>
            <Radio
              name="decision"
              label={
                <span className="kb-choice-label">
                  {c.label}
                  {c.usual && <Badge tone="info">Usual choice</Badge>}
                </span>
              }
              description={c.consequence}
              checked={chosen === c.value}
              style={{ padding: '12px 14px', lineHeight: 'var(--text-caption-lh)' }}
              onChange={() => {
                setChosen(c.value)
                setProblem(null)
              }}
            />
          </div>
        ))}
      </fieldset>
      {problem && !confirming && (
        <div role="alert">
          <Callout tone="warning" title="Nothing changed">
            {problem}
          </Callout>
        </div>
      )}
      <Button
        variant={deleting ? 'danger' : 'primary'}
        fullWidth
        disabled={!selected}
        loading={busy && !confirming}
        onClick={() => (deleting ? setConfirming(true) : run())}
      >
        {selected?.label ?? 'Choose what happens'}
      </Button>
      {confirming && selected && (
        <DiscardDialog
          title={doomed}
          confirmLabel={selected.label}
          busy={busy}
          problem={problem}
          onConfirm={run}
          onClose={() => {
            setConfirming(false)
            setProblem(null)
          }}
        />
      )}
    </div>
  )
}

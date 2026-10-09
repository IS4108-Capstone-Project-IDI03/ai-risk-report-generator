// The Review page's side panel (IN-07): what the document matches and what to
// do about it, beside the passages it concerns (the review workspace's rule).
// It says what is left at every point: save the details first, choose what
// happens, or nothing left. Used by screens/ReviewDocument.tsx; renders
// components/DecisionPanel.tsx.
import { Button, Callout, Icon, IconRegistry } from '../../../design-system'
import type { DecisionChoice, KnowledgeDocument } from '../api'
import { matchLine } from '../display'
import { DecisionPanel } from './DecisionPanel'

/** Returns the side panel for the document's current state. */
export function ReviewPanel({
  document: d,
  onDecide,
  onBack,
}: {
  document: KnowledgeDocument
  onDecide: (choice: DecisionChoice) => Promise<void>
  onBack: () => void
}) {
  const locked = d.unconfirmed.length > 0

  // a. No match: either details are still open, or nothing is left to do.
  if (!d.match) {
    return locked ? (
      <div className="kb-panel-block">
        <h3 className="kb-panel-title">Fill in the missing details</h3>
        <p className="kb-panel-note">
          Some details could not be read from the file. Once they are saved, the document becomes
          active, unless it matches another document.
        </p>
      </div>
    ) : (
      <Callout
        tone="success"
        title={`${d.title} no longer needs review`}
        actions={
          <Button variant="secondary" size="sm" onClick={onBack}>
            Back to the list
          </Button>
        }
      >
        The details are saved and it matches no other document. It is active.
      </Callout>
    )
  }

  // b. A match: what it is, with exact counts, then the choices.
  const { match } = d
  return (
    <>
      <div className="kb-panel-block kb-panel-band">
        <h3 className="kb-panel-title">
          <Icon name={IconRegistry.status.flagged.icon} size={16} />
          {matchLine(match)}
        </h3>
        <dl className="kb-panel-counts" aria-label="Passages that match">
          <div className="kb-panel-counts-head" aria-hidden="true">
            Passages that match
          </div>
          <div>
            <dt>This document</dt>
            <dd>
              {match.newMatched} of {match.newTotal}
            </dd>
          </div>
          <div>
            <dt>Stored document</dt>
            <dd>
              {match.storedMatched} of {match.storedTotal}
            </dd>
          </div>
        </dl>
      </div>
      {locked ? (
        <p className="kb-panel-note">
          Save the details first. The choices open once they are saved, since saving can change what
          this document matches.
        </p>
      ) : (
        <DecisionPanel
          key={`${match.kind}:${match.document.id}`}
          document={d}
          onDecide={onDecide}
        />
      )}
    </>
  )
}

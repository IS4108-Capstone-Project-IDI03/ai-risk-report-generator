import { Button, Callout, IconRegistry, SegmentedControl } from '../../../design-system'
import { Tip } from '../../help/Tip'
import type { ReviewSection } from '../api'
import { formatDayTime } from '../format'
import { findingCountsLabel, plural } from '../reviewDisplay'

export type DraftView = 'saved' | 'replacement'

// The section's review controls above its draft (RV-02): how its findings
// stand, Bulk accept and Regenerate for the assigned engineer, and a
// regeneration in progress or a replacement draft waiting for a decision,
// with a switch between the saved draft and the replacement.
export function SectionReviewBar({
  section,
  view,
  onView,
  canReview,
  busy,
  regenerating,
  regenerateProblem,
  onBulkAccept,
  onRegenerate,
  onAcceptReplacement,
  onDiscardReplacement,
}: {
  section: ReviewSection
  view: DraftView
  onView: (view: DraftView) => void
  canReview: boolean
  // A decision on this section is being saved, e.g. 'bulk' or 'discard'.
  busy: string | null
  // Its regeneration is queued or running in the background (GN-13).
  regenerating: boolean
  regenerateProblem: string | null
  onBulkAccept: () => void
  onRegenerate: () => void
  onAcceptReplacement: () => void
  onDiscardReplacement: () => void
}) {
  const { findings, replacement } = section
  return (
    <div className="rv-review-bar">
      {view === 'saved' && (
        <div className="rv-review-row">
          <p className="rv-review-counts">
            <span className="rv-label">Findings</span>{' '}
            <span>{findings.total ? findingCountsLabel(findings) : 'None in this draft'}</span>
          </p>
          {canReview && <Tip id="review.findings" />}
          {canReview && (
            <div className="rv-review-actions" data-walk="review.actions">
              <Button
                pill
                variant="secondary"
                size="sm"
                iconLeft={IconRegistry.action.accept}
                aria-label={`Bulk accept ${plural(findings.pending, 'pending finding')}`}
                disabled={!findings.pending || busy !== null}
                loading={busy === 'bulk'}
                onClick={onBulkAccept}
              >
                {`Bulk accept (${findings.pending})`}
              </Button>
              <Button
                pill
                variant="secondary"
                size="sm"
                iconLeft={IconRegistry.action.regenerate}
                // While it works it keeps its normal look with a spinner (board 15): `loading`
                // alone blocks it without greying it out.
                disabled={!regenerating && (!!replacement || busy !== null)}
                loading={regenerating}
                aria-busy={regenerating || undefined}
                onClick={onRegenerate}
              >
                {regenerating ? 'Regenerating' : 'Regenerate'}
              </Button>
            </div>
          )}
          {canReview && <Tip id="review.regenerate" align="right" />}
        </div>
      )}
      {regenerateProblem && (
        <div role="alert">
          <Callout tone="warning" title="The section was not regenerated">
            {regenerateProblem} The saved draft is unchanged.
          </Callout>
        </div>
      )}
      {replacement && (
        <Callout tone="ai" title="A replacement draft is ready">
          <p style={{ margin: 0 }}>
            Regenerated {formatDayTime(new Date(replacement.requestedAt))}
            {replacement.requestedBy ? ` by ${replacement.requestedBy.name}` : ''}
            {replacement.instruction ? ', asked to: ' : '.'}
          </p>
          {replacement.instruction && (
            <blockquote className="rv-instruction">{replacement.instruction}</blockquote>
          )}
          <p style={{ margin: '4px 0 0' }}>
            The saved draft stays the section's content until you accept the replacement. Discarding
            it leaves the saved draft as it is.
          </p>
          <div className="rv-review-row rv-replacement-row">
            <SegmentedControl
              ariaLabel="Draft shown"
              value={view}
              onChange={onView}
              options={[
                { value: 'saved', label: 'Saved draft' },
                { value: 'replacement', label: 'Replacement' },
              ]}
            />
            {canReview && (
              <div className="rv-review-actions">
                <Button
                  pill
                  variant="danger-tonal"
                  size="sm"
                  iconLeft={IconRegistry.action.discard}
                  disabled={busy !== null}
                  loading={busy === 'discard'}
                  onClick={onDiscardReplacement}
                >
                  Discard replacement
                </Button>
                <Button
                  pill
                  variant="primary"
                  size="sm"
                  iconLeft={IconRegistry.action.accept}
                  disabled={busy !== null}
                  onClick={onAcceptReplacement}
                >
                  Accept replacement
                </Button>
              </div>
            )}
          </div>
        </Callout>
      )}
    </div>
  )
}

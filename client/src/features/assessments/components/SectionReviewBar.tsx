import { Button, Callout, IconRegistry } from '../../../design-system'
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
          {canReview && (
            <div className="rv-review-actions">
              <Button
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
                variant="secondary"
                size="sm"
                iconLeft={IconRegistry.action.regenerate}
                disabled={regenerating || !!replacement || busy !== null}
                onClick={onRegenerate}
              >
                Regenerate
              </Button>
            </div>
          )}
        </div>
      )}
      {regenerating && (
        <div role="status">
          <Callout tone="ai" title={`Regenerating section ${section.id}`}>
            Drafting takes a minute or two. The saved draft and your decisions on it stay as they
            are until you accept the replacement, and you can keep reviewing meanwhile.
          </Callout>
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
            <div className="rv-segmented" role="group" aria-label="Draft shown">
              <Button
                variant={view === 'saved' ? 'tonal' : 'ghost'}
                size="sm"
                aria-pressed={view === 'saved'}
                onClick={() => onView('saved')}
              >
                Saved draft
              </Button>
              <Button
                variant={view === 'replacement' ? 'tonal' : 'ghost'}
                size="sm"
                aria-pressed={view === 'replacement'}
                onClick={() => onView('replacement')}
              >
                Replacement
              </Button>
            </div>
            {canReview && (
              <div className="rv-review-actions">
                <Button
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

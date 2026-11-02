// What the Review screen shows when there is no proposal to edit (CP-22):
// still loading, still being read, failed (with Retry), or already created.
import { EmptyState } from '../../../design-system'
import type { SiteWalk } from '../api'

// Explains why a walk has no editable proposal and offers Retry when failed.
export function WalkStatusMessage({
  walk,
  problem,
  onRetry,
}: {
  walk: SiteWalk | null
  problem: string | null
  onRetry: () => void
}) {
  let text = problem ?? 'Opening the proposal…'
  if (walk?.status === 'failed')
    text = walk.error ?? 'The walk could not be read. Retry, or record it again.'
  else if (walk?.status === 'created') text = 'Everything from this walk is on the assessment.'
  else if (walk && walk.status !== 'ready')
    text = 'This walk is still being read. We’ll let you know when it’s ready.'
  return (
    <div className="ob-card" role={problem || walk?.status === 'failed' ? 'alert' : 'status'}>
      <EmptyState
        icon={walk?.status === 'failed' ? 'circle-alert' : 'loader'}
        title={text}
        action={
          walk?.status === 'failed' ? (
            <button type="button" className="ob-button ob-button--primary" onClick={onRetry}>
              Retry
            </button>
          ) : undefined
        }
      />
    </div>
  )
}

// One site walk as a compact row on the Site Walk Proposals list (CP-22 round 3,
// columns round 4): its name over when it was and what it holds | up to four
// photos | where it stands, a tinted pill centred in its own column | Retry and
// Delete (shown on hover) | the chevron. Every row keeps every column, so they
// line up down the list. The whole row opens the
// walk; a ready one says whether it can be added as it is or what is left to
// fix, the same words its review shows. Rendered by screens/SiteWalks.tsx.
import { Icon } from '../../../design-system'
import { plural } from '../../assessments/reviewDisplay'
import type { SiteWalk } from '../api'
import { incompleteCount } from '../proposal'
import { STATUS, walkName, walkProblem, walkWhen } from '../walkLabels'

const ACTION = { recording: 'Continue', ready: 'Review' } as const
// Thumbnails shown before "+N".
const MAX_THUMBS = 4

// Where the walk stands: words, icon and tone for its pill.
function stateOf(walk: SiteWalk) {
  const status = walk.status
  if (status === 'ready') {
    // As its review's header says (ProposalHeader.tsx): Create all refuses an empty one.
    if (!walk.proposal?.observations.length)
      return { words: 'No observations', icon: null, tone: 'grey' }
    const left = incompleteCount(walk.proposal)
    return left
      ? { words: `${left} to fix`, icon: 'circle-alert', tone: 'red' }
      : { words: 'Ready to add', icon: 'circle-check', tone: 'green' }
  }
  if (status === 'created') return { words: 'Added', icon: 'circle-check', tone: 'green' }
  if (status === 'failed') return { words: STATUS.failed, icon: 'circle-alert', tone: 'red' }
  if (status === 'recording') return { words: STATUS.recording, icon: null, tone: 'red' }
  return { words: STATUS[status], icon: 'loader', tone: 'navy' }
}

// "Mon 2 Nov, 11:36 · 3 locations · 5 observations"; what failed, on a failed walk.
function detailOf(walk: SiteWalk) {
  const p = walk.proposal
  const holds = p
    ? [plural(p.locations.length, 'location'), plural(p.observations.length, 'observation')]
    : []
  return [walkWhen(walk), ...holds].join(' · ')
}

export function WalkRow({
  walk,
  onOpen,
  onRetry,
  onDelete,
}: {
  walk: SiteWalk
  // Each left out where this person can't do it (RV-11 AC2).
  onOpen?: () => void
  onRetry?: () => void
  onDelete?: () => void
}) {
  const status = walk.status
  const name = walkName(walk)
  const opens = status !== 'created' && !!onOpen
  const state = stateOf(walk)
  const thumbs = walk.photos.slice(0, MAX_THUMBS)
  const more = walk.photos.length - thumbs.length
  return (
    <li className="wr" data-status={status}>
      <div className="wr-name">
        {opens ? (
          // Its ::after stretches over the whole row, so a tap anywhere opens it.
          <button
            type="button"
            className="wr-open"
            aria-label={`${ACTION[status as keyof typeof ACTION] ?? 'Open'} ${name}, ${walkWhen(walk)}. ${state.words}`}
            onClick={onOpen}
          >
            {name}
          </button>
        ) : (
          <span className="wr-title">{name}</span>
        )}
        <span className="wr-when">{detailOf(walk)}</span>
        {status === 'failed' && <span className="wr-problem">{walkProblem(walk)}</span>}
      </div>
      <div
        className="wr-seen"
        {...(thumbs.length > 0 && {
          role: 'img',
          'aria-label': plural(walk.photos.length, 'photo'),
        })}
      >
        {thumbs.map((p) => (
          <img key={p.id} src={p.url} alt="" loading="lazy" />
        ))}
        {more > 0 && <span className="wr-more">+{more}</span>}
      </div>
      <div className="wr-status-cell">
        <span className="wr-state" data-tone={state.tone} aria-hidden="true">
          {state.tone === 'grey' ? null : state.icon ? (
            <Icon
              name={state.icon}
              size={15}
              className={state.icon === 'loader' ? 'ob-spin' : undefined}
            />
          ) : (
            <span className="wr-dot" />
          )}
          {state.words}
        </span>
      </div>
      <div className="wr-actions">
        {status === 'failed' && onRetry && (
          <button
            type="button"
            className="wr-icon"
            aria-label={'Retry ' + name}
            title="Retry"
            onClick={onRetry}
          >
            <Icon name="rotate-ccw" size={17} />
          </button>
        )}
        {status !== 'created' && onDelete && (
          <button
            type="button"
            className="wr-icon wr-delete"
            aria-label={'Delete ' + name}
            title="Delete"
            onClick={onDelete}
          >
            <Icon name="trash-2" size={17} />
          </button>
        )}
      </div>
      <span className="wr-chevron" aria-hidden="true">
        {opens && <Icon name="chevron-right" size={18} />}
      </span>
    </li>
  )
}

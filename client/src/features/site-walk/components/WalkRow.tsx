// One site walk as a compact row on the Site Walk Proposals list (CP-22 round 3,
// columns round 4, v2 in CP-24): its name over when it was and what it holds | up to four
// photos | where it stands, in words with one mark (WalkState) | Retry and
// Delete, round icon buttons | the chevron. Every row keeps every column, so they
// line up down the list. The whole row opens the
// walk; a ready one says whether it can be added as it is or what is left to
// fix, the same words its review shows. Rendered by screens/SiteWalks.tsx.
import { Icon, IconAction } from '../../../design-system'
import { plural } from '../../assessments/reviewDisplay'
import type { SiteWalk } from '../api'
import { incompleteWords, lacksValue } from '../proposal'
import { STATUS, walkName, walkProblem, walkWhen } from '../walkLabels'
import { WalkState, type WalkMark } from './WalkState'

const ACTION = { recording: 'Continue', ready: 'Review' } as const
// Thumbnails shown before "+N".
const MAX_THUMBS = 4

// Where the walk stands: its words and the one mark beside them.
function stateOf(walk: SiteWalk): { words: string; mark: WalkMark } {
  const status = walk.status
  if (status === 'ready') {
    // As its review's header says (ProposalHeader.tsx): Create all refuses an empty one.
    if (!walk.proposal?.observations.length) return { words: 'No observations', mark: null }
    return walk.proposal.observations.some(lacksValue)
      ? { words: incompleteWords(walk.proposal), mark: 'failed' }
      : { words: 'Ready to add', mark: 'done' }
  }
  if (status === 'created') return { words: 'Added', mark: 'done' }
  if (status === 'failed') return { words: STATUS.failed, mark: 'failed' }
  if (status === 'recording') return { words: STATUS.recording, mark: 'live' }
  return { words: STATUS[status], mark: 'working' }
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
  first = false,
}: {
  walk: SiteWalk
  // Each left out where this person can't do it (RV-11 AC2).
  onOpen?: () => void
  onRetry?: () => void
  onDelete?: () => void
  // The list's first row: the "Review a site walk" walkthrough opens it (F-12).
  first?: boolean
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
            data-walk={first ? 'site-walk.first-open' : undefined}
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
        <WalkState words={state.words} mark={state.mark} />
      </div>
      <div className="wr-actions">
        {status === 'failed' && onRetry && (
          <IconAction icon="rotate-ccw" label={'Retry ' + name} tooltip="Retry" onClick={onRetry} />
        )}
        {status !== 'created' && onDelete && (
          <IconAction
            icon="trash-2"
            label={'Delete ' + name}
            tooltip={status === 'ready' ? 'Delete proposal' : 'Delete site walk'}
            danger
            onClick={onDelete}
          />
        )}
      </div>
      <span className="wr-chevron" aria-hidden="true">
        {opens && <Icon name="chevron-right" size={18} />}
      </span>
    </li>
  )
}

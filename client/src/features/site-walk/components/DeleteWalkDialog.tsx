// Confirms deleting a site walk or its proposal (CP-22 AC14, round 3; wording round 4):
// says exactly what goes, with counts, and that it cannot be undone, the key
// words in bold. The assessment does not change. Used by
// assessments/screens/SiteWalks.tsx; deleted through api.ts discardWalk.
import { Button, Dialog } from '../../../design-system'
import { plural } from '../../assessments/reviewDisplay'
import type { SiteWalk } from '../api'
import { walkName } from '../walkLabels'
import { DialogProblem } from './DialogProblem'

// "2 recordings, 1 note, 3 photos and 5 proposed observations": only what it holds.
function holdings(walk: SiteWalk) {
  const parts = [
    walk.recordings.length && plural(walk.recordings.length, 'recording'),
    walk.notes.length && plural(walk.notes.length, 'note'),
    walk.photos.length && plural(walk.photos.length, 'photo'),
    walk.proposal?.observations.length &&
      plural(walk.proposal.observations.length, 'proposed observation'),
  ].filter((x): x is string => !!x)
  if (!parts.length) return null
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1)
}

export function DeleteWalkDialog({
  walk,
  busy,
  problem,
  onConfirm,
  onClose,
}: {
  walk: SiteWalk
  busy: boolean
  // Why the delete was refused, e.g. Create all has started.
  problem: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const held = holdings(walk)
  // A walk still recording, being read or that failed has no proposal yet, so it is named a site walk.
  const what = walk.status === 'ready' || walk.proposal ? 'proposal' : 'site walk'
  return (
    <Dialog
      title={`Delete this ${what}?`}
      description={
        <>
          <strong>“{walkName(walk)}”</strong> will be deleted for good
          {held && (
            <>
              , with its <strong>{held}</strong>
            </>
          )}
          . <strong>You can’t undo this.</strong> Nothing already in the assessment changes.
        </>
      }
      width={480}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button pill variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button pill variant="danger" loading={busy} onClick={onConfirm}>
            Delete {what}
          </Button>
        </>
      }
    >
      <DialogProblem
        title={what === 'proposal' ? 'Proposal not deleted' : 'Site walk not deleted'}
        problem={problem}
      />
    </Dialog>
  )
}

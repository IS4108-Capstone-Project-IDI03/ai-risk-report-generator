// The "already handled" dialog (F-10 round 3, boards 23): shown when a To do row's thing was
// already dealt with. One way out, Move to Done, so there is no X and Esc does nothing.
// Called by screens/Inbox.tsx. Calls the design system's Dialog, Button and Icon, PersonAvatar.
import { Button, Dialog, Icon } from '../../../design-system'
import { PersonAvatar } from '../../assignment/components/PersonAvatar'
import { formatBellWhen } from '../../notifications/formatWhen'
import type { Handled } from '../alreadyHandled'

/** Returns the dialog saying who already dealt with a row, with Move to Done as its one way out. */
export function AlreadyHandledDialog({
  handled,
  meId,
  onMove,
}: {
  handled: Handled
  // The signed-in user's id: their own action reads "You".
  meId: string
  onMove: () => void
}) {
  const { by, at } = handled
  return (
    <Dialog
      className="ds-dialog--v2 inbox-handled"
      width={380}
      title={handled.title}
      description={
        // No name known (a delete, or an older action): no line at all.
        by && (
          <>
            <PersonAvatar name={by.name} size={24} />
            <span className="inbox-handled__name">{by.id === meId ? 'You' : by.name}</span>
            {/* A space so a screen reader doesn't run the name into the time. */}{' '}
            {at && (
              <time className="inbox-handled__time" dateTime={at}>
                {formatBellWhen(at)}
              </time>
            )}
          </>
        )
      }
      footer={
        <Button variant="primary" pill iconLeft="check" onClick={onMove} autoFocus>
          Move to Done
        </Button>
      }
    >
      <span className="inbox-handled__badge" aria-hidden="true">
        <Icon name="check" size={24} color="var(--green-600)" />
      </span>
    </Dialog>
  )
}

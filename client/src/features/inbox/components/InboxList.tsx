// The Inbox's card of rows (F-10): the rows, a Load more at the foot when the gateway holds
// more, and the empty states. Used by screens/Inbox.tsx. Renders InboxRow and AllDone.
import { Button, Callout } from '../../../design-system'
import type { Notification } from '../../notifications/api'
import type { UseInbox } from '../useInbox'
import { useKeepRowFocus } from '../useKeepRowFocus'
import { AllDone } from './AllDone'
import { rowOf } from '../row'
import { InboxRow } from './InboxRow'

export function InboxList({
  inbox,
  phone,
  onOpen,
  onTick,
  onBin,
}: {
  inbox: UseInbox
  phone: boolean
  onOpen: (item: Notification) => void
  onTick: (item: Notification) => void
  onBin: (item: Notification) => void
}) {
  const { tab, items, loaded, failed, phases, fresh } = inbox
  const dueColumn = items.some((item) => rowOf(item).showsDue)
  const { card, onFocus } = useKeepRowFocus(items.map((item) => item.id))
  if (failed && !loaded)
    return (
      <div role="alert">
        <Callout
          tone="danger"
          title="Inbox not loaded"
          actions={
            <Button variant="secondary" size="sm" onClick={inbox.reload}>
              Try again
            </Button>
          }
        >
          The gateway could not be reached. Check your connection, then try again.
        </Callout>
      </div>
    )
  // Nothing to show while the first page is on its way: not "All done", which would be wrong.
  if (!loaded)
    return (
      <p role="status" className="ds-sr-only">
        Loading Inbox
      </p>
    )
  return (
    <>
      <section
        ref={card}
        onFocus={onFocus}
        className="inbox-card"
        aria-label={tab === 'todo' ? 'To do' : 'Done'}
      >
        {items.length === 0 ? (
          tab === 'todo' ? (
            <AllDone draw={inbox.cleared} />
          ) : (
            <p className="inbox-empty inbox-empty--quiet">Nothing in Done yet</p>
          )
        ) : (
          <ul>
            {items.map((item) => (
              <InboxRow
                key={item.id}
                item={item}
                tab={tab}
                phase={phases[item.id]}
                fresh={fresh.has(item.id)}
                dueColumn={dueColumn}
                phone={phone}
                onOpen={onOpen}
                onTick={onTick}
                onBin={onBin}
              />
            ))}
          </ul>
        )}
      </section>
      {inbox.hasMore && (
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          onClick={inbox.loadMore}
          disabled={inbox.loadingMore}
        >
          {inbox.loadingMore ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </>
  )
}

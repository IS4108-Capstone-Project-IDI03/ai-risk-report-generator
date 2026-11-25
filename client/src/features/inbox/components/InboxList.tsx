// The Inbox's card of rows (F-10): the rows, a Load more at the foot when the gateway holds
// more, and the empty states. Used by screens/Inbox.tsx. Renders InboxRow, AllDone and NothingDone.
import { Button, Callout } from '../../../design-system'
import type { Notification } from '../../notifications/api'
import type { UseInbox } from '../useInbox'
import { useKeepRowFocus } from '../useKeepRowFocus'
import { AllDone } from './AllDone'
import { rowOf } from '../row'
import { InboxRow } from './InboxRow'
import { NothingDone } from './NothingDone'

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
          Can't reach the server. Check your connection, then try again.
        </Callout>
      </div>
    )
  // Nothing to show while the first page is on its way: not "All done", which would be wrong.
  // A card of grey bars the height of the empty state, so the page doesn't jump when rows arrive.
  if (!loaded)
    return (
      <section className="inbox-card inbox-card--loading" aria-busy="true" aria-label="Inbox">
        <p role="status" className="ds-sr-only">
          Loading Inbox
        </p>
        {[0, 1, 2].map((i) => (
          <div key={i} className="inbox-skeleton" aria-hidden="true">
            <span className="inbox-skeleton__dot" />
            <span className="inbox-skeleton__bars">
              <span />
              <span />
            </span>
          </div>
        ))}
      </section>
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
            <NothingDone />
          )
        ) : (
          <ul>
            {items.map((item, i) => (
              <InboxRow
                key={item.id}
                first={i === 0}
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

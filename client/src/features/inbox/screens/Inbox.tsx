// The Inbox screen (F-10): what needs this person, as a mail list crossed with a checklist.
// Rendered by AssessmentApp at /inbox. Calls useInbox (the list) and useInboxActions (what a
// person does to a row); draws the top bar, the To do / Done tabs and InboxList.
import type * as React from 'react'
import { SegmentedControl, TopBar, useIsPhone } from '../../../design-system'
import { useNotificationCounts } from '../../notifications/useNotificationCounts'
import { InboxList } from '../components/InboxList'
import { useInbox } from '../useInbox'
import { useInboxActions } from '../useInboxActions'
import '../inbox.css'

export function Inbox({ eyebrow, bell }: { eyebrow: string; bell?: React.ReactNode }) {
  const inbox = useInbox()
  const act = useInboxActions(inbox)
  const phone = useIsPhone()
  const { counts } = useNotificationCounts()
  return (
    <div className="inbox-page">
      <TopBar
        eyebrow={phone ? undefined : eyebrow}
        title="Inbox"
        helper={phone ? undefined : 'Work that needs you. Open an item, and it moves to Done.'}
        bell={bell}
      />
      <div className="inbox-content">
        <div className="inbox-tabs">
          <SegmentedControl
            ariaLabel="Inbox"
            value={inbox.tab}
            onChange={inbox.setTab}
            options={[
              { value: 'todo', label: 'To do', count: counts.inboxTodo },
              { value: 'done', label: 'Done' },
            ]}
          />
        </div>
        {/* Spoken only. Stays mounted, as a live region must exist before its words change;
            without it a new row or the empty state would appear with no cue for a screen reader. */}
        <p role="status" className="ds-sr-only">
          {inbox.cleared
            ? 'Nothing left in To do'
            : inbox.fresh.size > 0
              ? `New in To do: ${inbox.fresh.size}`
              : ''}
        </p>
        {/* Keyed by tab: a new tab's list fades in rising 4 px (inbox.css). */}
        <div key={inbox.tab} className="inbox-panel">
          <InboxList
            inbox={inbox}
            phone={phone}
            onOpen={act.open}
            onTick={(item) => (inbox.tab === 'todo' ? act.tick(item) : act.untick(item))}
            onBin={act.bin}
          />
        </div>
      </div>
    </div>
  )
}

// The activity popover's body (F-11): a thin header, as the bell's has, then
// what waits on you, then what is in progress: failed first, since it needs
// someone, then running, then queued. A group with no rows is left out. Takes
// the rows; owns no fetching. Called by ActivityButton.
import type { BackgroundWorkRow } from '../api'
import { BackgroundWorkItem } from './BackgroundWorkItem'
import '../../notifications/notifications.css'

const IN_PROGRESS: BackgroundWorkRow['state'][] = ['failed', 'running', 'queued']

export function BackgroundWorkList({
  rows,
  onOpen,
  onRetried,
}: {
  rows: BackgroundWorkRow[]
  // Closes the popover as a row opens its job.
  onOpen: () => void
  // Reads the list again after a Try again.
  onRetried: () => void
}) {
  const groups: [string, BackgroundWorkRow[]][] = [
    ['Waiting on you', rows.filter((r) => r.state === 'waiting_on_you')],
    ['In progress', IN_PROGRESS.flatMap((state) => rows.filter((r) => r.state === state))],
  ]
  return (
    <div className="notification-list bgw-list">
      <header className="notification-list__header">
        <h2>Background work</h2>
      </header>
      <div className="notification-list__body">
        {groups.map(
          ([name, group]) =>
            group.length > 0 && (
              <section key={name} role="group" aria-label={name} className="bgw-group">
                <h3 className="bgw-group__name">{name}</h3>
                <ul>
                  {group.map((row) => (
                    <BackgroundWorkItem
                      key={row.id}
                      row={row}
                      onOpen={onOpen}
                      onRetried={onRetried}
                    />
                  ))}
                </ul>
              </section>
            ),
        )}
      </div>
    </div>
  )
}

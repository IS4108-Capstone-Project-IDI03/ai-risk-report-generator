// Remembers the rows a person opened from the Inbox, so that coming back with the browser's
// Back shows each one ticked and then leaving (spec "Motion", F-10). Any other way of arriving
// at the Inbox shows the row already gone. Read by useInbox.ts; written by useInboxActions.ts.
// Kept outside React because the Inbox is unmounted while the opened screen is showing.
import type { Notification } from '../notifications/api'

const opened = new Map<string, Notification>()
let backAt = 0
// Back lands on the Inbox within a moment of the press; a later arrival is not a Back.
const BACK_WINDOW_MS = 1500

// Only a real Back or Forward counts. openSubject sends a made-up popstate to move to a
// page, which is not trusted, so opening a row never looks like coming back.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => {
    if (event.isTrusted) backAt = Date.now()
  })
}

/** Records a row that was opened, as it looked, so Back can show it leaving. */
export function rememberOpened(item: Notification) {
  opened.set(item.id, item)
}

/** Returns the opened rows when this arrival is a Back, else none. Does not forget them. */
export function returnedByBack(now = Date.now()): Notification[] {
  return now - backAt <= BACK_WINDOW_MS ? [...opened.values()] : []
}

/** Forgets every opened row and the Back that brought us here; the Inbox calls this once it has used them. */
export function forgetOpened() {
  opened.clear()
  // A Back is used up by the Inbox it lands on, so a later arrival is never taken for it.
  backAt = 0
}

// The tile tone for a notification's context status. CB-07 UI polish. Used by NotificationIcon.
import type { IconTileTone } from '../../../design-system'

// Context statuses by tone. Anything else (no status, a new request) is ink blue.
const TONES: [string[], IconTileTone][] = [
  [['failed', 'error'], 'danger'],
  [['needs_review', 'warning', 'withdrawn', 'due_soon'], 'warn'],
  [['complete', 'filled', 'done', 'ready'], 'good'],
  [['dismissed'], 'neutral'],
]

/** Returns the IconTile tone for a context status: danger, warn, good, neutral, else ink. */
export function toneFor(status: string | undefined): IconTileTone {
  return TONES.find(([statuses]) => status && statuses.includes(status))?.[1] ?? 'ink'
}

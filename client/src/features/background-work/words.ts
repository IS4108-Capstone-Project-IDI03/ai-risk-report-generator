// The words the activity icon and popover use for background work (F-11).
import type { BackgroundWorkRow } from './api'

// "1 running, 2 failed": the states that have rows, in this order.
const STATE_WORDS: [BackgroundWorkRow['state'], string][] = [
  ['waiting_on_you', 'waiting on you'],
  ['failed', 'failed'],
  ['running', 'running'],
  ['queued', 'queued'],
]

/** Returns the activity icon's name: "Background work, 1 running, 2 failed". */
export function activityLabel(rows: BackgroundWorkRow[]): string {
  const parts = STATE_WORDS.flatMap(([state, word]) => {
    const count = rows.filter((r) => r.state === state).length
    return count ? [`${count} ${word}`] : []
  })
  return `Background work, ${parts.join(', ')}`
}

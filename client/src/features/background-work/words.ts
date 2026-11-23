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

type Progress = BackgroundWorkRow['progress']

/** Returns "Stage 2 of 3 · Chunking", or just the stage when it has no number. */
export function stageWords({ stage, step, steps }: Progress): string {
  const numbered = step && steps ? `Stage ${step} of ${steps}` : ''
  return [numbered, stage].filter(Boolean).join(' · ')
}

/** Returns "12 of 40 pages", or "12 pages" while the total is unknown. */
export function countWords({ current = 0, total, unit = '' }: Progress): string {
  return (total ? `${current} of ${total} ${unit}` : `${current} ${unit}`).trim()
}

/**
 * Returns "Describing photos · 3 min": the step and how long it has run, in
 * whole minutes, since the list refreshes every few seconds. Just the step
 * when the gateway doesn't know when it began.
 */
export function timedWords(step: string, startedAt?: string, now = Date.now()): string {
  if (!startedAt) return step
  const minutes = Math.floor((now - new Date(startedAt).getTime()) / 60_000)
  const hours = Math.floor(minutes / 60)
  const elapsed =
    minutes < 1
      ? 'under 1 min'
      : hours
        ? `${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
        : `${minutes} min`
  return `${step} · ${elapsed}`
}

// Reading status cell (CP-23, v2 section 6): words + a 16 px indicator at the right edge.
// Called by the reading screen's file rows. Calls Icon.
import { useState } from 'react'
import { Icon } from '../core/Icon'

export type ReadingStatusProps = {
  // working = words + spinner, waiting = "Waiting" + hollow circle, done = green tick only.
  state: 'working' | 'waiting' | 'done'
  // The words while working, e.g. "Reading the email".
  label?: string
}

/** Returns the cell; spinner, circle and tick are all 16 px and share one right-hand column. */
export function ReadingStatus({ state, label = 'Reading' }: ReadingStatusProps) {
  // The last two phrases, so they can crossfade (v2 section 8).
  const [words, setWords] = useState({ now: label, was: '' })
  if (words.now !== label) setWords({ now: label, was: words.now })
  return (
    <span className="ds-reading" data-state={state}>
      {state === 'working' && words.was ? (
        <span key={words.was} className="ds-reading-was" data-was={words.was} aria-hidden="true" />
      ) : null}
      {/* Keyed by the words, so a new phrase fades in over 120 ms (v2 section 8). */}
      {state === 'working' ? (
        <span key={label} className="ds-reading-words">
          {label}
        </span>
      ) : state === 'waiting' ? (
        <span className="ds-reading-words ds-reading-waiting">Waiting</span>
      ) : null}
      <span className="ds-reading-mark">
        {state === 'working' ? (
          <Icon name="loader-circle" size={16} className="ds-reading-spin" />
        ) : state === 'waiting' ? (
          <span className="ds-reading-circle" />
        ) : (
          <svg viewBox="0 0 16 16" width="16" height="16" role="img" aria-label="Done">
            <circle cx="8" cy="8" r="8" fill="var(--green-600)" />
            <path className="ds-reading-tick" d="M4.6 8.3l2.3 2.3 4.5-4.7" />
          </svg>
        )}
      </span>
    </span>
  )
}

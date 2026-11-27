// Section row (GN-13, NEW pattern): a grey number tile, the name, then one mark at the right
// edge (a RowMark or a RowCount). `flag` gives it the flagged row look: tinted row, tinted tile,
// a short reason under the name (amber = missing or out of date, red = failed). A flag that
// arrives later fades in, its reason sliding down 3 px (motion 5). Used by Generation's steps.
// With `onSelect` it is a navigation row (the report outline in Review and the document editor):
// a button, `current` tinting it ink with a navy tile, and `note` a grey line under the name.
import type * as React from 'react'
import { useState } from 'react'
import './steps.css'

export type SectionRowProps = {
  number: string
  name: string
  mark?: React.ReactNode
  flag?: 'warn' | 'bad'
  // A few words under the name; only shown on a flagged row.
  reason?: React.ReactNode
  // Navigation row: what choosing it does, whether it is the part open, the grey line under
  // the name (state words, badges) and its walkthrough tag (F-12).
  onSelect?: () => void
  current?: boolean
  note?: React.ReactNode
  walk?: string
}

/** Returns one row of a step card, or a navigation row (a button) when given `onSelect`. */
export function SectionRow({
  number,
  name,
  mark,
  flag,
  reason,
  onSelect,
  current,
  note,
  walk,
}: SectionRowProps) {
  // The flag it was drawn with: a reason present on page load doesn't animate.
  const [first] = useState(flag)
  const inside = (
    <>
      <span className="ds-srow-num">{number}</span>
      <span className="ds-srow-name">
        <span className="ds-srow-title">{name}</span>
        {flag && reason ? (
          <span className="ds-srow-reason" data-in={flag !== first ? '' : undefined}>
            {reason}
          </span>
        ) : null}
        {note ? <span className="ds-srow-note">{note}</span> : null}
      </span>
      <span className="ds-srow-end">{mark}</span>
    </>
  )
  if (onSelect)
    return (
      <button
        type="button"
        className="ds-srow ds-srow-nav"
        data-flag={flag}
        aria-current={current ? 'true' : undefined}
        data-walk={walk}
        onClick={onSelect}
      >
        {inside}
      </button>
    )
  return (
    <div className="ds-srow" data-flag={flag}>
      {inside}
    </div>
  )
}

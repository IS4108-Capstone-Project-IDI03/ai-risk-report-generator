// Section row (GN-13, NEW pattern): a grey number tile, the name, then one mark at the right
// edge (a RowMark or a RowCount). `flag` gives it the flagged row look: tinted row, tinted tile,
// a short reason under the name (amber = missing or out of date, red = failed). A flag that
// arrives later fades in, its reason sliding down 3 px (motion 5). Used by Generation's steps.
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
}

/** Returns one row of a step card. */
export function SectionRow({ number, name, mark, flag, reason }: SectionRowProps) {
  // The flag it was drawn with: a reason present on page load doesn't animate.
  const [first] = useState(flag)
  return (
    <div className="ds-srow" data-flag={flag}>
      <span className="ds-srow-num">{number}</span>
      <span className="ds-srow-name">
        {name}
        {flag && reason ? (
          <span className="ds-srow-reason" data-in={flag !== first ? '' : undefined}>
            {reason}
          </span>
        ) : null}
      </span>
      <span className="ds-srow-end">{mark}</span>
    </div>
  )
}

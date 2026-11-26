// Figure tile (RV-13, NEW pattern; the CP-29 Insights figure tile as one shared piece): a
// count in a white tile with a small tone tile for what it counts. With `onPress` it is a toggle
// button (`aria-pressed`) that filters a list, as the Comparison tab's outcome tiles do.
// Called by comparison/ComparisonTab, the clients' Insights tab and Usage and costs. Calls IconTile.
import type * as React from 'react'
import { IconTile } from './IconTile'
import './figure-tile.css'

export type FigureTone = 'neutral' | 'danger' | 'warn' | 'good' | 'ink'

export type FigureTileProps = {
  label: string
  // A (?) help tip, drawn right after the label.
  help?: React.ReactNode
  value: number | string
  icon: string
  tone?: FigureTone
  // A short grey line under the label.
  note?: React.ReactNode
  // Toggle: what pressing it does, and whether it is on.
  onPress?: () => void
  pressed?: boolean
  // The screen-reader name of a pressable tile (defaults to "value label").
  ariaLabel?: string
}

/** Returns the tile; a toggle button when given `onPress`. */
export function FigureTile({
  label,
  help,
  value,
  icon,
  tone = 'neutral',
  note,
  onPress,
  pressed = false,
  ariaLabel,
}: FigureTileProps) {
  const body = (
    <>
      <IconTile icon={icon} tone={tone} className="ds-figure-icon" />
      <span className="ds-figure-text">
        <span className="ds-figure-value">{value}</span>
        <span className="ds-figure-label">
          {label}
          {help}
        </span>
        {note ? <span className="ds-figure-note">{note}</span> : null}
      </span>
    </>
  )
  return onPress ? (
    <button
      type="button"
      className="ds-figure"
      aria-pressed={pressed}
      aria-label={ariaLabel ?? `${value} ${label}`}
      onClick={onPress}
    >
      {body}
    </button>
  ) : (
    <div className="ds-figure">{body}</div>
  )
}

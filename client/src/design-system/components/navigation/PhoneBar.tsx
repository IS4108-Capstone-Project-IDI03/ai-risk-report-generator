// The phone's one top bar (CP-23, board 21): panel icon, stacked wordmark, bell.
// Called by AssessmentApp below 768px. Opening the drawer is its only job.
import type * as React from 'react'
import { Icon } from '../core/Icon'
import './shell.css'

export type PhoneBarProps = {
  onMenu: () => void
  bell?: React.ReactNode
  // A drilled-in screen (capture) swaps the menu for a back arrow and shows its own title.
  back?: { label: string; title: string; onClick: () => void }
}

/** Returns the 56px navy phone bar; the panel button's label is "Open navigation". */
export function PhoneBar({ onMenu, bell, back }: PhoneBarProps) {
  return (
    <div className="ds-phonebar ds-on-navy">
      <button
        type="button"
        className="ds-phonebar-button"
        aria-label={back ? back.label : 'Open navigation'}
        onClick={back ? back.onClick : onMenu}
      >
        <Icon name={back ? 'chevron-left' : 'panel-left'} size={20} />
      </button>
      {back ? (
        <h1 className="ds-phonebar-title">{back.title}</h1>
      ) : (
        <div className="ds-phonebar-brand">
          <span className="ds-phonebar-mark">MARSH</span>
          <span className="ds-phonebar-sub">Risk Report Generator</span>
        </div>
      )}
      {bell}
    </div>
  )
}

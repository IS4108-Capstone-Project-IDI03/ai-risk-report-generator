// The phone's one top bar (CP-23, board 21): panel icon, stacked wordmark, bell.
// Called by AssessmentApp below 768px. Opening the drawer is its only job.
import type * as React from 'react'
import { Icon } from '../core/Icon'
import { usePop } from './usePop'
import './shell.css'

export type PhoneBarProps = {
  // The Marsh wordmark file the sidebar uses; without it the bar falls back to text.
  logoSrc?: string
  onMenu: () => void
  // The Inbox's To do count (F-10): a red dot on the menu icon, so it is seen before the
  // drawer opens. The label is what a screen reader hears ("4 to do in Inbox").
  alert?: { count: number; label: string }
  bell?: React.ReactNode
  // A drilled-in screen (capture) swaps the menu for a back arrow and shows its own title.
  back?: { label: string; title: string; onClick: () => void }
}

/** Returns the 56px navy phone bar; the panel button's label is "Open navigation". */
export function PhoneBar({ logoSrc, onMenu, alert, bell, back }: PhoneBarProps) {
  const pops = usePop(alert?.count ?? 0)
  return (
    <div className="ds-phonebar ds-on-navy">
      <button
        type="button"
        className="ds-phonebar-button"
        aria-label={
          back ? back.label : alert?.count ? `Open navigation, ${alert.label}` : 'Open navigation'
        }
        onClick={back ? back.onClick : onMenu}
      >
        <Icon name={back ? 'chevron-left' : 'panel-left'} size={20} />
        {!back && alert?.count ? (
          <span
            key={pops}
            className="ds-phonebar-dot"
            aria-hidden="true"
            data-pop={pops || undefined}
          />
        ) : null}
      </button>
      {back ? (
        <h1 className="ds-phonebar-title">{back.title}</h1>
      ) : (
        <div className="ds-phonebar-brand">
          {logoSrc ? (
            <img className="ds-phonebar-logo" src={logoSrc} alt="Marsh" />
          ) : (
            <span className="ds-phonebar-mark">MARSH</span>
          )}
          <span className="ds-phonebar-sub">Risk Report Generator</span>
        </div>
      )}
      {bell}
    </div>
  )
}

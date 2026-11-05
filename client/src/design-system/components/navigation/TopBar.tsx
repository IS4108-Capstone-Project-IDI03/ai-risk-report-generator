// Top bar (CP-23, v2 section 2): eyebrow, page title, main action, bell.
// Called by every screen. A screen's Back is the round BackButton at the left of the
// title block (board 24). Calls BackButton.
import type * as React from 'react'
import { BackButton } from './BackButton'
import './shell.css'

export type TopBarProps = {
  eyebrow?: string
  title: React.ReactNode
  // One short line under the title saying what a list page is for (v2 section 2).
  helper?: string
  // Next to the title, e.g. chips.
  titleItems?: React.ReactNode
  // The screen's one main action, top right.
  action?: React.ReactNode
  // The bell (a notifications Popover); left out when the screen has none.
  bell?: React.ReactNode
  // The round Back button, inline at the left of the title; list screens pass none.
  back?: { label: string; onClick: () => void }
  // Before the title block, e.g. a client's avatar (client page).
  lead?: React.ReactNode
  // A row under the title inside the bar, e.g. the client page's Tabs.
  tabs?: React.ReactNode
}

/** Returns the white top bar: eyebrow over a 28/700 navy title, action and bell on the right. */
export function TopBar({
  eyebrow,
  title,
  helper,
  titleItems,
  action,
  bell,
  back,
  lead,
  tabs,
}: TopBarProps) {
  return (
    <header className="ds-topbar" data-tabs={tabs ? '' : undefined}>
      {back ? <BackButton label={back.label} onClick={back.onClick} /> : null}
      {lead}
      <div className="ds-topbar-main">
        {eyebrow ? <div className="ds-topbar-eyebrow">{eyebrow}</div> : null}
        <div className="ds-topbar-title">
          <h1>{title}</h1>
          {titleItems}
        </div>
        {helper ? <p className="ds-topbar-helper">{helper}</p> : null}
      </div>
      {action}
      {bell}
      {tabs ? <div className="ds-topbar-tabs">{tabs}</div> : null}
    </header>
  )
}

// One setting in a Settings section (S-01, design system v2): a hairline-separated block
// with its name and quiet helper text at the left and its controls at the right. Narrow, the two
// stack. Called by every screen in screens/. A block with no title is one full-width column.
import type { ReactNode } from 'react'

type Props = {
  title?: string
  // The title's heading level: 4 inside a group that has its own h3 title ("Not used yet").
  titleLevel?: 3 | 4
  // Quiet helper text under the title (13 px, grey).
  help?: ReactNode
  // A save state ("Saving…", "Saved") that sits under the title and help.
  status?: ReactNode
  // Greyed out: a setting nothing reads yet.
  muted?: boolean
  // The body fills the panel instead of stopping at 640 px (a list of rows, like the source tiers).
  wide?: boolean
  children: ReactNode
}

/** Returns the block: head (title, help, status) beside a body of controls. */
export function SettingBlock({
  title,
  titleLevel = 3,
  help,
  status,
  muted,
  wide,
  children,
}: Props) {
  const Title = titleLevel === 4 ? 'h4' : 'h3'
  return (
    <div className="st-block" data-muted={muted || undefined} data-wide={wide || undefined}>
      {(title || help || status) && (
        <div className="st-block-head">
          {title && <Title className="st-block-title">{title}</Title>}
          {help && <div className="st-help">{help}</div>}
          {status}
        </div>
      )}
      <div className="st-block-body">{children}</div>
    </div>
  )
}

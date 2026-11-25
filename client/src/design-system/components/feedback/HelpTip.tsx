// HelpTip (F-13): the one (?) button and popover every help tip shares. Generic: it knows nothing
// about walkthroughs; a feature passes `onShowMe` to add the "Show me" link. On a phone the
// Popover is a bottom sheet. Called by features/help/Tip.tsx and the screens that kept their words.
// Calls Popover, Button, Icon.
import { useState, type ReactNode } from 'react'
import { Button } from '../core/Button'
import { Icon } from '../core/Icon'
import { Popover } from './Popover'
import './help-tip.css'

/** Returns the (?) button; pressing it opens `children` (paragraphs, a list) in a popover. */
export function HelpTip({
  label,
  align = 'left',
  onShowMe,
  children,
}: {
  // Names the button and the popover ("How to review the draft").
  label: string
  align?: 'left' | 'right'
  // Adds the "Show me" link at the foot; it closes the popover first, then calls this.
  onShowMe?: () => void
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel={label}
      align={align}
      surfaceClassName="ds-help-menu"
      // Placed by the (?) button's box on screen, so a card or rail with overflow: hidden cannot clip it (F-12: Overview rail, Checklist card).
      fixed
      trigger={
        <button type="button" className="ds-help" aria-label={label} onClick={() => setOpen(!open)}>
          <Icon name="circle-help" size={18} />
        </button>
      }
    >
      <div className="ds-help-body">
        {children}
        {onShowMe && (
          <span className="ds-help-show">
            <Button
              variant="link-navy"
              size="sm"
              iconLeft="play"
              onClick={() => {
                // Closed first, so the popover is not left over the walkthrough's highlight.
                setOpen(false)
                onShowMe()
              }}
            >
              Show me
            </Button>
          </span>
        )}
      </div>
    </Popover>
  )
}

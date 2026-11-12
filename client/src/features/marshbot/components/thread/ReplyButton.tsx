// One of the engineer's replies in the tray (AS-06 rule 5): always filled, the one primary reply
// solid navy, the rest soft blue. Used by ReplyTray.tsx and, as its trigger, DateReply.tsx.
import type { AriaAttributes } from 'react'
import { Button } from '../../../../design-system'
import type { Reply } from '../../types'

/** Returns the filled reply pill. */
export function ReplyButton({
  reply,
  disabled,
  onClick,
  ...aria
}: {
  reply: Reply
  disabled: boolean
  onClick: () => void
} & AriaAttributes) {
  return (
    <Button
      variant={reply.primary ? 'primary' : 'tonal'}
      pill
      // Held, not disabled, while a reply is on its way: a disabled button drops keyboard focus to
      // the page's top. It says so, and a press does nothing.
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onClick()}
      // The calendar's Popover adds aria-expanded and aria-controls through here.
      {...aria}
      style={{
        height: 'var(--mbt-reply)',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'default' : 'pointer',
        fontWeight: 600,
        minWidth: 0,
        ...(reply.primary
          ? {}
          : { color: 'var(--marsh-navy)', border: '1px solid var(--ink-100)' }),
      }}
    >
      {reply.label}
    </Button>
  )
}

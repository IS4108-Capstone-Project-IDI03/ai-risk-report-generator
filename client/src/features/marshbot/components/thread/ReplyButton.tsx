// One button in the action slot (AS-06 rule 5, round 7): always filled, the primary one solid
// navy, the rest soft blue; one that only opens something (a choice's or card's link) carries an
// arrow. Used by Actions.tsx and, as its trigger, DateReply.tsx.
import type { AriaAttributes } from 'react'
import { Button } from '../../../../design-system'
import type { Reply } from '../../types'

/** Returns the filled reply pill. */
export function ReplyButton({
  reply,
  onClick,
  ...aria
}: {
  reply: Pick<Reply, 'label' | 'primary' | 'link'>
  onClick: () => void
} & AriaAttributes) {
  return (
    <Button
      variant={reply.primary ? 'primary' : 'tonal'}
      pill
      iconRight={reply.link ? 'chevron-right' : undefined}
      onClick={onClick}
      // The calendar's Popover adds aria-expanded and aria-controls through here.
      {...aria}
      style={{
        height: 'var(--mbt-reply)',
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

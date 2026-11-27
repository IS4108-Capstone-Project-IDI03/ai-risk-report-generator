// One button in the action slot (AS-06 rule 5, round 7 and 9): always filled, the primary one solid
// navy, the rest soft blue; a choice that only opens another tab is the secondary button (white,
// outlined) with an arrow. A choice may carry an icon at its left. Shared by the Overview's
// Actions.tsx and DateReply.tsx and the knowledge chat's starters (features/chat/components/Starters.tsx).
import type { AriaAttributes } from 'react'
import { Button } from '../core/Button'
import './conversation.css'

// The parts of a choice the pill draws (features/marshbot/types.ts Reply has these and more).
type Reply = { label: string; primary?: boolean; link?: unknown; icon?: string | null }

// The server sends a lucide icon name ('calendar', 'plus'); the Icon puts it in a URL, so anything
// that is not a plain name draws no icon rather than a broken one.
const ICON_NAME = /^[a-z][a-z0-9-]*$/

/** Returns the filled reply pill. */
export function ReplyButton({
  reply,
  onClick,
  walk,
  ...aria
}: {
  reply: Pick<Reply, 'label' | 'primary' | 'link' | 'icon'>
  onClick: () => void
  // The walkthrough's tag for this button (F-12).
  walk?: string
} & AriaAttributes) {
  // A choice that only opens another tab (no reply is posted) looks unlike one that answers.
  const opens = !reply.primary && !!reply.link
  return (
    <Button
      variant={reply.primary ? 'primary' : opens ? 'secondary' : 'tonal'}
      pill
      iconLeft={reply.icon && ICON_NAME.test(reply.icon) ? reply.icon : undefined}
      iconRight={reply.link ? 'chevron-right' : undefined}
      // ds-press is the Button's own class (press feedback, the 44 px tap area), kept because
      // className here replaces it; mbt-reply lets a long label wrap on a phone (conversation.css).
      className="ds-press mbt-reply"
      data-walk={walk}
      onClick={onClick}
      // The calendar's Popover adds aria-expanded and aria-controls through here.
      {...aria}
      style={{
        height: 'var(--mbt-reply)',
        fontWeight: 600,
        minWidth: 0,
        ...(reply.primary || opens
          ? {}
          : { color: 'var(--marsh-navy)', border: '1px solid var(--ink-100)' }),
      }}
    >
      {reply.label}
    </Button>
  )
}

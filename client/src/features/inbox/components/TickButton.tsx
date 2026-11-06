// The circle that ticks an Inbox row (F-10, boards 01 and 07). On a desktop it is a plain
// 22 px circle; on a phone it is a 40 px ring that holds the row's type icon and ticks when
// tapped, inside a 44 px target. Used by InboxRow. Its fill and tick draw are CSS (inbox.css).
import { Icon } from '../../../design-system'

export function TickButton({
  on,
  label,
  onClick,
  ring,
}: {
  // Ticked: the circle is filled and the tick is drawn.
  on: boolean
  label: string
  onClick: () => void
  // A phone's ring and the icon it holds; undefined is the desktop circle.
  ring?: { icon: string; tone: string }
}) {
  return (
    <button type="button" className="inbox-tick" aria-label={label} onClick={onClick}>
      <span
        className={ring ? 'inbox-check inbox-check--ring' : 'inbox-check'}
        data-on={on || undefined}
        data-tone={ring?.tone}
      >
        {ring && <Icon name={ring.icon} size={18} />}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </button>
  )
}

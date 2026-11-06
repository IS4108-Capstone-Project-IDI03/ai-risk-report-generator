// A 32px icon button (16px glyph) with a design-system tooltip, or 28px with a 14px glyph
// for the bell's thin header (F-10, board 11). CB-07 UI polish (notifications).
// Used by NotificationList's header and NotificationRow's actions.
import { IconButton, Tooltip } from '../../../design-system'

// Keeps aria-label as the accessible name; `title` is cleared so the native
// browser tooltip does not stack on top of the design-system one. The md size gives the
// 16px glyph; the 32px box keeps the header compact (the md default is 40px).
// The tooltip wrapper is a flex box so it adds no baseline gap that would push the button
// off the row's centre line.
export function ActionButton({
  icon,
  label,
  onClick,
  placement = 'bottom',
  box = 32,
}: {
  icon: string
  label: string
  onClick: () => void
  placement?: string
  box?: 28 | 32
}) {
  return (
    <Tooltip label={label} placement={placement} style={{ display: 'flex' }}>
      <IconButton
        icon={icon}
        label={label}
        size={box === 28 ? 'sm' : 'md'}
        onClick={onClick}
        title={undefined}
        className="notif-action"
        style={{ width: box, height: box }}
      />
    </Tooltip>
  )
}

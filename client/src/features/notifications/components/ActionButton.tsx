// A 32px icon button (16px glyph) with a design-system tooltip. CB-07 UI polish (notifications).
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
}: {
  icon: string
  label: string
  onClick: () => void
  placement?: string
}) {
  return (
    <Tooltip label={label} placement={placement} style={{ display: 'flex' }}>
      <IconButton
        icon={icon}
        label={label}
        size="md"
        onClick={onClick}
        title={undefined}
        style={{ width: 32, height: 32 }}
      />
    </Tooltip>
  )
}

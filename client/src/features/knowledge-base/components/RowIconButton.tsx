// A quiet 32 px round icon button with the design system's tooltip (v2 section 2: icons first
// for actions, the tooltip names the action alone). Used by components/DocumentDetails.tsx
// and the other knowledge-base screens; it wraps IconButton and Tooltip.
import type { ComponentProps } from 'react'
import { IconButton, Tooltip } from '../../../design-system'

type IconButtonProps = ComponentProps<typeof IconButton>

/** Returns the icon button; `danger` makes it red (a bin) and `tooltip` defaults to the label. */
export function RowIconButton({
  danger,
  tooltip,
  label,
  style,
  onClick,
  ...rest
}: IconButtonProps & { danger?: boolean }) {
  return (
    <Tooltip label={tooltip ?? label}>
      <IconButton
        {...rest}
        label={label}
        size="sm"
        title={undefined}
        style={{
          borderRadius: 999,
          color: danger ? 'var(--red-600)' : 'var(--graphite-600)',
          ...style,
        }}
        // Stopped here, so a row that opens on click doesn't also open from its own icon.
        onClick={(e) => {
          e.stopPropagation()
          onClick?.(e)
        }}
      />
    </Tooltip>
  )
}

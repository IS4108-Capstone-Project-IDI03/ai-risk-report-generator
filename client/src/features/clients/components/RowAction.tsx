// A row's icon action (CP-23, v2 section 2): a 32 px round icon button with a
// tooltip, or the same look as a link that opens in a new tab.
// Called by ClientTable, SiteCard, AssessmentTable and DocumentRow. Calls IconButton, Tooltip.
import { Icon, IconButton, Tooltip } from '../../../design-system'

type Props = {
  icon: string
  // The accessible name, naming the row's item for a screen reader.
  label: string
  // The hover text: the action alone, never the item's name (round 16).
  tooltip: string
  danger?: boolean
  disabled?: boolean
} & ({ onClick: () => void; href?: undefined } | { href: string; onClick?: undefined })

export function RowAction({ icon, label, tooltip, danger, disabled, onClick, href }: Props) {
  const color = danger ? 'var(--red-600)' : 'var(--graphite-600)'
  return (
    <Tooltip label={tooltip}>
      {href ? (
        <a
          className="cl-icon-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label + ', opens in a new tab'}
          style={{ color }}
        >
          <Icon name={icon} size={16} />
        </a>
      ) : (
        <IconButton
          icon={icon}
          label={label}
          title={undefined}
          size="sm"
          disabled={disabled}
          // Stopped here so a row that opens on click doesn't also open from its own icon.
          onClick={(e) => {
            e.stopPropagation()
            onClick?.()
          }}
          style={{ borderRadius: 999, color }}
        />
      )}
    </Tooltip>
  )
}

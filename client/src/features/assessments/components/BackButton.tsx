// The one back control on every Observations sub-screen and site walk screen
// (CP-22 round 1): a chevron and "Back" everywhere (Jesper, 31 Oct); screen
// readers also hear where it goes. Used by
// the observation page, capture, photos, handwritten pages, deleted
// observations, the site walk recording and its proposal.
import { Icon } from '../../../design-system'
import './back-button.css'

export function BackButton({
  label,
  onClick,
  disabled,
}: {
  // Where it goes, e.g. "Observations", read out as "Back to Observations".
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className="back-button"
      aria-label={'Back to ' + label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon name="chevron-left" size={20} />
      {'Back'}
    </button>
  )
}

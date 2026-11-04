// The round Back button (CP-23, board 24 option B): a chevron in a soft circle.
// Called by TopBar, which puts it left of the page title. Calls Icon.
import { Icon } from '../core/Icon'
import './shell.css'

export type BackButtonProps = {
  // Names the place it goes to, e.g. "Back to Assessments".
  label: string
  onClick: () => void
}

/** Returns the round icon Back button (36px, 40px on phones, 44px hit area). */
export function BackButton({ label, onClick }: BackButtonProps) {
  return (
    <button type="button" className="ds-backbtn" aria-label={label} onClick={onClick}>
      <span className="ds-backbtn-disc">
        <Icon name="chevron-left" size={20} />
      </span>
    </button>
  )
}

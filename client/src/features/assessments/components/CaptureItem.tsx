// One photo or page waiting for Save on New Observation (CP-04, CP-19, CP-24), drawn as the
// shared list row: its small picture (which opens it full size) or icon, its name and the red
// bin. Used by CapturePhotoPanel and CaptureScanPanel inside a `sw-list`.
import type { ReactNode } from 'react'
import { Icon } from '../../../design-system'
import '../../site-walk/site-walk.css'
import '../../site-walk/walkList.css'
import '../capture.css'

/** Returns one waiting photo or page as a list row: its picture or icon, its name and the bin. */
export function CaptureItem({
  lead,
  name,
  removeLabel,
  onRemove,
  busy,
}: {
  // The picture button.
  lead: ReactNode
  name: string
  removeLabel: string
  onRemove: () => void
  busy?: boolean
}) {
  return (
    <li className="sw-item cap-item">
      {lead}
      <div className="sw-item-main">
        <p className="sw-item-name cap-item-name">{name}</p>
      </div>
      <button
        type="button"
        className="sw-button sw-icon-button sw-button--danger"
        aria-label={removeLabel}
        title="Remove"
        disabled={busy}
        onClick={onRemove}
      >
        <Icon name="trash-2" size={18} />
      </button>
    </li>
  )
}

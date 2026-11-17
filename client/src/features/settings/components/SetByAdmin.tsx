// The "Set by an admin" line for a control the person may not change. S-01 AC1.
// Used by sections that hold global settings or defaults.
import { Icon } from '../../../design-system'

export function SetByAdmin() {
  return (
    <p className="st-note">
      <Icon name="lock" size={14} color="var(--text-muted)" /> Set by an admin
    </p>
  )
}

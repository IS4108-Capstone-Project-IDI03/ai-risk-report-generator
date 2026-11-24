// The red "Could not save" line beside a Settings control. S-01.
// Used by every section. A good save is a toast (useSave.ts), so only failures show here.
// Errors: red icon + short problem + grey fix (design system v2).
import { Icon } from '../../../design-system'
import type { SaveState } from '../useSave'

export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status !== 'failed') return null
  return (
    <span className="st-status" role="alert">
      <Icon name="octagon-alert" size={14} color="var(--red-600)" />
      <span className="st-err">Could not save.</span>
      <span className="st-fix">{state.message || 'Try again.'}</span>
    </span>
  )
}

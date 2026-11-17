// The small "Saving / Saved / failed" line beside a Settings control. S-01.
// Used by every section. Errors: red icon + short problem + grey fix (design system v2).
import { Icon } from '../../../design-system'
import type { SaveState } from '../useSave'

export function SaveStatus({ state }: { state: SaveState }) {
  if (state.status === 'idle') return null
  if (state.status === 'saving') return <span className="st-status">Saving…</span>
  if (state.status === 'saved')
    return (
      <span className="st-status">
        <Icon name="check" size={14} color="var(--green-600)" /> Saved
      </span>
    )
  return (
    <span className="st-status" role="alert">
      <Icon name="octagon-alert" size={14} color="var(--red-600)" />
      <span className="st-err">Could not save.</span>
      <span className="st-fix">{state.message || 'Try again.'}</span>
    </span>
  )
}

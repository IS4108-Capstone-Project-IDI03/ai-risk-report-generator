// Why a site walk dialog's action was refused, as a warning above its fields (v2 dialogs: the
// reason stays in the dialog, never a toast). Used by the walk dialogs: delete, name, location.
// Calls Callout.
import { Callout } from '../../../design-system'

/** Returns the warning with the gateway's words, or nothing when there is no problem. */
export function DialogProblem({ title, problem }: { title: string; problem?: string | null }) {
  if (!problem) return null
  return (
    <div role="alert">
      <Callout tone="warning" title={title}>
        {problem}
      </Callout>
    </div>
  )
}

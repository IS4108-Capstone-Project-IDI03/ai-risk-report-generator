// Redraft on the heading row of Section 2 and Section 3 in Review (GN-13). Called by
// ReviewWorkspace.tsx. Drafting runs in the background, so while it does the button reads
// "Redrafting" with a spinner and is disabled, from the server's drafting state.
import { Button, IconRegistry } from '../../../design-system'

/** Returns the secondary small Redraft button; `working` is true while the part is queued or being drafted. */
export function RedraftButton({ working, onRedraft }: { working: boolean; onRedraft: () => void }) {
  return (
    <Button
      variant="secondary"
      size="sm"
      iconLeft={IconRegistry.action.regenerate}
      loading={working}
      aria-busy={working || undefined}
      onClick={onRedraft}
    >
      {working ? 'Redrafting' : 'Redraft'}
    </Button>
  )
}

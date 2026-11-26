// Redraft on the heading row of Section 2 and Section 3 in Review (GN-13). Called by
// ReviewWorkspace.tsx. Drafting runs in the background, so while it does the button reads
// "Redrafting" with a spinner and is disabled, from the server's drafting state. On a phone it is
// a round icon, so the part's tools stay on one row (PartBar).
import { Button, IconAction, IconRegistry } from '../../../design-system'
import { useCompact } from '../useCompact'

/** Returns the secondary small Redraft button; `working` is true while the part is queued or being drafted. */
export function RedraftButton({ working, onRedraft }: { working: boolean; onRedraft: () => void }) {
  // Review's phone width (review.css), as ReviewWorkspace's Edit document.
  const phone = useCompact(759)
  if (phone)
    return (
      <IconAction
        icon={IconRegistry.action.regenerate}
        label={working ? 'Redrafting' : 'Redraft'}
        placement="bottom"
        loading={working}
        onClick={onRedraft}
      />
    )
  return (
    <Button
      pill
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

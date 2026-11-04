// Says a client is removed, or that sites removed with it can come back
// (CP-18). Called by screens/ClientRecord. Restore goes back through onRestore.
import { Button, Callout, IconRegistry } from '../../../design-system'
import type { ClientPage as Page } from '../api'
import { plural } from '../formatClient'

export function RemovedCallout({
  page,
  busy,
  onRestore,
}: {
  page: Page
  busy: boolean
  onRestore: () => void
}) {
  const restoreButton = (label: string) => (
    <Button
      size="sm"
      variant="secondary"
      iconLeft={IconRegistry.action.reinstate}
      loading={busy}
      onClick={onRestore}
    >
      {label}
    </Button>
  )
  if (page.removed)
    return (
      <section aria-label="Client">
        <Callout
          tone="info"
          title="This client is removed"
          actions={page.restore.allowed && restoreButton('Restore client')}
        >
          {page.restore.allowed
            ? 'None of its sites is offered when creating an assessment. Restore client brings back the sites removed with it.'
            : (page.restore.reason ??
              'None of its sites is offered when creating an assessment. Restore a site from Removed sites to bring it back.')}
        </Callout>
      </section>
    )
  if (page.removedWithClient > 0 && page.restore.allowed)
    return (
      <section aria-label="Client">
        <Callout
          tone="info"
          title={`${plural(page.removedWithClient, 'site')} removed with this client`}
          actions={restoreButton(`Restore ${plural(page.removedWithClient, 'site')}`)}
        >
          {'They are still removed. Restore them together, or one at a time from Removed sites.'}
        </Callout>
      </section>
    )
  return null
}

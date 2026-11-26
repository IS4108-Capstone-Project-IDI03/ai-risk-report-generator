// The client page's Open work tab (CP-23): the engineer's assessments still in
// progress across the client's sites, in one table with a Site column. Called by
// ClientRecord. Calls AssessmentTable.
import { EmptyState, IconRegistry, ListCard } from '../../../design-system'
import type { ClientPage as Page } from '../api'
import { AssessmentTable } from '../components/AssessmentTable'
import { stampText } from '../formatClient'

export function OpenWorkTab({
  page,
  onOpen,
}: {
  page: Page
  onOpen: (reference: string, site: string) => void
}) {
  const rows = page.sites
    .filter((s) => !s.removed)
    .flatMap((s) =>
      s.visits
        .filter((v) => v.status !== 'archived' && v.status !== 'finalised')
        .map((visit) => ({ visit, site: s.name })),
    )
  return (
    <>
      <ListCard>
        {rows.length === 0 ? (
          <EmptyState
            icon={IconRegistry.object.report}
            title="No open assessments"
            description="Archived assessments are under Sites."
          />
        ) : (
          <AssessmentTable rows={rows} label="Open assessments" showSite onOpen={onOpen} />
        )}
      </ListCard>
      {page.edited && <span className="cl-stamp">{stampText('Renamed', page.edited)}</span>}
    </>
  )
}

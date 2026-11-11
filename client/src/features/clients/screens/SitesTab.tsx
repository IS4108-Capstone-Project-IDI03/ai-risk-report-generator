// The client page's Sites tab (CP-18, CP-23 board 06): search and a Stage
// filter, then a card per site with the engineer's assessments there. Called by
// ClientRecord. Row actions go back to ClientRecord, which owns the dialogs.
import { useState } from 'react'
import { Button, EmptyState, IconRegistry, SearchField, statusLook } from '../../../design-system'
import { STAGE_LABEL, STATUS_LABEL, visitStage } from '../../assessments/format'
import type { Stage } from '../../marshbot/types'
import type { ClientPage as Page, ClientPageSite } from '../api'
import { FilterMenu } from '../components/FilterMenu'
import { SiteCard } from '../components/SiteCard'

export function SitesTab({
  page,
  busy,
  onOpen,
  onEdit,
  onRemove,
  onRestore,
}: {
  page: Page
  busy: boolean
  onOpen: (reference: string, site: string) => void
  onEdit: (site: ClientPageSite) => void
  onRemove: (site: ClientPageSite) => void
  onRestore: (site: ClientPageSite) => void
}) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [view, setView] = useState<'sites' | 'archived' | 'removed'>('sites')
  const listed = page.sites.filter((s) => !s.removed)
  const removed = page.sites.filter((s) => s.removed)
  const archivedVisits = listed.reduce(
    (n, s) => n + s.visits.filter((v) => v.status === 'archived').length,
    0,
  )
  const search = q.trim().toLowerCase()
  const matches = (s: ClientPageSite) =>
    !search || (s.name + ' ' + (s.address ?? '')).toLowerCase().includes(search)
  const visitsOf = (s: ClientPageSite) =>
    s.visits.filter((v) =>
      view === 'archived'
        ? v.status === 'archived'
        : view === 'removed'
          ? true
          : v.status !== 'archived' && (!status || visitStage(v) === status),
    )
  const shown = (view === 'removed' ? removed : listed).filter(
    (s) =>
      matches(s) &&
      // A status or the archived view leaves out a site with none of its assessments.
      (view === 'sites' && !status ? true : visitsOf(s).length > 0),
  )
  const statusChoices = [
    ...new Set(
      listed.flatMap((s) => s.visits.filter((v) => v.status !== 'archived').map(visitStage)),
    ),
  ].map((value) => {
    const { icon, fg } = statusLook(value)
    // A stage key or (with no stage) a status key.
    const label = STAGE_LABEL[value as Stage] ?? STATUS_LABEL[value as keyof typeof STATUS_LABEL]
    return { value, label, icon, color: fg }
  })

  return (
    <>
      <div className="cl-card cl-toolbar">
        <SearchField
          label="Search sites by name or address"
          placeholder="Search sites"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {view === 'sites' && (
          <FilterMenu name="Stage" choices={statusChoices} value={status} onChange={setStatus} />
        )}
        {(view !== 'sites' || archivedVisits > 0) && (
          <Button
            variant="pill"
            aria-pressed={view === 'archived'}
            iconLeft={view === 'archived' ? 'arrow-left' : IconRegistry.object.archive}
            onClick={() => setView(view === 'archived' ? 'sites' : 'archived')}
          >
            {view === 'archived' ? 'Back to sites' : `Archived (${archivedVisits})`}
          </Button>
        )}
        {(view === 'removed' || removed.length > 0) && (
          <Button
            variant="pill"
            aria-pressed={view === 'removed'}
            iconLeft={view === 'removed' ? 'arrow-left' : IconRegistry.action.discard}
            onClick={() => setView(view === 'removed' ? 'sites' : 'removed')}
          >
            {view === 'removed' ? 'Back to sites' : `Removed sites (${removed.length})`}
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="cl-card">
          <EmptyState
            icon={IconRegistry.object.site}
            title={
              view === 'removed'
                ? 'No removed sites'
                : view === 'archived'
                  ? 'No archived assessments'
                  : listed.length === 0
                    ? 'No sites listed'
                    : 'No sites match'
            }
            description={
              view === 'sites' && listed.length === 0
                ? 'Every site of this client is removed. Restore one from Removed sites.'
                : 'Change the search or the filters to see more.'
            }
          />
        </div>
      ) : (
        <ul aria-label="Sites" className="cl-sites">
          {shown.map((site) => (
            <SiteCard
              key={site.id}
              site={site}
              visits={visitsOf(site)}
              busy={busy}
              onOpen={onOpen}
              onEdit={() => onEdit(site)}
              onRemove={() => onRemove(site)}
              onRestore={() => onRestore(site)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

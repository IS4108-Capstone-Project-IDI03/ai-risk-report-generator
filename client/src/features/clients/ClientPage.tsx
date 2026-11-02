// A client's page (CP-18): the engineer's sites at the client, their own
// visits there, and the client's and each site's corrections, removals and
// restores. Opened from the Clients list, Group by client and an assessment's
// client name. Only the engineer's own work is listed; a colleague's
// assessment shows only as the reason something can't be changed.
import { useState } from 'react'
import {
  Badge,
  Button,
  Callout,
  EmptyState,
  Icon,
  IconRegistry,
  Input,
  Select,
  StatusIcon,
} from '../../design-system'
import { DueNote } from '../assessments/components/DueNote'
import { JURISDICTIONS } from '../assessments/demo-data'
import { formatDay, formatDayYearTime, STATUS_LABEL } from '../assessments/format'
import {
  restoreClient,
  restoreSite,
  type ClientPage as Page,
  type ClientPageSite,
  type Stamp,
} from './api'
import {
  EditSiteDialog,
  RemoveDialog,
  RenameClientDialog,
  RestoreSiteDialog,
} from './ClientDialogs'
import type { ClientPageError } from './useClientPage'
import './clients.css'

// A visit as the work list shows it, or null before the work list loads.
type VisitRow = {
  status: string
  date: string
  dueDate: string
  overdue: boolean
  countdown: { text: string; soon: boolean } | null
} | null

type Props = {
  page: Page | null
  error: ClientPageError | null
  reload: () => Promise<void>
  // Back to the Clients list.
  onClients: () => void
  visit: (reference: string) => VisitRow
  // Rename client or Remove client, opened from the header's ⋯ menu.
  dialog: 'rename' | 'remove' | null
  closeDialog: () => void
  // Opens one of the engineer's assessments.
  onOpen: (reference: string, site: string) => void
  // Opens the create form on a site of this client (CP-17 AC6).
  onNewVisit: (client: { id: string; name: string }, site: ClientPageSite) => void
  // After a change: the work list reloads, and the message is shown.
  onChanged: (message: string) => void
  notify: (message: string, tone?: string) => void
}

// A site's dialog; the client's own open from the header.
type Open =
  | { kind: 'edit'; site: ClientPageSite }
  | { kind: 'remove'; site: ClientPageSite }
  | { kind: 'restoreName'; site: ClientPageSite }

const ALL_STATUSES = 'All statuses'
const country = (code: string) => JURISDICTIONS.find((j) => j.value === code)?.label ?? code
const day = (iso: string | null) => (iso ? formatDay(new Date(iso + 'T00:00:00')) : 'Unscheduled')
// Who changed it and when, as an observation says it (CP-08):
// "Edited by Alex Rowe · 02 Nov 2026 14:02".
const stampText = (verb: string, s: Stamp) =>
  `${verb} by ${s.by.name} · ${formatDayYearTime(new Date(s.at))}`
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function Note({ children }: { children: string }) {
  return (
    <p className="client-note">
      <Icon name="info" size={16} color="var(--text-muted)" />
      <span>{children}</span>
    </p>
  )
}

export function ClientPage({
  page,
  error,
  reload,
  onClients,
  visit: visitRow,
  dialog,
  closeDialog,
  onOpen,
  onNewVisit,
  onChanged,
  notify,
}: Props) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState(ALL_STATUSES)
  const [view, setView] = useState<'sites' | 'archived' | 'removed'>('sites')
  const [open, setOpen] = useState<Open | null>(null)
  const [busy, setBusy] = useState(false)

  // Back to the list it is one of, as Photos leads back to the Observations tab.
  const back = (
    <div>
      <Button variant="ghost" size="sm" iconLeft="arrow-left" onClick={onClients}>
        {'Back to clients'}
      </Button>
    </div>
  )
  if (!page)
    return (
      <div className="client-page">
        {back}
        {error ? (
          <div className="client-card">
            <EmptyState
              icon={error.status === 403 ? 'lock' : IconRegistry.object.client}
              title={
                error.status === 403
                  ? 'You have no assessments for this client'
                  : error.status === 404
                    ? 'This client was not found'
                    : 'The client could not be loaded'
              }
              description={
                error.status === 403 ? 'A client opens from your own assessments.' : error.message
              }
            />
          </div>
        ) : (
          <p role="status" style={{ margin: 0 }}>
            {'Loading the client…'}
          </p>
        )}
      </div>
    )

  const client = { id: page.id, name: page.name }
  // A change saved: the page and the work list read it again.
  const changed = (message: string) => {
    setOpen(null)
    closeDialog()
    void reload()
    onChanged(message)
  }
  // Restores run at once, unless the site's name was taken: then it needs a new one.
  const restore = async (run: () => Promise<string>) => {
    if (busy) return
    setBusy(true)
    try {
      changed(await run())
    } catch (failure: unknown) {
      notify(
        failure instanceof Error ? failure.message : 'Nothing was restored. Try again.',
        'danger',
      )
    }
    setBusy(false)
  }
  const restoreOne = (site: ClientPageSite) =>
    site.nameTaken
      ? setOpen({ kind: 'restoreName', site })
      : void restore(async () => {
          await restoreSite(site.id)
          return `${site.name} restored.`
        })
  const restoreAll = () =>
    restore(async () => {
      const { restored, nameTaken } = await restoreClient(page.id)
      return (
        `${plural(restored, 'site')} restored.` +
        (nameTaken.length
          ? ` ${nameTaken.join(', ')} ${nameTaken.length === 1 ? 'needs' : 'need'} a new name: restore ${nameTaken.length === 1 ? 'it' : 'them'} from Removed sites.`
          : '')
      )
    })

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
          : v.status !== 'archived' &&
            (status === ALL_STATUSES || STATUS_LABEL[v.status] === status),
    )
  const shown = (view === 'removed' ? removed : listed).filter(
    (s) =>
      matches(s) &&
      // A status or the archived view leaves out a site with none of its visits.
      (view === 'sites' && status === ALL_STATUSES ? true : visitsOf(s).length > 0),
  )
  const statusOptions = [
    ALL_STATUSES,
    ...new Set(
      listed.flatMap((s) =>
        s.visits.filter((v) => v.status !== 'archived').map((v) => STATUS_LABEL[v.status]),
      ),
    ),
  ]

  return (
    <div className="client-page">
      {back}

      {/* Rename client and Remove client are in the header's ⋯ menu; a
          removed client, or sites removed with it, say so here. */}
      {page.removed ? (
        <section aria-label="Client">
          <Callout
            tone="info"
            title="This client is removed"
            actions={
              page.restore.allowed && (
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={IconRegistry.action.reinstate}
                  loading={busy}
                  onClick={restoreAll}
                >
                  {'Restore client'}
                </Button>
              )
            }
          >
            {page.restore.allowed
              ? 'None of its sites is offered when creating an assessment. Restore client brings back the sites removed with it.'
              : (page.restore.reason ??
                'None of its sites is offered when creating an assessment. Restore a site from Removed sites to bring it back.')}
          </Callout>
        </section>
      ) : (
        page.removedWithClient > 0 &&
        page.restore.allowed && (
          <section aria-label="Client">
            <Callout
              tone="info"
              title={`${plural(page.removedWithClient, 'site')} removed with this client`}
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={IconRegistry.action.reinstate}
                  loading={busy}
                  onClick={restoreAll}
                >
                  {`Restore ${plural(page.removedWithClient, 'site')}`}
                </Button>
              }
            >
              {
                'They are still removed. Restore them together, or one at a time from Removed sites.'
              }
            </Callout>
          </section>
        )
      )}

      <div className="client-toolbar">
        <div style={{ flex: '1 1 220px', minWidth: '180px', maxWidth: '360px' }}>
          <Input
            size="sm"
            type="search"
            iconLeft="search"
            aria-label="Search sites by name or address"
            placeholder="Search sites"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {view === 'sites' && (
          <div style={{ flex: '0 1 200px', minWidth: '160px' }}>
            <Select
              size="sm"
              aria-label="Filter visits by status"
              options={statusOptions}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </div>
        )}
        {(view !== 'sites' || archivedVisits > 0) && (
          <Button
            size="sm"
            variant={view === 'archived' ? 'tonal' : 'secondary'}
            aria-pressed={view === 'archived'}
            iconLeft={view === 'archived' ? 'arrow-left' : IconRegistry.object.archive}
            onClick={() => setView(view === 'archived' ? 'sites' : 'archived')}
          >
            {view === 'archived' ? 'Back to sites' : `Archived (${archivedVisits})`}
          </Button>
        )}
        {(view === 'removed' || removed.length > 0) && (
          <Button
            size="sm"
            variant={view === 'removed' ? 'tonal' : 'secondary'}
            aria-pressed={view === 'removed'}
            iconLeft={view === 'removed' ? 'arrow-left' : IconRegistry.action.discard}
            onClick={() => setView(view === 'removed' ? 'sites' : 'removed')}
          >
            {view === 'removed' ? 'Back to sites' : `Removed sites (${removed.length})`}
          </Button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="client-card">
          <EmptyState
            icon={IconRegistry.object.site}
            title={
              view === 'removed'
                ? 'No removed sites'
                : view === 'archived'
                  ? 'No archived visits'
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
        <ul
          aria-label="Sites"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
          }}
        >
          {shown.map((site) => {
            const visits = visitsOf(site)
            return (
              <li key={site.id} className="client-card" aria-label={site.name}>
                <div className="client-card-head">
                  <div className="client-card-title">
                    <h2
                      style={{
                        margin: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '17px',
                        lineHeight: '24px',
                        fontWeight: '600',
                        color: 'var(--text-primary)',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      <Icon
                        name={IconRegistry.object.site}
                        size={18}
                        color="var(--action-primary)"
                      />
                      {site.name}
                      {site.removed && <Badge tone="neutral">{'Removed'}</Badge>}
                    </h2>
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                      {[
                        site.address ?? 'No address recorded',
                        country(site.jurisdiction),
                        site.facilityType,
                      ].join(' · ')}
                    </span>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {site.code}
                    </span>
                    {site.removed ? (
                      <span className="client-stamp">
                        {stampText('Removed', site.removed) +
                          (site.removedWithClient ? ', with the client' : '')}
                      </span>
                    ) : (
                      site.edited && (
                        <span className="client-stamp">{stampText('Edited', site.edited)}</span>
                      )
                    )}
                    {site.removed
                      ? !site.restore.allowed &&
                        !!site.restore.reason && <Note>{site.restore.reason}</Note>
                      : !site.change.allowed &&
                        !!site.change.reason && <Note>{site.change.reason}</Note>}
                    {site.removed && site.restore.allowed && site.nameTaken && (
                      <Note>{`This client now has another site named ${site.name}, so this one is restored under a new name.`}</Note>
                    )}
                  </div>
                  <div className="client-card-actions">
                    {site.removed ? (
                      site.restore.allowed && (
                        <Button
                          size="sm"
                          variant="secondary"
                          iconLeft={IconRegistry.action.reinstate}
                          aria-label={'Restore ' + site.name}
                          disabled={busy}
                          onClick={() => restoreOne(site)}
                        >
                          {'Restore'}
                        </Button>
                      )
                    ) : (
                      // Its main action first, then Edit and Remove, as a
                      // location's heading on the Observations tab has them.
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          iconLeft="plus"
                          aria-label={'New visit to ' + site.name}
                          onClick={() => onNewVisit(client, site)}
                        >
                          {'New visit'}
                        </Button>
                        {site.change.allowed && (
                          <Button
                            size="sm"
                            variant="secondary"
                            iconLeft="pencil"
                            aria-label={'Edit ' + site.name}
                            onClick={() => setOpen({ kind: 'edit', site })}
                          >
                            {'Edit'}
                          </Button>
                        )}
                        {/* Takes the site out of use, as Remove does a
                            recording on the Observations tab (CP-08). */}
                        {site.remove.allowed && (
                          <Button
                            size="sm"
                            variant="danger-tonal"
                            iconLeft={IconRegistry.action.discard}
                            aria-label={'Remove ' + site.name}
                            onClick={() => setOpen({ kind: 'remove', site })}
                          >
                            {'Remove'}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {visits.length > 0 ? (
                  <div className="client-visits">
                    {/* The work list's columns, so a visit reads as it does there. */}
                    <div className="client-visit-head" aria-hidden="true">
                      <span>{'Report'}</span>
                      <span>{'Site visit'}</span>
                      <span>{'Status'}</span>
                      <span>{'Report due'}</span>
                    </div>
                    <ul aria-label={'Your visits to ' + site.name}>
                      {visits.map((visit) => {
                        // As the work list has it; until it loads, as the page does.
                        const row = visitRow(visit.reference) ?? {
                          status: STATUS_LABEL[visit.status],
                          date: day(visit.siteVisitDate),
                          dueDate: '—',
                          overdue: false,
                          countdown: null,
                        }
                        return (
                          <li key={visit.reference}>
                            <button
                              type="button"
                              className="client-visit"
                              data-hoverable="true"
                              onClick={() => onOpen(visit.reference, site.name)}
                            >
                              <span className="client-visit-ref">{visit.reference}</span>
                              <span className="client-visit-date">{row.date}</span>
                              <span className="client-visit-status">
                                <StatusIcon status={row.status} showLabel={true} size={15} />
                              </span>
                              <span className="client-visit-due">
                                <span className="client-visit-date">{row.dueDate}</span>
                                <DueNote overdue={row.overdue} countdown={row.countdown} />
                              </span>
                              <Icon
                                name="chevron-right"
                                size={16}
                                color="var(--text-muted)"
                                className="client-visit-go"
                              />
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ) : (
                  <div style={{ padding: '0 18px 14px' }}>
                    <Note>{'All your visits here are archived. Archived shows them.'}</Note>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {dialog === 'rename' && !page.removed && (
        <RenameClientDialog client={client} onClose={closeDialog} onSaved={changed} />
      )}
      {dialog === 'remove' && !page.removed && (
        <RemoveDialog
          target={{ kind: 'client', ...client, sites: listed.length }}
          onClose={closeDialog}
          onSaved={changed}
        />
      )}
      {open?.kind === 'edit' && (
        <EditSiteDialog
          site={open.site}
          assessments={open.site.assessments}
          onClose={() => setOpen(null)}
          onSaved={changed}
        />
      )}
      {open?.kind === 'remove' && (
        <RemoveDialog
          target={{ kind: 'site', id: open.site.id, name: open.site.name }}
          onClose={() => setOpen(null)}
          onSaved={changed}
        />
      )}
      {open?.kind === 'restoreName' && (
        <RestoreSiteDialog site={open.site} onClose={() => setOpen(null)} onSaved={changed} />
      )}
    </div>
  )
}

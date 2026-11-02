// The engineer's clients (CP-18), from the sidebar: each client of their own
// assessments, found by its name or a site's, opening its page. Drawn from
// the work list, so it lists exactly the clients the engineer may open. A
// client whose sites are all removed waits under Removed clients (n), as a
// removed site does under Removed sites on its client's page.
import { useState } from 'react'
import { Badge, Button, EmptyState, Icon, IconRegistry, Input } from '../../design-system'
import './clients.css'

export type ClientListItem = {
  id: string
  name: string
  // Every site the engineer visits there is removed.
  removed: boolean
  summary: string
  lastVisit: string | null
  // Its name and its sites' names, lower case.
  search: string
  open: () => void
}

export function ClientList({
  clients,
  loading,
  failed,
}: {
  clients: ClientListItem[]
  loading: boolean
  failed: boolean
}) {
  const [q, setQ] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)
  const removed = clients.filter((c) => c.removed)
  const inView = showRemoved ? removed : clients.filter((c) => !c.removed)
  const search = q.trim().toLowerCase()
  const shown = inView.filter((c) => !search || c.search.includes(search))
  return (
    <div className="client-page">
      <section aria-label="Clients" className="client-card">
        <div className="client-list-search">
          <div style={{ flex: '1 1 220px', minWidth: '180px', maxWidth: '360px' }}>
            <Input
              size="sm"
              type="search"
              iconLeft="search"
              aria-label="Search clients by name or site"
              placeholder="Search clients"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {(showRemoved || removed.length > 0) && (
            <Button
              size="sm"
              variant={showRemoved ? 'tonal' : 'secondary'}
              aria-pressed={showRemoved}
              iconLeft={showRemoved ? 'arrow-left' : IconRegistry.action.discard}
              onClick={() => setShowRemoved(!showRemoved)}
            >
              {showRemoved ? 'Back to clients' : `Removed clients (${removed.length})`}
            </Button>
          )}
        </div>
        {loading ? (
          <p role="status" style={{ margin: 0, padding: '14px 18px' }}>
            {'Loading your clients…'}
          </p>
        ) : failed || shown.length === 0 ? (
          <EmptyState
            icon={IconRegistry.object.client}
            title={
              failed
                ? 'Your clients could not be loaded'
                : inView.length
                  ? 'No clients match'
                  : showRemoved
                    ? 'No removed clients'
                    : 'No clients yet'
            }
            description={
              failed
                ? 'The gateway could not be reached. Check your connection and try again.'
                : inView.length
                  ? 'Change the search to see more.'
                  : showRemoved
                    ? 'A client shows here once all its sites are removed.'
                    : removed.length
                      ? 'Every client of yours is removed. Removed clients lists them.'
                      : 'A client shows here once one of your assessments is for it.'
            }
          />
        ) : (
          <ul aria-label="Your clients" className="client-list">
            {shown.map((c) => (
              <li key={c.id}>
                <button type="button" className="client-row" data-hoverable="true" onClick={c.open}>
                  <Icon name={IconRegistry.object.client} size={18} color="var(--action-primary)" />
                  <span className="client-row-text">
                    <span className="client-row-name">
                      {c.name}
                      {c.removed && <Badge tone="neutral">{'Removed'}</Badge>}
                    </span>
                    <span className="client-row-summary">{c.summary}</span>
                  </span>
                  {!!c.lastVisit && <span className="client-row-last">{c.lastVisit}</span>}
                  <Icon name="chevron-right" size={16} color="var(--text-muted)" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

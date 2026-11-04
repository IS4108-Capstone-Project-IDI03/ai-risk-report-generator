// A client's page (CP-18, rebuilt CP-23 boards 06 and 07): the loading and error
// states with Back, then the loaded record. Opened from the Clients list,
// Group by client and an assessment's client name. Calls screens/ClientRecord.
import { EmptyState, IconRegistry, TopBar } from '../../design-system'
import type { ReactNode } from 'react'
import type { ClientPage as Page } from './api'
import { ClientRecord } from './screens/ClientRecord'
import type { ClientPageError } from './useClientPage'
import './client-record.css'
import './clients.css'

export type ClientRecordProps = {
  reload: () => Promise<void>
  // Rename client or Remove client: which dialog is open.
  dialog: 'rename' | 'remove' | null
  closeDialog: () => void
  // Opens Rename or Remove through the menu model; null for a removed client.
  menu: { items: { label: string; onSelect: () => void }[] } | null
  // Starts a new assessment for this client; null when not allowed.
  onNewAssessment: (() => void) | null
  // Opens one of the engineer's assessments.
  onOpen: (reference: string, site: string) => void
  // After a change: the work list reloads (its own message is not shown).
  onChanged: (message: string) => void
  notify: (message: string, tone?: string) => void
}

type Props = ClientRecordProps & {
  page: Page | null
  error: ClientPageError | null
  // Back to the Clients list.
  onClients: () => void
  // The notification bell, on desktop, where the app's page header would hold it.
  bell?: ReactNode
}

export function ClientPage({ page, error, onClients, bell, ...record }: Props) {
  if (page)
    return (
      <div className="cl-page">
        <ClientRecord page={page} onClients={onClients} bell={bell} {...record} />
      </div>
    )
  return (
    <div className="cl-page">
      <TopBar
        eyebrow="Clients"
        title="Client"
        bell={bell}
        back={{ label: 'Back to Clients', onClick: onClients }}
      />
      <div className="cl-content">
        {error ? (
          <div className="cl-card">
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
    </div>
  )
}

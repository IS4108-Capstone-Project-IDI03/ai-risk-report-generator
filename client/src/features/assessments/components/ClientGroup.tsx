// One client › site group on the By client list (CP-23, board 03): a header row
// (initials, client name linking to its page, chevron, site, address, hover "+")
// and that site's assessments. Used by screens/Dashboard. Calls WorkRow.
import { Icon, IconButton, Tooltip } from '../../../design-system'
import { ClientAvatar } from '../../clients/components/ClientAvatar'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { WorkRow, type WorkRowData } from './WorkRow'

type WorkGroup = AssessmentWorkflow['workGroups'][number]

export function ClientGroup({
  client,
  site,
  onOpen,
  onArchive,
}: {
  client: WorkGroup
  site: WorkGroup['sites'][number]
  onOpen: (e: React.MouseEvent<HTMLElement>) => void
  // Returns a row's archive action, or nothing when it may not be archived.
  onArchive: (r: WorkRowData) => (() => void) | undefined
}) {
  return (
    <section aria-label={client.title + ', ' + site.name} className="at-group">
      <div className="at-group-head ds-on-grey">
        <ClientAvatar name={client.title} small />
        {/* Client › site, then the address; the address drops under them on a phone. */}
        <div className="at-group-text">
          {client.viewClient ? (
            <button type="button" className="at-client at-link" onClick={client.viewClient}>
              {client.title}
            </button>
          ) : (
            <span className="at-client">{client.title}</span>
          )}
          <Icon name="chevron-right" size={14} color="var(--graphite-600)" />
          <span className="at-site">{site.name}</span>
          {!!site.address && (
            <span className="at-address" title={site.address}>
              {site.address}
            </span>
          )}
        </div>
        {/* A site on the gateway takes a new assessment (CP-17 AC6); a removed one does not. */}
        {!!site.newVisit && (
          <span className="at-add">
            {/* The tooltip names the action only; a screen reader still hears the site (v2 section 2). */}
            <Tooltip label="New assessment" placement="top-end">
              <IconButton
                icon="plus"
                label={'New assessment for ' + site.name}
                title={undefined}
                style={{ borderRadius: 999 }}
                onClick={site.newVisit}
              />
            </Tooltip>
          </span>
        )}
      </div>
      {site.rows.map((r) => (
        <WorkRow key={r.id} r={r} grouped onOpen={onOpen} onArchive={onArchive(r)} />
      ))}
    </section>
  )
}

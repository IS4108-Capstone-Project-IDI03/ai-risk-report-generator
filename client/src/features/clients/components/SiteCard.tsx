// One site on the client page's Sites tab (CP-18, CP-23 board 06): pin tile,
// name, address and chips, its New assessment / Edit / Remove (or Restore)
// icons, and a table of the engineer's assessments there. Called by
// screens/SitesTab. Opens the client dialogs through the callbacks.
import { Button, Chip, Badge, Icon, IconRegistry } from '../../../design-system'
import type { ClientPageSite, ClientVisit } from '../api'
import { country, stampText } from '../formatClient'
import { AssessmentTable } from './AssessmentTable'
import { Note } from './Note'
import { RowAction } from './RowAction'

export function SiteCard({
  site,
  visits,
  busy,
  onOpen,
  onEdit,
  onRemove,
  onRestore,
}: {
  site: ClientPageSite
  // Its assessments in the current view.
  visits: ClientVisit[]
  busy: boolean
  onOpen: (reference: string, site: string) => void
  onEdit: () => void
  onRemove: () => void
  onRestore: () => void
}) {
  return (
    <li className="cl-card cl-site" aria-label={site.name}>
      <div className="cl-site-head ds-on-grey">
        <span className="cl-site-tile">
          <Icon name={IconRegistry.object.site} size={18} />
        </span>
        <div className="cl-site-text">
          <h2>
            <span className="cl-site-name" dir="auto" title={site.name}>
              {site.name}
            </span>
            {site.removed && <Badge tone="neutral">{'Removed'}</Badge>}
          </h2>
          <p className="cl-line-2">{site.address ?? 'No address yet'}</p>
          <div className="cl-chips">
            <Chip kind="jurisdiction">{country(site.jurisdiction)}</Chip>
            <Chip kind="facility">{site.facilityType}</Chip>
          </div>
          {site.removed ? (
            <span className="cl-stamp">
              {stampText('Removed', site.removed) +
                (site.removedWithClient ? ', with the client' : '')}
            </span>
          ) : (
            site.edited && <span className="cl-stamp">{stampText('Edited', site.edited)}</span>
          )}
          {site.removed
            ? !site.restore.allowed && !!site.restore.reason && <Note>{site.restore.reason}</Note>
            : !site.change.allowed && !!site.change.reason && <Note>{site.change.reason}</Note>}
          {site.removed && site.restore.allowed && site.nameTaken && (
            <Note>{`This client now has another site named ${site.name}, so this one is restored under a new name.`}</Note>
          )}
        </div>
        <div className="cl-site-actions">
          {site.removed ? (
            site.restore.allowed && (
              <Button
                size="sm"
                variant="secondary"
                iconLeft={IconRegistry.action.reinstate}
                aria-label={'Restore ' + site.name}
                disabled={busy}
                onClick={onRestore}
              >
                {'Restore'}
              </Button>
            )
          ) : (
            <>
              {/* No + per site (Jesper, round 7): the page header's New assessment starts one. */}
              {site.change.allowed && (
                <RowAction
                  icon="pencil"
                  label={`Edit ${site.name}`}
                  tooltip="Edit site"
                  onClick={onEdit}
                />
              )}
              {/* Takes the site out of use, as Remove does a recording on the Observations tab (CP-08). */}
              {site.remove.allowed && (
                <RowAction
                  icon={IconRegistry.action.discard}
                  label={`Remove ${site.name}`}
                  tooltip="Remove site"
                  danger
                  onClick={onRemove}
                />
              )}
            </>
          )}
        </div>
      </div>
      {visits.length > 0 ? (
        <AssessmentTable
          rows={visits.map((visit) => ({ visit, site: site.name }))}
          label={`Your assessments at ${site.name}`}
          onOpen={onOpen}
        />
      ) : (
        <div className="cl-site-note">
          <Note>{'All your assessments here are archived. Archived shows them.'}</Note>
        </div>
      )}
    </li>
  )
}

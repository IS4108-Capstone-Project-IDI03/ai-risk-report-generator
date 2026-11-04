// One site in the Sites card of a recorded client (CP-23, boards 09, 12): a
// checkbox card with the site's chips, address and its latest assessment.
// Ticked sites get their own card below. Used by SitesPicker.tsx.
import { Chip, Icon, NewBadge, StatusPill } from '../../../design-system'
import { country } from '../../clients/formatClient'

export type SitePick = {
  key: string
  name: string
  isNew: boolean
  jurisdiction: string
  facilityType: string
  address: string
  // "Last: RPT-… · 11 Apr 2026", or null for a site with no assessment yet.
  last: string | null
  status: string | null
}

export function SitePickCard({
  site,
  checked,
  onToggle,
}: {
  site: SitePick
  checked: boolean
  onToggle: () => void
}) {
  return (
    <label className={'na-pick' + (checked ? ' is-checked' : '')}>
      <span className="na-pick-head">
        <input type="checkbox" checked={checked} onChange={onToggle} />
        <span className="na-pick-box" aria-hidden="true">
          {checked && <Icon name="check" size={14} />}
        </span>
        <strong dir="auto">{site.name}</strong>
      </span>
      <span className="na-chips">
        {site.isNew && <NewBadge />}
        {site.jurisdiction && <Chip kind="jurisdiction">{country(site.jurisdiction)}</Chip>}
        {site.facilityType && <Chip kind="facility">{site.facilityType}</Chip>}
      </span>
      <span className={'na-pick-address' + (site.address ? '' : ' is-empty')}>
        {site.address || 'No address yet'}
      </span>
      <span className="na-pick-foot">
        <span className={site.last ? '' : 'is-empty'}>{site.last ?? 'No assessments yet'}</span>
        {site.status && <StatusPill status={site.status} />}
      </span>
    </label>
  )
}

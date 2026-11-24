// The Details panel's Site map block (AS-06, board D1): the site and blocks in two columns,
// a small pin after each pinned one, and Open map. Called by DetailsContent.tsx.
import { Icon } from '../../../design-system'
import { Tip } from '../../help/Tip'
import type { PlaceRow } from '../../assessments/components/siteMapEdit'
import { DetailsHeading, DetailsLink } from './DetailsHeading'

/** Returns the block; `shown` is how many places fit, and `links` makes it one row with just Open Map. */
export function DetailsPlaces({
  rows,
  shown,
  links = false,
  onOpenMap,
}: {
  rows: PlaceRow[]
  shown: number
  links?: boolean
  onOpenMap: () => void
}) {
  const more = rows.length - shown
  const open = <DetailsLink onClick={onOpenMap}>Open Map</DetailsLink>
  if (links)
    return (
      <section>
        <DetailsHeading big link={open} tip={<Tip id="overview.site-map" />}>
          Site Map
        </DetailsHeading>
      </section>
    )
  return (
    <section>
      <DetailsHeading link={open} tip={<Tip id="overview.site-map" />}>
        Site Map
      </DetailsHeading>
      <ul className="mb-places">
        {rows.slice(0, shown).map((row) => (
          <li key={row.key}>
            <span className="mb-badge" aria-hidden="true">
              {row.label}
            </span>
            <span className="mb-place-name" dir="auto">
              {row.name}
            </span>
            {/* A pin shows only where one is set; the label says it for a screen reader. */}
            {row.point && <Icon name="map-pin" size={14} title="Pinned" />}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="mb-more">{`+${more} more`}</p>}
    </section>
  )
}

// One place in the Details panel's site map list (AS-06, board D3): a navy badge, its name and
// coordinates, and icon buttons when it is pinned; a grey badge, its name and one Pin button
// when it is not. Called by SiteMapPanel.tsx.
import { IconAction } from '../../../design-system'
import { directionsUrl, formatCoordinates } from '../../assessments/googleMaps'
import type { PlaceRow } from '../../assessments/components/siteMapEdit'

/** Returns the row; `onCentre` pans the map to its pin, and the change buttons show only when `canEdit`. */
export function SiteMapPlace({
  row,
  canEdit,
  busy,
  current,
  onCentre,
  onPlace,
  onRemove,
}: {
  row: PlaceRow
  canEdit: boolean
  busy: boolean
  // The place a pin is being set for.
  current: boolean
  onCentre: () => void
  onPlace: () => void
  onRemove: () => void
}) {
  const point = row.point
  const label = (
    <>
      <span className="mb-badge" data-on={point ? '' : undefined} aria-hidden="true">
        {row.label}
      </span>
      <span className="mb-place-name" dir="auto">
        {row.name}
        {point && <small>{formatCoordinates(point)}</small>}
      </span>
    </>
  )
  return (
    <li aria-label={row.name} className="mb-place" data-current={current ? '' : undefined}>
      {/* A pinned place pans the map to its pin when pressed. */}
      {point ? (
        <button type="button" className="mb-place-main mb-hit" onClick={onCentre}>
          {label}
        </button>
      ) : (
        <span className="mb-place-main">{label}</span>
      )}
      <span className="mb-place-actions">
        {point && (
          <IconAction
            icon="navigation"
            label={`Directions to ${row.name}`}
            tooltip="Directions"
            placement="bottom"
            className="mb-hit"
            href={directionsUrl(point)}
          />
        )}
        {canEdit && point && (
          <>
            <IconAction
              icon="move"
              label={`Move Pin for ${row.name}`}
              tooltip="Move Pin"
              placement="bottom"
              className="mb-hit"
              disabled={busy}
              onClick={onPlace}
            />
            <IconAction
              icon="trash-2"
              label={`Remove Pin for ${row.name}`}
              tooltip="Remove Pin"
              placement="bottom-end"
              className="mb-hit"
              disabled={busy}
              onClick={onRemove}
            />
          </>
        )}
        {canEdit && !point && (
          <IconAction
            icon="map-pin-plus"
            label={`Pin on the Map for ${row.name}`}
            tooltip="Pin on the Map"
            placement="bottom-end"
            className="mb-hit"
            disabled={busy}
            onClick={onPlace}
          />
        )}
      </span>
    </li>
  )
}

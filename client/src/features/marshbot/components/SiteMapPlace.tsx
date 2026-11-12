// One place in the Details panel's site map list (AS-06, board D3): a navy badge, its name and
// coordinates, and icon buttons when it is pinned; a grey badge, its name and one Pin button
// when it is not. Called by SiteMapPanel.tsx.
import { Icon, IconButton } from '../../../design-system'
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
          <a
            className="ds-icon-button mb-iconlink mb-hit"
            data-ghost=""
            href={directionsUrl(point)}
            target="_blank"
            rel="noreferrer"
            aria-label="Directions"
            title="Directions"
          >
            <Icon name="navigation" size={14} />
          </a>
        )}
        {canEdit && point && (
          <>
            <IconButton
              icon="move"
              label="Move pin"
              tooltip="Move pin"
              size="sm"
              className="mb-hit"
              disabled={busy}
              onClick={onPlace}
            />
            <IconButton
              icon="trash-2"
              label="Remove pin"
              tooltip="Remove pin"
              size="sm"
              className="mb-hit"
              disabled={busy}
              onClick={onRemove}
            />
          </>
        )}
        {canEdit && !point && (
          <IconButton
            icon="map-pin-plus"
            label="Pin on the map"
            tooltip="Pin on the map"
            size="sm"
            className="mb-hit"
            disabled={busy}
            onClick={onPlace}
          />
        )}
      </span>
    </li>
  )
}

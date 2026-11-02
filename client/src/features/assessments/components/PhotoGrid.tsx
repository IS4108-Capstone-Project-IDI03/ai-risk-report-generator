// An even grid of square photo tiles (CP-04, CP-19, CP-22), used for one
// observation's photos on its page and for All photos and All handwritten
// pages. A tile opens its photo larger; a small round control at its corner
// goes to the observation (collections), or a bin removes the photo (a page).
// Rendered by screens/ObservationPage.tsx, Photos.tsx and Scans.tsx.
import { Icon } from '../../../design-system'
import { ZoomBadge } from './ZoomBadge'
import '../capture.css'

export type Tile = {
  key: string
  name: string
  url?: string | null
  // Present on a page about one observation: takes the photo out (kept to restore).
  remove?: (() => void) | null
  // Present on a collection: opens the observation the photo belongs to.
  goTo?: (() => void) | null
}

export function PhotoGrid({
  tiles,
  label,
  onOpen,
}: {
  tiles: Tile[]
  // Names the list for screen readers, e.g. "Photos at Block A › Level 2".
  label: string
  onOpen: (tile: Tile & { url: string }) => void
}) {
  return (
    <ul className="cap-tiles" aria-label={label}>
      {tiles.map((t) => (
        <li key={t.key} className="cap-tile">
          {t.url ? (
            <button
              type="button"
              className="cap-tile-open"
              aria-label={'Open ' + t.name}
              onClick={() => onOpen({ ...t, url: t.url! })}
            >
              {/* shortcut: loads the original; serve smaller copies if photo lists grow long. */}
              <img src={t.url} alt="" loading="lazy" />
              {/* The corner is the observation's link when there is one. */}
              {!t.goTo && <ZoomBadge />}
            </button>
          ) : (
            <span className="cap-tile-empty">
              <Icon name="image" size={22} color="var(--text-muted)" />
            </span>
          )}
          {!!t.goTo && (
            <button
              type="button"
              className="cap-tile-go"
              aria-label="Open the observation"
              onClick={t.goTo}
            >
              <span>
                <Icon name="arrow-up-right" size={16} />
              </span>
            </button>
          )}
          {!!t.remove && (
            <button
              type="button"
              className="cap-tile-go cap-tile-remove"
              aria-label={'Remove ' + t.name}
              title="Remove"
              onClick={t.remove}
            >
              <span>
                <Icon name="trash-2" size={16} color="var(--action-danger)" />
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

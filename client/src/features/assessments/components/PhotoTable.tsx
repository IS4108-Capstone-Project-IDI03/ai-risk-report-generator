// The shared body of All Photos and All Handwritten Pages (CP-22 round 3): a
// table with one row per photo: a thumbnail (opens it full size to zoom), the
// observation, its location and its category. A tap anywhere else on the row
// opens the observation (round 6), as a row of the Observations table does. The count sits in the
// toolbar above the rows. On a phone each row stacks. Rendered by
// screens/Photos.tsx and screens/Scans.tsx.
import { Icon } from '../../../design-system'
import type { Place } from '../locations'
import { LocationPath } from './LocationPath'
import { ZoomBadge } from './ZoomBadge'
import { CategoryMark } from './ObservationMarks'

export type PhotoRow = {
  key: string
  name: string
  url?: string | null
  // Its location as one line, named in the photo's popup.
  where: string
  text: string
  cats: string[]
  path: Place & { bare?: boolean }
  openObservation: () => void
}

export function PhotoTable({
  label,
  rows,
  count,
  onOpen,
}: {
  label: string
  rows: PhotoRow[]
  // e.g. "3 photos across 2 locations", shown in the toolbar.
  count: string
  onOpen: (row: PhotoRow & { url: string }) => void
}) {
  return (
    <div className="ob-card">
      <div className="ob-filters">
        <span className="ob-count">{count}</span>
      </div>
      <div role="group" aria-label={label}>
        <div className="ob-pt-head ob-pt-grid" aria-hidden="true">
          <span />
          <span>Observation</span>
          <span>Location</span>
          <span>Category</span>
          <span />
        </div>
        <ul className="ob-pt-list">
          {rows.map((r) => (
            <li key={r.key} className="ob-pt-grid ob-pt-row">
              {r.url ? (
                <button
                  type="button"
                  className="ob-pt-thumb"
                  aria-label={'Open ' + r.name}
                  onClick={() => onOpen({ ...r, url: r.url! })}
                >
                  {/* shortcut: loads the original; serve smaller copies if photo lists grow long. */}
                  <img src={r.url} alt="" loading="lazy" />
                  <ZoomBadge />
                </button>
              ) : (
                <span className="ob-pt-thumb">
                  <Icon name="image" size={22} color="var(--text-muted)" />
                </span>
              )}
              <button type="button" className="ob-pt-text" onClick={r.openObservation}>
                {r.text}
              </button>
              <span className="ob-pt-where">
                <LocationPath {...r.path} />
              </span>
              <span className="ob-pt-cat">
                <CategoryMark cats={r.cats} />
                <span>{r.cats.join(', ') || 'Uncategorised'}</span>
              </span>
              <span className="ob-pt-go" aria-hidden="true">
                <Icon name="chevron-right" size={16} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

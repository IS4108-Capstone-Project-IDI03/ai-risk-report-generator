// A location as an arrow path, general to specific: "Block A › Level 2 ›
// Staircase" (CP-22 round 1). Used wherever the Observations tab and the site
// walk screens name a location, so every path reads the same way.
import { Icon } from '../../../design-system'
import { locationParts, type Place } from '../locations'
import './location-path.css'

export function LocationPath(place: Place & { className?: string; bare?: boolean }) {
  const parts = place.bare ? [place.name] : locationParts(place)
  return (
    // Screen readers hear "Block A, Level 2, Staircase", not the arrows.
    <span
      role="text"
      aria-label={parts.join(', ')}
      className={'location-path' + (place.className ? ' ' + place.className : '')}
    >
      {/* Each arrow ends the part before it, so a wrapped line never starts with one. */}
      {parts.map((part, i) => (
        <span key={i} className="location-path-part" aria-hidden="true">
          {part}
          {i < parts.length - 1 && (
            <Icon name="chevron-right" size={12} className="location-path-arrow" />
          )}
        </span>
      ))}
    </span>
  )
}

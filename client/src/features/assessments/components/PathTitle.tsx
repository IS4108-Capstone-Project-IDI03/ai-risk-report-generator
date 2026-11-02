// An observation's place as its page title (CP-22): the building and level as
// a small arrow path, the place's own name large under it, so a long location
// never wraps into a ragged heading. Used by screens/ObservationPage.tsx and
// site-walk/screens/ProposalPage.tsx.
import { Icon } from '../../../design-system'
import { locationParts, type Place } from '../locations'
import './location-path.css'

export function PathTitle({ path }: { path: (Place & { bare?: boolean }) | null }) {
  if (!path)
    return (
      <h2 className="op-path">
        <span className="op-path-name">{'No location yet'}</span>
      </h2>
    )
  const parents = path.bare ? [] : locationParts(path).slice(0, -1)
  return (
    // Screen readers hear "Block A, Level 1, Loading bay", not the arrows.
    <h2 className="op-path" aria-label={[...parents, path.name].join(', ')}>
      {parents.length > 0 && (
        <span className="op-path-parents location-path" aria-hidden="true">
          {parents.map((part) => (
            <span key={part} className="location-path-part">
              {part}
              <Icon name="chevron-right" size={12} className="location-path-arrow" />
            </span>
          ))}
        </span>
      )}
      <span className="op-path-name" aria-hidden="true">
        {path.name}
      </span>
    </h2>
  )
}

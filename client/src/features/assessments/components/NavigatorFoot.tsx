// The tinted buttons at the foot of the location navigator (CP-22): add a
// location, every photo, every handwritten page and the deleted observations.
// Rendered by LocationNavigator.tsx.
import { Icon } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

// One tinted row: an icon and its label.
function NavFootRow({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: string
  label: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      className="ob-foot-row"
      data-primary={primary || undefined}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  )
}

// The four rows. Shared with a site walk proposal's navigator (round 5), where
// they open the proposal's own photos, pages and deleted observations.
export function NavFoot({
  onAddLocation,
  onPhotos,
  onScans,
  deletedCount,
  onDeleted,
}: {
  onAddLocation?: () => void
  onPhotos: () => void
  onScans: () => void
  deletedCount: number
  onDeleted: () => void
}) {
  return (
    <div className="ob-nav-foot">
      {!!onAddLocation && (
        <NavFootRow primary icon="plus" label="Add location" onClick={onAddLocation} />
      )}
      {/* Every photo and every handwritten page (CP-04, CP-19). */}
      <NavFootRow icon="image" label="All photos" onClick={onPhotos} />
      <NavFootRow icon="scan-text" label="All handwritten pages" onClick={onScans} />
      {/* The deleted ones, always reachable here, with how many there are. */}
      <NavFootRow
        icon="trash-2"
        label={`Deleted observations (${deletedCount})`}
        onClick={onDeleted}
      />
    </div>
  )
}

export function NavigatorFoot({ v }: { v: AssessmentWorkflow }) {
  return (
    <NavFoot
      onAddLocation={v.obsAddLocation ?? undefined}
      onPhotos={v.goPhotos}
      onScans={v.goScans}
      deletedCount={v.obsDeletedCount}
      onDeleted={() => v.setObsShowDeleted(true)}
    />
  )
}

// The tinted buttons at the foot of the location navigator (CP-22): add a
// location, every photo, every handwritten page, every recording (CP-12) and
// the deleted observations.
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

// The rows. Shared with a site walk proposal's navigator (round 5), where
// they open the proposal's own photos, pages and deleted observations; it has
// no recordings row, as its walk list already holds the walk's recordings.
export function NavFoot({
  onAddLocation,
  onPhotos,
  onScans,
  onRecordings,
  deletedCount,
  onDeleted,
}: {
  onAddLocation?: () => void
  onPhotos: () => void
  onScans: () => void
  onRecordings?: () => void
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
      {!!onRecordings && <NavFootRow icon="mic" label="All recordings" onClick={onRecordings} />}
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
      onRecordings={v.goRecordings}
      deletedCount={v.obsDeletedCount}
      onDeleted={() => v.setObsShowDeleted(true)}
    />
  )
}

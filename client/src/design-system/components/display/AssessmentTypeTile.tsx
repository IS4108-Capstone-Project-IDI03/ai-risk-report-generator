// Assessment type tile (CP-23, board 01): the icon tile for First survey / Resurvey / Follow-up.
// Called by tables, the type segmented control and the New Assessment form. Calls Icon.
import { Icon } from '../core/Icon'

export type AssessmentType = 'First survey' | 'Resurvey' | 'Follow-up'

// Icon and colours per type; shared with AssessmentTypeControl.
export const ASSESSMENT_TYPES: Record<AssessmentType, { icon: string; fg: string; bg: string }> = {
  'First survey': { icon: 'flag', fg: 'var(--report-navy)', bg: 'var(--ink-50)' },
  Resurvey: { icon: 'repeat', fg: 'var(--teal-600)', bg: 'var(--teal-50)' },
  'Follow-up': { icon: 'calendar-check', fg: 'var(--amber-600)', bg: 'var(--amber-50)' },
}

export type AssessmentTypeTileProps = {
  type: AssessmentType
  // Tile size in px (default 36, radius 10; v2 section 5).
  size?: number
  // Shows the type's name beside the tile.
  showLabel?: boolean
}

/** Returns the coloured icon tile for an assessment type, with its name when showLabel. */
export function AssessmentTypeTile({
  type,
  size = 36,
  showLabel = false,
}: AssessmentTypeTileProps) {
  const t = ASSESSMENT_TYPES[type]
  const tile = (
    <span
      className="ds-type-tile"
      title={showLabel ? undefined : type}
      style={{ width: size, height: size, color: t.fg, background: t.bg }}
    >
      <Icon name={t.icon} size={Math.round(size / 2)} title={showLabel ? undefined : type} />
    </span>
  )
  if (!showLabel) return tile
  return (
    <span className="ds-type-tile-row">
      {tile}
      {type}
    </span>
  )
}

// The choices the Review screen's pickers offer (CP-22): severity, category,
// and locations grouped by building as the Observations tab groups them.
import { IconRegistry } from '../../design-system'
import { CAT_ICON } from '../assessments/categories'
import { groupLocations, type Place } from '../assessments/locations'
import type { Choice } from '../assessments/components/ChoiceMenu'

// Most severe first; must match server/src/models/observation.model.ts SEVERITIES.
// Each with the symbol the Observations tab shows for it.
export const SEVERITY_OPTIONS: Choice[] = (['critical', 'high', 'moderate', 'low'] as const).map(
  (value) => ({
    value,
    label: value.charAt(0).toUpperCase() + value.slice(1),
    icon: IconRegistry.severity[value].icon,
    color: IconRegistry.severity[value].color,
  }),
)

// C-O-P-E order; must match COPE_DIMENSIONS on the server.
export const CATEGORY_OPTIONS: Choice[] = [
  'Construction',
  'Occupancy',
  'Protection',
  'Exposure',
].map((c) => ({ value: c, label: c, icon: CAT_ICON[c] }))

// Just the parts LocationPath draws, without the proposal's ref and id.
export const pathOf = (l: Place): Place => ({ building: l.building, floor: l.floor, name: l.name })

// A location's line inside its building's group: "Level 1 › Loading bay",
// "Whole building › Facade", or just the name elsewhere on site.
export const placeInGroup = (l: Place) =>
  l.building ? [l.floor || 'Whole building', l.name].join(' › ') : l.name

// Returns locations as picker options under their building (or Elsewhere on site).
export function placeOptions<T extends Place>(list: T[], valueOf: (l: T) => string): Choice[] {
  return groupLocations(list).flatMap((g) =>
    g.levels.flatMap((level) =>
      level.locations.map((l) => ({
        value: valueOf(l),
        label: placeInGroup(l),
        group: g.title,
      })),
    ),
  )
}

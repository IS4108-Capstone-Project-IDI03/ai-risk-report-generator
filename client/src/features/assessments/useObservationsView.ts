// What the Observations tab shows (CP-22): the place picked in the location
// navigator (all, a building, a level or one location) and the observations
// under it, grouped by location. Called by screens/Observations.tsx; built on
// the workflow's obsGroups (useAssessmentWorkflow.tsx).
import { useState } from 'react'
import { WHOLE_BUILDING } from './locations'
import type { AssessmentWorkflow } from './useAssessmentWorkflow'

export type Place =
  | { kind: 'all' }
  | { kind: 'group'; group: string }
  | { kind: 'level'; group: string; level: string }
  | { kind: 'location'; id: string }

type Group = AssessmentWorkflow['obsGroups'][number]
export type NavLocation = Group['levels'][number]['locations'][number]
export type ObservationRowView = AssessmentWorkflow['obsList'][number]

const ALL: Place = { kind: 'all' }

// Returns the navigator's tree, the place picked, the locations
// listed under it with their observations, and the order Previous/Next follow.
export function useObservationsView(v: AssessmentWorkflow) {
  const groups = v.obsGroups
  // Back from capture, it opens at the location the engineer was saving in.
  const [picked, setPicked] = useState<Place>(() => {
    const landing = groups
      .flatMap((g) => g.levels.flatMap((level) => level.locations))
      .find((l) => l.landing)
    return landing ? { kind: 'location', id: landing.id } : ALL
  })
  const levelKey = (title: string | null) => title ?? ''
  const within = (g: Group, level: Group['levels'][number], l: NavLocation) =>
    picked.kind === 'all' ||
    (picked.kind === 'group' && picked.group === g.key) ||
    (picked.kind === 'level' && picked.group === g.key && picked.level === levelKey(level.title)) ||
    (picked.kind === 'location' && picked.id === l.id)

  // Every location, with its building and level as context.
  const all = groups.flatMap((g) =>
    g.levels.flatMap((level) =>
      level.locations.map((l) => ({
        g,
        level,
        location: l,
        // Building, level and name for the arrow path. Elsewhere on site and
        // Building not recorded are groups, not buildings; Whole building is
        // not a level; a location not recorded is only its name.
        path: {
          building: g.key.startsWith('building:') ? g.title : null,
          floor: g.key === 'unrecorded' || level.title === WHOLE_BUILDING ? null : level.title,
          name: l.name,
          bare: g.key === 'unrecorded',
        },
      })),
    ),
  )
  const matches = all.filter((x) => within(x.g, x.level, x.location))
  // A place removed or filtered away falls back to every location.
  const place = matches.length ? picked : ALL
  const shown = matches.length ? matches : all
  const one = place.kind === 'location' ? shown[0]?.location : undefined
  return {
    place,
    pick: setPicked,
    tree: groups.map((g) => ({
      ...g,
      levels: g.levels.map((level) => ({ ...level, key: levelKey(level.title) })),
    })),
    // Only locations holding a listed observation, unless one location is picked.
    sections: one ? shown : shown.filter((s) => s.location.items.length),
    // The one location picked, for Add manually to open capture there.
    location: one,
    // "Block A › Level 1 › Loading bay", or "All locations".
    title: titleOf(place, groups),
    // Every observation in the assessment, whatever place is picked: the
    // arrows step through all of them (Jesper, 31 Oct).
    order: all.flatMap((s) => s.location.items),
  }
}

function titleOf(place: Place, groups: Group[]) {
  if (place.kind === 'all') return 'All locations'
  for (const g of groups) {
    if (place.kind === 'group' && place.group === g.key) return g.title
    for (const level of g.levels) {
      if (place.kind === 'level' && place.group === g.key && place.level === (level.title ?? ''))
        return g.title + ' › ' + level.title
      const l = level.locations.find((x) => place.kind === 'location' && x.id === place.id)
      // Deduplicated: Location not recorded is its own group and location.
      if (l) return [...new Set([g.title, level.title, l.name].filter(Boolean))].join(' › ')
    }
  }
  return 'All locations'
}

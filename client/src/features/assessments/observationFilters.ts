import type { Observation, ObservationFilters } from './types'

export const NO_FILTERS: ObservationFilters = { cat: '', sev: '', loc: '', floor: '' }

// An observation matches when every filter that is set matches its label, so
// any one label on its own returns every observation carrying it (CP-06 AC2).
// The location filter is by name, the zone; the floor is its own filter.
export function matchesFilters(o: Observation, f: ObservationFilters) {
  return (
    (!f.cat || o.cat === f.cat) &&
    (!f.sev || o.sev === f.sev) &&
    (!f.loc || o.area === f.loc) &&
    (!f.floor || o.floor === f.floor)
  )
}

export const filtersActive = (f: ObservationFilters) => Object.values(f).some(Boolean)

// The distinct values of one label across the list, in the order first seen,
// keeping the selected value so its filter never shows a value it lacks.
export function labelValues(list: (string | null | undefined)[], selected: string) {
  const values = new Set(list.filter((v): v is string => !!v))
  if (selected) values.add(selected)
  return [...values]
}

import { hasCategory } from './categories'
import { groupKey, groupLocations, locationLabel, type Place } from './locations'
import type { Observation, ObservationFilters } from './types'

export const NO_FILTERS: ObservationFilters = {
  type: '',
  cat: '',
  sev: '',
  place: '',
  status: '',
}

// The Location filter's values (CP-16): a building (or Elsewhere on site), a
// level of it, or one location. Each observation matches all three of its
// own, so choosing a building shows everything in it; one with no location
// recorded matches only Location not recorded.
const UNRECORDED = 'unrecorded'
const norm = (name?: string | null) => (name ?? '').trim().toLowerCase()
const groupValue = (p: Place) => 'g:' + groupKey(p)
const levelValue = (p: Place) => 'l:' + groupKey(p) + '|' + norm(p.floor)
const placeValue = (p: Place) => 'p:' + groupKey(p) + '|' + norm(p.floor) + '|' + norm(p.name)
const placeOf = (o: Observation): Place => ({
  building: o.building,
  floor: o.floor,
  name: o.locationName,
})
const placeValues = (o: Observation) =>
  o.locationName
    ? [groupValue(placeOf(o)), levelValue(placeOf(o)), placeValue(placeOf(o))]
    : [UNRECORDED]
export const matchesPlace = (o: Observation, place: string) => placeValues(o).includes(place)

// The Location filter's options, under each building in the order the list
// is grouped (building, then level lowest first), then Elsewhere on site:
// "All of Block A" and a level only where they hold more than one location,
// then each location. labels names each value in full for its filter chip:
// "Block A · Level 2 · Staircase".
export function placeFilter(list: Observation[]) {
  const places: Place[] = []
  for (const o of list)
    if (o.locationName && !places.some((p) => placeValue(p) === placeValue(placeOf(o))))
      places.push(placeOf(o))
  const labels: Record<string, string> = {}
  const groups = groupLocations(places).map((g) => {
    const all = g.levels.flatMap((level) => level.locations)
    const options: { value: string; label: string }[] = []
    if (all.length > 1) {
      labels[groupValue(all[0])] = g.title
      options.push({
        value: groupValue(all[0]),
        label: g.key === 'elsewhere' ? 'All elsewhere on site' : 'All of ' + g.title,
      })
    }
    for (const level of g.levels) {
      if (level.title && level.locations.length > 1) {
        labels[levelValue(level.locations[0])] = g.title + ' · ' + level.title
        options.push({ value: levelValue(level.locations[0]), label: level.title })
      }
      for (const l of level.locations) {
        labels[placeValue(l)] = locationLabel(l)
        options.push({
          value: placeValue(l),
          label: level.title ? level.title + ' · ' + l.name : l.name,
        })
      }
    }
    return { label: g.title, options }
  })
  const unrecorded = list.some((o) => !o.locationName)
  if (unrecorded) labels[UNRECORDED] = 'Location not recorded'
  return {
    options: [
      ...groups,
      ...(unrecorded ? [{ value: UNRECORDED, label: 'Location not recorded' }] : []),
    ],
    labels,
  }
}

// The observation types (CP-08, CP-04, CP-19). One with a note and a recording is both.
export const OBSERVATION_TYPES = ['Note', 'Voice', 'Photo', 'Scan']
// Where an observation's recordings and photos stand (CP-08, CP-05).
export const OBSERVATION_STATUSES = [
  'Transcribing',
  'Interpreting',
  'Transcription failed',
  'Interpretation failed',
  'Complete',
]

// What an observation holds. A sample one, kept in the browser, has a note and
// may carry a sample voice clip, sample photos, recordings added in the demo
// (CP-08), and pages kept in the demo (CP-19).
export const typesOf = (o: Observation) =>
  o.types ?? [
    'Note',
    ...(o.audio || o.recordings?.length ? ['Voice'] : []),
    ...(o.media.length ? ['Photo'] : []),
    ...(o.pages?.length ? ['Scan'] : []),
  ]
// "Note", "Voice and photo" or "Note, voice and photo".
export const typeLabel = (o: Observation) => {
  const [first = 'Note', ...rest] = typesOf(o)
  const others = rest.map((type) => type.toLowerCase())
  return others.length
    ? [first, ...others.slice(0, -1)].join(', ') + ' and ' + others[others.length - 1]
    : first
}
// A sample observation has nothing being transcribed, but its sample photo
// proposal is briefly interpreting.
export const statusOf = (o: Observation) =>
  o.status ?? (o.interpretation?.status === 'interpreting' ? 'Interpreting' : 'Complete')

// An observation matches when every filter that is set matches its label, so
// any one label on its own returns every observation carrying it (CP-06 AC2,
// CP-08 AC3). The Location filter takes a building, a level of it or one
// location (CP-16). An observation of both types matches either, and one
// filed under several categories matches any of them.
export function matchesFilters(o: Observation, f: ObservationFilters) {
  return (
    (!f.type || typesOf(o).includes(f.type)) &&
    (!f.cat || hasCategory(o.cats, f.cat)) &&
    (!f.sev || o.sev === f.sev) &&
    (!f.place || matchesPlace(o, f.place)) &&
    (!f.status || statusOf(o) === f.status)
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

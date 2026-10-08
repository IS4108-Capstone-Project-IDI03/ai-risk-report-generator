import type { Observation, ObservationFilters } from './types'

export const NO_FILTERS: ObservationFilters = {
  type: '',
  cat: '',
  sev: '',
  loc: '',
  floor: '',
  status: '',
}

// The observation types (CP-08, CP-04). One with a note and a recording is both.
export const OBSERVATION_TYPES = ['Note', 'Voice', 'Photo']
// Where an observation's recordings and photos stand (CP-08, CP-05).
export const OBSERVATION_STATUSES = [
  'Transcribing',
  'Interpreting',
  'Transcription failed',
  'Interpretation failed',
  'Complete',
]

// What an observation holds. A sample one, kept in the browser, has a note and
// may carry a sample voice clip and sample photos.
export const typesOf = (o: Observation) =>
  o.types ?? ['Note', ...(o.audio ? ['Voice'] : []), ...(o.media.length ? ['Photo'] : [])]
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
// CP-08 AC3). The location filter is by name, the zone; the floor is its own
// filter. An observation of both types matches either.
export function matchesFilters(o: Observation, f: ObservationFilters) {
  return (
    (!f.type || typesOf(o).includes(f.type)) &&
    (!f.cat || o.cat === f.cat) &&
    (!f.sev || o.sev === f.sev) &&
    (!f.loc || o.area === f.loc) &&
    (!f.floor || o.floor === f.floor) &&
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

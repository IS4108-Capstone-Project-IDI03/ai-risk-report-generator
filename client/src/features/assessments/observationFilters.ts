import type { Observation, ObservationFilters } from './types'

export const NO_FILTERS: ObservationFilters = {
  type: '',
  cat: '',
  sev: '',
  loc: '',
  floor: '',
  status: '',
}

// The observation types (CP-08). One with a note and a recording is both.
export const OBSERVATION_TYPES = ['Note', 'Voice']
// Where an observation's recordings stand (CP-08).
export const OBSERVATION_STATUSES = ['Transcribing', 'Transcription failed', 'Complete']

// What an observation holds. A sample one, kept in the browser, has a note and
// may carry a sample voice clip.
export const typesOf = (o: Observation) => o.types ?? ['Note', ...(o.audio ? ['Voice'] : [])]
// "Note", "Voice" or "Note and voice".
export const typeLabel = (o: Observation) => {
  const types = typesOf(o)
  return types.length > 1 ? 'Note and voice' : (types[0] ?? 'Note')
}
// A sample observation has nothing being transcribed.
export const statusOf = (o: Observation) => o.status ?? 'Complete'

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

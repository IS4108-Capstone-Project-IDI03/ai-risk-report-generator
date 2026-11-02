// Edits to a site walk proposal (CP-22 AC9), as plain functions that each
// return a new proposal. The Review screen calls them through useProposal;
// nothing here talks to the gateway.
import type { SiteLocation } from '../assessments/api'
import { hasCategory } from '../assessments/categories'
import {
  groupLocations,
  sameName,
  standardLevel,
  type LocationGroup,
} from '../assessments/locations'
import type { Proposal, ProposedLocation, ProposedObservation, SiteWalk } from './api'

// The navigator's two fixed entries: observations with no place yet, and every observation.
export const NEEDS_LOCATION = 'needs-location'
export const ALL = 'all'

// The navigator: "No location yet" when any observation has none, then the
// locations by building and level, as the Observations tab groups them.
export function groupProposal(p: Proposal): {
  needsLocation: boolean
  groups: LocationGroup<ProposedLocation>[]
} {
  return {
    needsLocation: p.observations.some((o) => !o.locationRef),
    groups: groupLocations(p.locations),
  }
}

// The observations shown for a selected location, for "No location yet", or all of them.
export const observationsAt = (p: Proposal, selected: string) =>
  selected === ALL
    ? p.observations
    : p.observations.filter((o) => (o.locationRef ?? NEEDS_LOCATION) === selected)

// The selected entry's observations in sections, one per location in the
// navigator's order (No location yet first). One section when a single location is picked.
export function sectionsAt(p: Proposal, selected: string) {
  const items = observationsAt(p, selected)
  const order =
    selected === ALL
      ? [
          NEEDS_LOCATION,
          ...groupProposal(p).groups.flatMap((g) =>
            g.levels.flatMap((level) => level.locations.map((l) => l.ref)),
          ),
        ]
      : [selected]
  return order
    .map((ref) => ({
      ref,
      location: p.locations.find((l) => l.ref === ref) ?? null,
      items: items.filter((o) => (o.locationRef ?? NEEDS_LOCATION) === ref),
    }))
    .filter((section) => section.items.length)
}

// The next free ref, e.g. "obs-7", so refs stay unique inside the proposal.
function nextRef(prefix: string, used: { ref: string }[]) {
  let n = used.length + 1
  while (used.some((u) => u.ref === `${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

// Changes one observation. Jev's `check` flags stay as they were: the screen no
// longer shows them, they are kept in the data for evaluation.
export function updateObservation(
  p: Proposal,
  ref: string,
  patch: Partial<Pick<ProposedObservation, 'note' | 'copeDimension' | 'severity' | 'locationRef'>>,
): Proposal {
  return { ...p, observations: p.observations.map((o) => (o.ref === ref ? { ...o, ...patch } : o)) }
}

// Deletes one observation: it moves to the proposal's deleted list (newest
// first), where it can be restored (round 5), and Create all leaves it out.
export function removeObservation(p: Proposal, ref: string): Proposal {
  const o = p.observations.find((x) => x.ref === ref)
  if (!o) return p
  return {
    ...p,
    observations: p.observations.filter((x) => x !== o),
    removed: [o, ...(p.removed ?? [])],
  }
}

// Puts a deleted observation back, at `index` (Undo puts it where it was) or
// last. Its location stays only if the proposal still has it.
export function restoreObservation(p: Proposal, ref: string, index = Infinity): Proposal {
  const o = p.removed?.find((x) => x.ref === ref)
  if (!o) return p
  const observations = [...p.observations]
  const restored = {
    ...o,
    ref: observations.some((item) => item.ref === o.ref) ? nextRef('obs', observations) : o.ref,
    locationRef: p.locations.some((l) => l.ref === o.locationRef) ? o.locationRef : null,
  }
  observations.splice(Math.min(index, observations.length), 0, restored)
  return { ...p, observations, removed: p.removed!.filter((x) => x !== o) }
}

type NewObservation = Pick<
  ProposedObservation,
  'note' | 'copeDimension' | 'severity' | 'locationRef'
>

// Adds an observation the engineer wrote by hand (Add observation); it has no
// recording clip or photos. Returns it with the proposal.
export function addObservation(p: Proposal, fields: NewObservation) {
  const observation: ProposedObservation = {
    // Deleted ones keep their refs, so a restore never clashes.
    ref: nextRef('obs', [...p.observations, ...(p.removed ?? [])]),
    ...fields,
    recordingSeq: null,
    start: null,
    end: null,
    photoIds: [],
    check: { severity: false, category: false, location: false },
  }
  return { proposal: { ...p, observations: [...p.observations, observation] }, observation }
}

export type LocationInput = {
  kind: 'building' | 'elsewhere'
  building: string
  floor: string
  name: string
}

// The location as stored: trimmed, the level in its standard spelling, and no
// building or level elsewhere on site (the same rules as the location form).
function placeOf(input: LocationInput) {
  const floor = input.floor.trim()
  return input.kind === 'building'
    ? {
        kind: 'building' as const,
        building: input.building.trim(),
        floor: floor ? (standardLevel(floor) ?? floor) : null,
        name: input.name.trim(),
      }
    : { kind: 'elsewhere' as const, building: null, floor: null, name: input.name.trim() }
}

const samePlace = (
  a: { building: string | null; floor: string | null; name: string },
  b: { building: string | null; floor: string | null; name: string },
) => sameName(a.building, b.building) && sameName(a.floor, b.floor) && sameName(a.name, b.name)

// Why a location can't be saved, or null when it can.
export function locationProblem(p: Proposal, input: LocationInput, ref?: string) {
  const place = placeOf(input)
  if (place.kind === 'building' && !place.building) return 'Enter the building.'
  if (!place.name) return 'Enter the location’s name.'
  if (p.locations.some((l) => l.ref !== ref && samePlace(l, place)))
    return 'This location is already in the proposal.'
  return null
}

// Adds a new location. One already on the assessment is linked to it instead
// of being added again. Returns it with the proposal.
export function addLocation(p: Proposal, input: LocationInput, existing: SiteLocation[]) {
  const place = placeOf(input)
  const match = existing.find((e) => samePlace(e, place))
  const location: ProposedLocation = {
    ref: nextRef('loc', p.locations),
    existingId: match?.id ?? null,
    ...place,
  }
  return { proposal: { ...p, locations: [...p.locations, location] }, location }
}

// Renames a new location.
export const renameLocation = (p: Proposal, ref: string, input: LocationInput): Proposal => ({
  ...p,
  locations: p.locations.map((l) => (l.ref === ref ? { ...l, ...placeOf(input) } : l)),
})

// Takes a location out; its observations, deleted ones too, go to "No location yet".
export function removeLocation(p: Proposal, ref: string): Proposal {
  const unplace = (o: ProposedObservation) =>
    o.locationRef === ref ? { ...o, locationRef: null } : o
  return {
    locations: p.locations.filter((l) => l.ref !== ref),
    observations: p.observations.map(unplace),
    removed: p.removed?.map(unplace),
  }
}

// "Same as…": a new location is really one already on the assessment (AC9).
// Every observation at it moves in one change. When that location is already
// in the proposal they join it; otherwise this one becomes it. Returns the
// proposal and the ref the observations now use.
export function sameAs(p: Proposal, ref: string, existing: SiteLocation) {
  const linked = p.locations.find((l) => l.existingId === existing.id && l.ref !== ref)
  const move = (o: ProposedObservation) =>
    o.locationRef === ref ? { ...o, locationRef: linked!.ref } : o
  if (linked)
    return {
      proposal: {
        locations: p.locations.filter((l) => l.ref !== ref),
        observations: p.observations.map(move),
        removed: p.removed?.map(move),
      },
      ref: linked.ref,
    }
  const kind: ProposedLocation['kind'] =
    existing.building || existing.floor ? 'building' : 'elsewhere'
  return {
    proposal: {
      ...p,
      locations: p.locations.map((l) =>
        l.ref === ref
          ? {
              ...l,
              existingId: existing.id,
              kind,
              building: existing.building,
              floor: existing.floor,
              name: existing.name,
            }
          : l,
      ),
    },
    ref,
  }
}

// The location as a form fills it in, for Rename.
export const inputOf = (l: ProposedLocation): LocationInput => ({
  kind: l.kind,
  building: l.building ?? '',
  floor: l.floor ?? '',
  name: l.name,
})

// No note: media added by hand stands in for one, as in Add manually (round 3).
export const lacksNote = (o: ProposedObservation) => !o.note.trim() && !o.mediaIds?.length

// An empty field is the only thing that asks for attention: no note, place,
// category or severity.
export const lacksValue = (o: ProposedObservation) =>
  lacksNote(o) || !o.locationRef || !o.copeDimension || !o.severity

/** Returns what an observation still needs, as words for its row: ["location", "severity"]. */
export const missingFields = (o: ProposedObservation) =>
  (
    [
      [!o.locationRef, 'location'],
      [!o.copeDimension, 'category'],
      [!o.severity, 'severity'],
      [lacksNote(o), 'note'],
    ] as const
  )
    .filter(([missing]) => missing)
    .map(([, name]) => name)

/** Returns the first observation, in list order, that still needs something. */
export const firstIncomplete = (p: Proposal) =>
  sectionsAt(p, ALL)
    .flatMap((s) => s.items)
    .find(lacksValue)

// How many observations still have an empty field; Create all waits for zero.
export const incompleteCount = (p: Proposal) => p.observations.filter(lacksValue).length

// What Create all would refuse, in words, or null when it can go ahead.
export function createProblem(p: Proposal) {
  const some = (n: number) => (n === 1 ? 'one observation' : `${n} observations`)
  const count = (miss: (o: ProposedObservation) => boolean) => p.observations.filter(miss).length
  if (!p.observations.length) return 'There are no observations to create.'
  const checks: [(o: ProposedObservation) => boolean, string][] = [
    [lacksNote, 'Write a note for'],
    [(o) => !o.locationRef, 'Choose a location for'],
    [(o) => !o.copeDimension, 'Choose a category for'],
    [(o) => !o.severity, 'Choose a severity for'],
  ]
  for (const [miss, text] of checks) {
    const n = count(miss)
    if (n) return `${text} ${some(n)} first.`
  }
  return null
}

// The table's filters (round 5): the Observations tab's Category, Severity,
// Type and Status (assessments/observationFilters.ts), '' when not set.
export type ProposalFilters = { cat: string; sev: string; type: string; status: string }
export const NO_PROPOSAL_FILTERS: ProposalFilters = { cat: '', sev: '', type: '', status: '' }
// A proposed observation's status is whether Create all can take it.
export const PROPOSAL_STATUSES = ['Needs details', 'Ready']
export const proposalStatus = (o: ProposedObservation) =>
  lacksValue(o) ? 'Needs details' : 'Ready'

type Media = NonNullable<SiteWalk['media']>
/** Returns what it holds, in the tab's Type names: ["Note", "Voice", "Photo", "Scan"]. */
export function proposalTypes(o: ProposedObservation, media: Media = []) {
  const kinds = media.filter((m) => o.mediaIds?.includes(m.id)).map((m) => m.kind)
  return [
    ...(o.note.trim() ? ['Note'] : []),
    ...(o.recordingSeq !== null || kinds.includes('voice') ? ['Voice'] : []),
    ...(o.photoIds.length || kinds.includes('photo') ? ['Photo'] : []),
    ...(kinds.includes('page') ? ['Scan'] : []),
  ]
}

/** Returns whether it matches every filter that is set; Uncategorised matches none chosen. */
export const matchesProposalFilters = (o: ProposedObservation, f: ProposalFilters, media?: Media) =>
  (!f.cat || hasCategory(o.copeDimension ? [o.copeDimension] : [], f.cat)) &&
  (!f.sev || o.severity === f.sev) &&
  (!f.type || proposalTypes(o, media).includes(f.type)) &&
  (!f.status || proposalStatus(o) === f.status)

// The success toast's words after Create all: what was added.
export function createdMessage(p: Proposal) {
  const places = p.locations.filter((l) => !l.existingId).length
  const n = p.observations.length
  const obs = `${n} ${n === 1 ? 'observation' : 'observations'}`
  return `Created ${obs}${places ? ` and ${places} ${places === 1 ? 'location' : 'locations'}` : ''}`
}

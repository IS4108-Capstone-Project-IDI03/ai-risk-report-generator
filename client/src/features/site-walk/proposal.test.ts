// Tests for the proposal edits (CP-22 AC9, AC10): grouping, moving, merging and
// validating a walk's proposal. Covers proposal.ts.
import { describe, expect, it } from 'vitest'
import type { Proposal, ProposedLocation, ProposedObservation } from './api'
import {
  addLocation,
  addObservation,
  ALL,
  createProblem,
  groupProposal,
  incompleteCount,
  locationProblem,
  matchesProposalFilters,
  NEEDS_LOCATION,
  NO_PROPOSAL_FILTERS,
  observationsAt,
  proposalTypes,
  removeLocation,
  removeObservation,
  restoreObservation,
  sameAs,
  updateObservation,
} from './proposal'

const loc = (
  ref: string,
  name: string,
  extra: Partial<ProposedLocation> = {},
): ProposedLocation => ({
  ref,
  existingId: null,
  kind: 'building',
  building: 'Block A',
  floor: 'Level 1',
  name,
  ...extra,
})
const obs = (ref: string, locationRef: string | null): ProposedObservation => ({
  ref,
  note: ref,
  copeDimension: 'Occupancy',
  severity: 'high',
  locationRef,
  recordingSeq: 1,
  start: 0,
  end: 1,
  photoIds: [],
  check: { severity: true, category: true, location: false },
})
const proposal = (): Proposal => ({
  locations: [
    loc('loc-1', 'Loading bay', { existingId: 'e1' }),
    loc('loc-2', 'Chiller room'),
    loc('loc-3', 'Pump house', { kind: 'elsewhere', building: null, floor: null }),
  ],
  observations: [
    obs('obs-1', 'loc-2'),
    obs('obs-2', 'loc-2'),
    obs('obs-3', null),
    obs('obs-4', 'loc-1'),
  ],
})
const existing = [
  { id: 'e1', building: 'Block A', floor: 'Level 1', name: 'Loading bay' },
  { id: 'e2', building: 'Block A', floor: 'Level 1', name: 'Cold room' },
]

describe('site walk proposal edits', () => {
  it('groups observations with no place under No location yet, and places by building', () => {
    const { needsLocation, groups } = groupProposal(proposal())
    expect(needsLocation).toBe(true)
    expect(groups.map((g) => g.title)).toEqual(['Block A', 'Elsewhere on site'])
    expect(observationsAt(proposal(), NEEDS_LOCATION).map((o) => o.ref)).toEqual(['obs-3'])
    expect(observationsAt(proposal(), ALL)).toHaveLength(4)
  })

  it('"Same as" an existing location not yet in the proposal turns the new one into it', () => {
    const { proposal: p, ref } = sameAs(proposal(), 'loc-2', existing[1])
    expect(ref).toBe('loc-2')
    expect(p.locations.find((l) => l.ref === 'loc-2')).toMatchObject({
      existingId: 'e2',
      name: 'Cold room',
    })
    expect(observationsAt(p, 'loc-2')).toHaveLength(2)
  })

  it('"Same as" a location already in the proposal moves every observation to it', () => {
    const { proposal: p, ref } = sameAs(proposal(), 'loc-2', existing[0])
    expect(ref).toBe('loc-1')
    expect(p.locations.map((l) => l.ref)).toEqual(['loc-1', 'loc-3'])
    expect(observationsAt(p, 'loc-1').map((o) => o.ref)).toEqual(['obs-1', 'obs-2', 'obs-4'])
  })

  it('leaves Jev’s check flags in the data when a field changes', () => {
    const p = updateObservation(proposal(), 'obs-1', { severity: 'low' })
    expect(p.observations[0]).toMatchObject({
      severity: 'low',
      check: { severity: true, category: true, location: false },
    })
  })

  it('moves a deleted observation to the deleted list, newest first', () => {
    const p = removeObservation(removeObservation(proposal(), 'obs-2'), 'obs-4')
    expect(p.observations.map((o) => o.ref)).toEqual(['obs-1', 'obs-3'])
    expect(p.removed?.map((o) => o.ref)).toEqual(['obs-4', 'obs-2'])
  })

  it('puts a deleted observation back where it was', () => {
    const p = restoreObservation(removeObservation(proposal(), 'obs-2'), 'obs-2', 1)
    expect(p.observations.map((o) => o.ref)).toEqual(['obs-1', 'obs-2', 'obs-3', 'obs-4'])
    expect(p.removed).toEqual([])
  })

  it('puts a deleted observation last when no place is given', () => {
    const p = restoreObservation(removeObservation(proposal(), 'obs-1'), 'obs-1')
    expect(p.observations.map((o) => o.ref)).toEqual(['obs-2', 'obs-3', 'obs-4', 'obs-1'])
  })

  it('a new observation never takes the ref of a deleted one', () => {
    const p = removeObservation(proposal(), 'obs-4')
    const { observation } = addObservation(p, {
      note: 'New finding',
      copeDimension: 'Exposure',
      severity: 'low',
      locationRef: 'loc-1',
    })
    expect(observation.ref).toBe('obs-5')
  })

  it('restore gives a new ref when the deleted ref is in use again', () => {
    const original = proposal()
    const removed = original.observations[3]
    const clashing = { ...removed, note: 'Other' }
    const p = { ...removeObservation(original, removed.ref) }
    p.observations = [...p.observations, clashing]
    const restored = restoreObservation(p, removed.ref)
    expect(new Set(restored.observations.map((o) => o.ref)).size).toBe(5)
    expect(restored.observations.find((o) => o.note === removed.note)?.ref).toBe('obs-5')
  })

  it('restore clears a location that was deleted while the observation was removed', () => {
    const withoutPlace = removeLocation(removeObservation(proposal(), 'obs-1'), 'loc-2')
    expect(restoreObservation(withoutPlace, 'obs-1', 0).observations[0].locationRef).toBeNull()
  })

  it('filters by category, severity, type and status', () => {
    const base = obs('obs-9', 'loc-1')
    const f = NO_PROPOSAL_FILTERS
    expect(matchesProposalFilters(base, f)).toBe(true)
    expect(matchesProposalFilters(base, { ...f, sev: 'high' })).toBe(true)
    expect(matchesProposalFilters(base, { ...f, sev: 'low' })).toBe(false)
    expect(matchesProposalFilters(base, { ...f, cat: 'Occupancy' })).toBe(true)
    expect(matchesProposalFilters(base, { ...f, cat: 'Protection' })).toBe(false)
    expect(matchesProposalFilters(base, { ...f, status: 'Ready' })).toBe(true)
    const bare = { ...base, locationRef: null }
    expect(matchesProposalFilters(bare, { ...f, status: 'Needs details' })).toBe(true)
    expect(matchesProposalFilters(bare, { ...f, status: 'Ready' })).toBe(false)
  })

  it('names what an observation holds as Note, Voice, Photo and Scan', () => {
    const media = [
      { id: 'm1', kind: 'voice' },
      { id: 'm2', kind: 'page' },
    ] as Parameters<typeof proposalTypes>[1]
    const o = {
      ...obs('obs-9', 'loc-1'),
      recordingSeq: null,
      mediaIds: ['m1', 'm2'],
      photoIds: ['p1'],
    }
    expect(proposalTypes(o, media)).toEqual(['Note', 'Voice', 'Photo', 'Scan'])
    expect(proposalTypes({ ...o, note: ' ', mediaIds: [], photoIds: [] }, media)).toEqual([])
    expect(matchesProposalFilters(o, { ...NO_PROPOSAL_FILTERS, type: 'Scan' }, media)).toBe(true)
  })

  it('adds an observation by hand with no clip or photos', () => {
    const fields = { note: 'Rust.', copeDimension: 'Exposure' as const, severity: 'low' as const }
    const { proposal: p, observation } = addObservation(proposal(), {
      ...fields,
      locationRef: 'loc-3',
    })
    expect(observation).toMatchObject({ ref: 'obs-5', recordingSeq: null, photoIds: [] })
    expect(observationsAt(p, 'loc-3').map((o) => o.ref)).toEqual(['obs-5'])
  })

  it('moves a removed location’s observations to No location yet', () => {
    const p = removeLocation(proposal(), 'loc-2')
    expect(observationsAt(p, NEEDS_LOCATION).map((o) => o.ref)).toEqual(['obs-1', 'obs-2', 'obs-3'])
  })

  it('adds a location by the location form’s rules, linking one already on the assessment', () => {
    const p = proposal()
    const input = { kind: 'building' as const, building: 'block a', floor: 'L1', name: 'cold room' }
    expect(locationProblem(p, { ...input, building: ' ' })).toBe('Enter the building.')
    expect(locationProblem(p, { ...input, name: 'chiller room' })).toBe(
      'This location is already in the proposal.',
    )
    const { location } = addLocation(p, input, existing)
    expect(location).toMatchObject({ ref: 'loc-4', floor: 'Level 1', existingId: 'e2' })
  })

  it('refuses Create all while an observation has no note', () => {
    const p = updateObservation(proposal(), 'obs-1', { note: '  ' })
    expect(createProblem(p)).toBe('Write a note for one observation first.')
  })

  it('refuses Create all while an observation has no place, category or severity', () => {
    expect(createProblem(proposal())).toBe('Choose a location for one observation first.')
    let p = updateObservation(proposal(), 'obs-3', { locationRef: 'loc-1', copeDimension: null })
    expect(createProblem(p)).toBe('Choose a category for one observation first.')
    p = updateObservation(p, 'obs-3', { copeDimension: 'Exposure', severity: null })
    expect(createProblem(p)).toBe('Choose a severity for one observation first.')
  })

  it('counts the observations that still have an empty field', () => {
    expect(incompleteCount(proposal())).toBe(1)
    const p = updateObservation(proposal(), 'obs-1', { note: '' })
    expect(incompleteCount(p)).toBe(2)
  })
})

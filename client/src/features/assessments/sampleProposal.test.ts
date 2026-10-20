import { describe, expect, it } from 'vitest'
import { sampleInterpretation } from './demo-data'
import { statusOf } from './observationFilters'
import type { Observation } from './types'

// The demo's stand-in for a proposal (CP-05, CP-21), used when no capture
// session is live: labelled a sample, never a reading of the observation.
describe('sample proposals in the demo', () => {
  it('proposes the engineer’s categories, describing photos where the observation has them', () => {
    const sample = sampleInterpretation(['Occupancy', 'Exposure'], 'L22M LV switch room', true)

    expect(sample).toMatchObject({
      status: 'interpreting',
      hazardType: 'Housekeeping',
      sample: true,
      model: null,
    })
    expect(sample.categories.map((c) => c.category)).toEqual(['Occupancy', 'Exposure'])
    expect(sample.categories[0].reason).toMatch(/^A sample reason: /)
    expect(sample.description).toMatch(
      /^During the site visit to L22M LV switch room, it was observed that /,
    )
  })

  it('describes nothing for an observation without photos', () => {
    const sample = sampleInterpretation(['Protection'], 'Pump house', false)

    expect(sample).toMatchObject({ description: null, hazardType: null })
    expect(sample.categories).toHaveLength(1)
  })

  it('proposes a category for an uncategorised observation, so Add can show', () => {
    expect(sampleInterpretation([], 'Bay 3', true).categories[0].category).toBe('Protection')
  })

  it('reads as Interpreting until the sample settles', () => {
    const entry = {
      interpretation: sampleInterpretation(['Exposure'], 'Yard', true),
    } as Observation

    expect(statusOf(entry)).toBe('Interpreting')
    expect(
      statusOf({ ...entry, interpretation: { ...entry.interpretation!, status: 'interpreted' } }),
    ).toBe('Complete')
  })
})

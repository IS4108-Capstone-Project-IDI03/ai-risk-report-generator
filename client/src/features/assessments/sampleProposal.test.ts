import { describe, expect, it } from 'vitest'
import { sampleInterpretation, UNCATEGORISED } from './demo-data'
import { statusOf } from './observationFilters'
import type { Observation } from './types'

// The demo's stand-in for a photo proposal (CP-05), used when no capture
// session is live: labelled a sample, never a reading of the photo.
describe('sample photo proposals in the demo', () => {
  it('proposes the engineer’s category, naming where the photo was taken', () => {
    const sample = sampleInterpretation('Occupancy', 'L22M LV switch room')

    expect(sample).toMatchObject({
      status: 'interpreting',
      category: 'Occupancy',
      hazardType: 'Housekeeping',
      sample: true,
      model: null,
    })
    expect(sample.description).toMatch(
      /^During the site visit to L22M LV switch room, it was observed that /,
    )
  })

  it('proposes a category for an uncategorised observation, so Change category can show', () => {
    expect(sampleInterpretation(UNCATEGORISED, 'Bay 3').category).toBe('Protection')
  })

  it('reads as Interpreting until the sample settles', () => {
    const entry = { interpretation: sampleInterpretation('Exposure', 'Yard') } as Observation

    expect(statusOf(entry)).toBe('Interpreting')
    expect(
      statusOf({ ...entry, interpretation: { ...entry.interpretation!, status: 'interpreted' } }),
    ).toBe('Complete')
  })
})

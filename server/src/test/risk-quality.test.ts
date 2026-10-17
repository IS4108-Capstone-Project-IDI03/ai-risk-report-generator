// Section 4's rating rules (GN-03 AC1, AC3): the location score and rating from
// the seven category scores, with the basis behind each.
import { describe, expect, it } from 'vitest'
import { RQR_CATEGORIES, rate } from '../services/risk-quality.service'

const scores = (current: (number | null)[], potential: (number | null)[]) =>
  RQR_CATEGORIES.map((category, i) => ({
    category,
    current: current[i],
    potential: potential[i],
  }))

describe('rate', () => {
  it("scores and rates Marsh's Office 5 table with the provisional equal weights", () => {
    const result = rate(scores([9.0, 8.1, 8.0, 9.3, 8.0, 8.0, 8.3], Array(7).fill(10)))

    // Marsh's own spreadsheet gives 83.3: equal weights are provisional (AC3).
    expect(result.current).toEqual({ score: 83.9, rating: 'B', band: 'B: 70 to 84' })
    expect(result.potential).toEqual({ score: 100, rating: 'A', band: 'A: 85 to 100' })
    expect(result.basis.rulesVersion).toBe('rqr-provisional-equal-v1')
    expect(result.basis.weights).toHaveLength(7)
    expect(result.basis.weights.every((w) => w.weight === 1 / 7)).toBe(true)
  })

  it('bands a score by its one-decimal value at the legend edges', () => {
    // All seven equal, so the score is that score x 10.
    const at = (s: number) => rate(scores(Array(7).fill(s), Array(7).fill(10))).current?.rating
    expect(at(8.5)).toBe('A')
    expect(at(8.49)).toBe('B') // 84.9
    expect(at(7.0)).toBe('B')
    expect(at(6.99)).toBe('C') // 69.9
    expect(at(5.1)).toBe('C')
    expect(at(3.6)).toBe('D')
    expect(at(3.59)).toBe('E') // 35.9
  })

  it('makes up no score while a category is not entered (AC1)', () => {
    const result = rate(scores([9, 8, 8, 9, 8, 8, null], Array(7).fill(10)))
    expect(result.current).toBeNull()
    expect(result.potential?.rating).toBe('A')
  })
})

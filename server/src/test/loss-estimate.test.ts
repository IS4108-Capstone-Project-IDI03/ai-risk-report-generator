// Section 5's loss rules (GN-03 AC1, AC6, AC7): each level's property damage and
// business interruption from the engineer's values, % and months.
import { describe, expect, it } from 'vitest'
import {
  estimate,
  lossEstimatesSchema,
  lossEstimateFacts,
  type LossInputs,
} from '../services/loss-estimate.service'

const INPUTS: LossInputs = {
  currency: 'SGD',
  dateOfValues: '2026-01-01',
  indemnityMonths: 36,
  pd: [
    { key: 'office', item: 'Office', value: 1_000_000 },
    { key: 'hotel', item: 'Hotel', value: 2_000_000 },
  ],
  te: [{ key: 'hotel-gp', item: 'Hotel (Gross Profit)', value: 360_000 }],
  levels: [
    {
      level: 'I',
      pd: [
        { key: 'office', percent: 0 },
        { key: 'hotel', percent: 10 },
      ],
      te: [{ key: 'hotel-gp', months: 6, percent: 100 }],
    },
    {
      level: 'II',
      pd: [
        { key: 'office', percent: 0 },
        { key: 'hotel', percent: 28.4 },
      ],
      te: [{ key: 'hotel-gp', months: 12, percent: 100 }],
    },
    {
      level: 'III',
      pd: [
        { key: 'office', percent: 0 },
        { key: 'hotel', percent: 70 },
      ],
      te: [{ key: 'hotel-gp', months: 18, percent: 50 }],
    },
  ],
}

describe('estimate', () => {
  it('totals the values and works out each level row by row (AC6, AC7)', () => {
    const result = estimate(INPUTS)

    expect(result.values).toEqual({ pd: 3_000_000, te: 360_000, tiv: 3_360_000 })
    expect(result.rulesVersion).toBe('le-v1')
    const [one, two, three] = result.levels
    // PD: value x % damage. BI: value x months / indemnity months x % impacted.
    expect(one.pd.map((r) => r.loss)).toEqual([0, 200_000])
    expect(one.te[0]).toMatchObject({ item: 'Hotel (Gross Profit)', months: 6, loss: 60_000 })
    expect(one).toMatchObject({ pdLoss: 200_000, teLoss: 60_000, total: 260_000 })
    expect(two).toMatchObject({ pdLoss: 568_000, teLoss: 120_000, total: 688_000 })
    expect(three).toMatchObject({ pdLoss: 1_400_000, teLoss: 90_000, total: 1_490_000 })
  })

  it('makes up no figure for a row or total missing an input (AC1)', () => {
    const missing: LossInputs = {
      ...INPUTS,
      levels: [
        { ...INPUTS.levels[0], pd: [{ key: 'office', percent: 0 }] },
        ...INPUTS.levels.slice(1),
      ],
    }
    const [one] = estimate(missing).levels

    // The hotel has no % damage at Level I: its row and the totals stay empty.
    expect(one.pd[1]).toMatchObject({ item: 'Hotel', percent: null, loss: null })
    expect(one.pdLoss).toBeNull()
    expect(one.total).toBeNull()
    expect(one.teLoss).toBe(60_000)
  })

  it('has no business interruption figures until the indemnity period is entered', () => {
    const [one] = estimate({ ...INPUTS, indemnityMonths: null }).levels
    expect(one.teLoss).toBeNull()
  })
})

describe('lossEstimatesSchema', () => {
  it('refuses more outage months than the indemnity period, or a % over 100', () => {
    const tooLong = structuredClone(INPUTS)
    tooLong.levels[2].te[0].months = 40
    expect(lossEstimatesSchema.safeParse(tooLong).success).toBe(false)

    const over = structuredClone(INPUTS)
    over.levels[0].pd[1].percent = 120
    expect(lossEstimatesSchema.safeParse(over).success).toBe(false)

    expect(lossEstimatesSchema.safeParse(INPUTS).success).toBe(true)
  })
})

describe('independent property damage rows', () => {
  const custom = () => ({
    ...structuredClone(INPUTS),
    levels: INPUTS.levels.map((l) => ({
      ...structuredClone(l),
      pd: [],
      damageRows: [
        {
          key: 'floors',
          item: 'Floors 27–29',
          value: 300000,
          percent: 50,
        },
      ],
    })),
  })

  it('calculates independent rows, preserves site totals and passes their values to drafting', () => {
    const input = custom()
    input.levels[1].damageRows[0].value = 600000
    const parsed = lossEstimatesSchema.parse(input)
    const result = estimate(parsed)
    expect(result.values.pd).toBe(3000000)
    expect(result.levels.map((l) => l.pdLoss)).toEqual([150000, 300000, 150000])
    const facts = lossEstimateFacts({ inputs: parsed, updatedAt: new Date(), updatedBy: null! })
    expect(facts.facts).toContain('Floors 27–29 50% damage, loss 150000; value 300000')
  })

  it('keeps an explicitly empty level empty and incomplete rather than restoring site rows', () => {
    const input = custom()
    input.levels[0].damageRows = []
    expect(estimate(input).levels[0]).toMatchObject({ pd: [], pdLoss: null, total: null })
    expect(
      lossEstimateFacts({ inputs: input, updatedAt: new Date(), updatedBy: null! }).missing,
    ).toBeTruthy()
  })

  it('requires a name, unique keys, valid values and percentages for custom rows', () => {
    for (const change of [{ item: '' }, { value: -1 }, { percent: 101 }]) {
      const input = custom()
      Object.assign(input.levels[0].damageRows[0], change)
      expect(lossEstimatesSchema.safeParse(input).success).toBe(false)
    }
    const input = custom()
    input.levels[0].damageRows.push(input.levels[0].damageRows[0])
    expect(lossEstimatesSchema.safeParse(input).success).toBe(false)
  })

  it('leaves totals missing when a custom row has an unentered value', () => {
    const input = lossEstimatesSchema.parse(custom())
    input.levels[0].damageRows![0].value = null
    expect(estimate(input).levels[0].pdLoss).toBeNull()
  })
})

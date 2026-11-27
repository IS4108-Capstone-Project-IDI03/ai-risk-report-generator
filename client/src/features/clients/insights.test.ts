import { describe, expect, it } from 'vitest'
import type { InsightSite, InsightVisit } from './api'
import { cellText, changeRows, changeScale, heatStep } from './insights'

// CP-29: what the Insights tab works out from the gateway's figures.

const visit = (overrides: Partial<InsightVisit>): InsightVisit => ({
  reference: 'RPT-2026-0411',
  siteVisitDate: '2026-09-18',
  surveyType: 'Resurvey',
  observations: 6,
  criticalHigh: 7,
  ofis: 6,
  score: 48.6,
  rating: 'D',
  ...overrides,
})
const site = (name: string, visits: InsightVisit[]): InsightSite =>
  ({ id: name, name, visits }) as InsightSite

const FIRST = visit({
  reference: 'RPT-2025-0107',
  siteVisitDate: '2025-03-12',
  criticalHigh: 5,
  ofis: 4,
  score: 52.9,
  rating: 'C',
})

describe('heatStep', () => {
  it('shades a cell by its share of the largest, never blank for one observation', () => {
    expect(heatStep(0, 7)).toBe(0)
    expect(heatStep(1, 21)).toBe(1)
    expect(heatStep(4, 7)).toBe(4)
    expect(heatStep(7, 7)).toBe(7)
    expect(heatStep(3, 0)).toBe(0)
  })
})

describe('cellText', () => {
  it('says how many observations a cell holds and how severe', () => {
    expect(cellText('Tilbury', { category: 'Protection', count: 7, critical: 2, high: 3 })).toBe(
      'Tilbury · Protection: 7 observations (2 Critical, 3 High, 2 Moderate or Low).',
    )
    expect(cellText('Tilbury', { category: 'Exposure', count: 0, critical: 0, high: 0 })).toBe(
      'Tilbury · Exposure: no observations.',
    )
    expect(cellText('Grays', { category: null, count: 1, critical: 0, high: 0 })).toBe(
      'Grays · Uncategorised: 1 observation not yet categorised, left out of drafting.',
    )
  })
})

describe('changeRows', () => {
  const sites = [
    site('Tilbury', [FIRST, visit({})]),
    site('Tuas', [visit({ siteVisitDate: '2026-10-15', criticalHigh: 2, ofis: 3, score: null })]),
    site('Grays', []),
  ]

  it('judges fewer Critical and High findings as improved, more as worse', () => {
    const { max, ticks } = changeScale(sites, 'severity')
    expect({ max, ticks }).toEqual({ max: 8, ticks: [0, 4, 8] })

    const [tilbury, tuas, grays] = changeRows(sites, 'severity', max)

    expect(tilbury).toMatchObject({
      period: 'Mar 2025 to Sep 2026',
      values: '5 → 7',
      chip: { text: 'Worse', tone: 'danger' },
      span: { from: 5 / 8, width: 2 / 8 },
      label: 'Tilbury, Critical and High: 5 at the first visit, 7 at the latest. Worse.',
    })
    expect(tilbury.points.map((p) => p.kind)).toEqual(['first', 'latest'])
    expect(tuas).toMatchObject({
      period: 'Oct 2026',
      values: '2',
      chip: { text: 'First visit', tone: 'neutral' },
      span: null,
    })
    expect(grays).toMatchObject({
      values: '–',
      points: [],
      chip: { text: 'None yet', tone: 'neutral' },
    })
  })

  it('judges a higher score as improved, on an axis out of 100', () => {
    const { max } = changeScale(sites, 'score')
    expect(max).toBe(100)

    const [tilbury, tuas] = changeRows(sites, 'score', max)

    expect(tilbury).toMatchObject({ values: '52.9 → 48.6', chip: { text: 'Worse' } })
    // No score entered: nothing is drawn or guessed.
    expect(tuas).toMatchObject({ values: '–', points: [], chip: { text: 'Not entered' } })
  })

  it('does not judge a change in accepted OFIs', () => {
    const [tilbury] = changeRows(sites, 'ofis', changeScale(sites, 'ofis').max)

    expect(tilbury).toMatchObject({ values: '4 → 6', chip: { text: '2 more', tone: 'neutral' } })
  })
})

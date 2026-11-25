// The rules of a report comparison (RV-13) as pure functions: how the model's
// suggestion for each previous item is settled, figures' differences, New
// items, counts and order, what changed since a run, and which decisions
// Compare again keeps. The HTTP routes are covered by comparison.test.ts.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import type {
  ICurrentSource,
  IComparisonDecision,
  IPreviousItem,
} from '../models/report-comparison.model'
import {
  carryDecisions,
  changesLine,
  changesSince,
  countsLine,
  figureDifference,
  foldComparison,
  settleItem,
  severityChange,
  type SuggestedItem,
} from '../services/report-comparison-rules'

const previous = (n: number, extra: Partial<IPreviousItem> = {}): IPreviousItem => ({
  key: `P:9:0.${n}`,
  label: `P${n + 1}`,
  kind: 'finding',
  sectionId: '9',
  section: '9. Fire Protection',
  heading: 'Water Supply Details',
  quote: 'The fire pump churn pressure was 7.5 bar.',
  context: null,
  severity: 'high',
  priority: null,
  categories: ['Protection'],
  location: 'Pump room, B1',
  ...extra,
})

const source = (label: string, extra: Partial<ICurrentSource> = {}): ICurrentSource => ({
  key: `O:${label}`,
  label,
  kind: 'observation',
  sectionId: null,
  section: 'Observations',
  title: 'Pump room, B1',
  text: 'Fire pump churn pressure 6.9 bar.',
  severity: 'high',
  priority: null,
  categories: ['Protection'],
  location: 'Pump room, B1',
  observations: [label],
  finding: null,
  textHash: `t-${label}`,
  tagHash: `g-${label}`,
  ...extra,
})

const suggested = (extra: Partial<SuggestedItem> = {}): SuggestedItem => ({
  previous: 'P1',
  outcome: 'unchanged',
  sources: ['O1'],
  match: 'clear',
  disagree: [],
  possible: [],
  reason: 'The pressure is lower.',
  missing: null,
  figures: [],
  omitted: false,
  ...extra,
})

const labelled = (...sources: ICurrentSource[]) => new Map(sources.map((s) => [s.label, s]))

describe('Settling a suggestion', () => {
  it('keeps a clear match with a current source as the model said, High confidence', () => {
    const item = settleItem(suggested(), previous(0), labelled(source('O1')))

    expect(item).toMatchObject({
      outcome: 'unchanged',
      sources: ['O:O1'],
      confidence: 'high',
      corrections: [],
      missing: null,
    })
  })

  it('never lets silence be a fix: no current source is Not checked, saying what is missing', () => {
    for (const outcome of ['fixed', 'unchanged'] as const) {
      const item = settleItem(suggested({ outcome, sources: [] }), previous(0), labelled())

      expect(item.outcome).toBe('not_checked')
      expect(item.corrections).toEqual(['no_source'])
      expect(item.confidence).toBe('low')
      expect(item.missing).toMatch(/finding from 9\. Fire Protection/)
    }
  })

  it('takes a label it was not given as no source', () => {
    const item = settleItem(suggested({ sources: ['O9'] }), previous(0), labelled(source('O1')))

    expect(item.outcome).toBe('not_checked')
  })

  it('makes a changed severity Worse or Improved, showing both', () => {
    const worse = settleItem(
      suggested({ outcome: 'unchanged' }),
      previous(0),
      labelled(source('O1', { severity: 'critical' })),
    )
    const better = settleItem(
      suggested({ outcome: 'fixed' }),
      previous(0),
      labelled(source('O1', { severity: 'low' })),
    )
    const same = settleItem(suggested({ outcome: 'improved' }), previous(0), labelled(source('O1')))

    expect(worse).toMatchObject({ outcome: 'worse', corrections: ['severity'], confidence: 'low' })
    expect(better).toMatchObject({ outcome: 'improved', corrections: ['severity'] })
    expect(same).toMatchObject({ outcome: 'improved', corrections: [] })
    expect(severityChange(previous(0), [source('O1', { severity: 'critical' })])).toEqual({
      previous: 'High',
      current: 'Critical',
      direction: 1,
    })
  })

  it('compares an OFI by priority, Priority 1 the most urgent', () => {
    const ofi = previous(0, { kind: 'recommendation', severity: null, priority: 'Priority 2' })
    const now = source('R1', { kind: 'recommendation', severity: null, priority: 'Priority 1' })

    const item = settleItem(suggested({ sources: ['R1'] }), ofi, labelled(now))

    expect(item.outcome).toBe('worse')
    expect(severityChange(ofi, [now])).toEqual({
      previous: 'Priority 2',
      current: 'Priority 1',
      direction: 1,
    })
  })

  it('leaves the outcome to the engineer when sources disagree, capped at Medium', () => {
    const item = settleItem(
      suggested({ outcome: 'fixed', sources: ['O1', 'O2'], disagree: ['O1', 'O2'] }),
      previous(0),
      labelled(source('O1'), source('O2')),
    )

    expect(item).toMatchObject({ outcome: null, disagree: ['O:O1', 'O:O2'], confidence: 'medium' })
  })

  it('moves evidence named on a Not checked item to the possible matches', () => {
    const item = settleItem(
      suggested({ outcome: 'not_checked', sources: ['O1'], reason: null }),
      previous(0),
      labelled(source('O1')),
    )

    expect(item).toMatchObject({ sources: [], possible: ['O:O1'], confidence: 'medium' })
  })

  it('keeps a figure only when both values are written as copied, and works out the difference', () => {
    const item = settleItem(
      suggested({
        figures: [
          { name: 'Churn pressure', previous: '7.5 bar', current: '6.9 bar', source: 'O1' },
          { name: 'Made up', previous: '9 bar', current: '6.9 bar', source: 'O1' },
        ],
      }),
      previous(0),
      labelled(source('O1')),
    )

    expect(item.figures).toEqual([
      {
        name: 'Churn pressure',
        previous: '7.5 bar',
        current: '6.9 bar',
        source: 'O:O1',
        difference: '−0.6 bar',
        note: null,
      },
    ])
    expect(item.corrections).toEqual(['figure'])
    expect(item.confidence).toBe('medium')
  })
})

describe('Figure differences, worked out in code', () => {
  it('subtracts the digits as written, keeping the unit and grouping', () => {
    expect(figureDifference('7.5 bar', '6.9 bar')).toEqual({ difference: '−0.6 bar', note: null })
    expect(figureDifference('0.1 m', '0.3 m')).toEqual({ difference: '+0.2 m', note: null })
    expect(figureDifference('SGD 1,200,000', 'SGD 1,450,500')).toEqual({
      difference: '+SGD 250,500',
      note: null,
    })
    expect(figureDifference('12 hours', '12.0 hours')).toEqual({
      difference: 'No change',
      note: null,
    })
  })

  it('shows no difference across units or for more than one number', () => {
    expect(figureDifference('7.5 bar', '750 kPa').note).toBe(
      'The units differ, so no difference is shown.',
    )
    expect(figureDifference('2-3 hours', '4 hours').difference).toBeNull()
  })
})

describe('Reading a comparison', () => {
  const at = new Date('2026-08-01T10:00:00Z')
  const decision = (item: string, extra: Partial<IComparisonDecision>): IComparisonDecision => ({
    item,
    action: 'accept',
    outcome: 'unchanged',
    sources: [],
    note: null,
    dismissed: false,
    carriedFrom: null,
    by: { id: 'u1', name: 'Alex Rowe' },
    at,
    ...extra,
  })
  const sources = [
    source('O1'),
    source('O2', { severity: 'critical', text: 'Shutter jammed open.' }),
    source('O3', { severity: 'low' }),
    // A draft finding stands for the observation it cites (O3).
    source('F1', {
      key: 'F:9:d:0.0',
      kind: 'finding',
      observations: ['O3'],
      severity: 'low',
    }),
  ]
  const comparison = (decisions: IComparisonDecision[] = []) => ({
    _id: new Types.ObjectId(),
    createdAt: at,
    previousItems: [previous(0), previous(1), previous(2)],
    sources,
    items: [
      settleItem(suggested({ outcome: 'fixed' }), previous(0), labelled(...sources)),
      settleItem(
        suggested({ previous: 'P2', outcome: 'not_checked', sources: [] }),
        previous(1),
        labelled(...sources),
      ),
      settleItem(
        suggested({ previous: 'P3', outcome: 'worse', sources: ['O1'] }),
        previous(2),
        labelled(...sources),
      ),
    ],
    recheck: [],
    decisions,
  })

  it('lists unpaired current findings as New, a draft finding for the observation it cites', () => {
    const { items } = foldComparison(comparison())

    const fresh = items.filter((i) => i.kind === 'new').map((i) => i.source)
    expect(fresh).toEqual(['O:O2', 'F:9:d:0.0'])
  })

  it('orders Worse, New at Critical or High, Not checked, other New, then Unchanged, Improved, Fixed', () => {
    const { items, counts } = foldComparison(comparison())

    expect(items.map((i) => i.key)).toEqual([
      'P:9:0.2',
      'N:O:O2',
      'P:9:0.1',
      'N:F:9:d:0.0',
      'P:9:0.0',
    ])
    expect(countsLine(counts)).toBe('1 fixed, 1 worse, 2 new, 1 not checked')
  })

  it('applies the latest decision, which turns the AI marking neutral, and counts it', () => {
    const { items, counts } = foldComparison(
      comparison([
        decision('P:9:0.1', { action: 'outcome', outcome: 'fixed', note: 'Seen locked.' }),
        decision('N:O:O2', {
          action: 'dismiss',
          outcome: 'new',
          sources: ['O:O2'],
          dismissed: true,
        }),
      ]),
    )

    const fixed = items.find((i) => i.key === 'P:9:0.1')!
    expect(fixed).toMatchObject({ outcome: 'fixed', suggested: 'not_checked' })
    expect(fixed.decided).toMatchObject({
      action: 'outcome',
      by: { name: 'Alex Rowe' },
      note: 'Seen locked.',
    })
    const dismissed = items.find((i) => i.key === 'N:O:O2')!
    expect(dismissed).toMatchObject({ dismissed: true, decided: null })
    expect(items.at(-1)!.key).toBe('N:O:O2')
    expect(counts).toMatchObject({ fixed: 2, new: 1, dismissed: 1, total: 4 })
  })

  it('re-pairing a New item to a previous item takes it out of New', () => {
    const { items } = foldComparison(
      comparison([decision('P:9:0.1', { action: 'pair', outcome: 'worse', sources: ['O:O2'] })]),
    )

    expect(items.find((i) => i.key === 'P:9:0.1')).toMatchObject({
      outcome: 'worse',
      sources: ['O:O2'],
      severity: { previous: 'High', current: 'Critical', direction: 1 },
    })
    expect(items.some((i) => i.key === 'N:O:O2')).toBe(false)
  })

  it('names what changed in the evidence since it ran', () => {
    const now = [
      source('O1', { tagHash: 'changed' }),
      source('O3', { textHash: 'changed' }),
      source('O4'),
      { ...sources[3], textHash: 'changed' },
    ]

    const changes = changesSince(sources, now)

    expect(changes.map((c) => `${c.kind} ${c.change}`)).toEqual([
      'observation retagged',
      'observation edited',
      'observation added',
      'finding changed',
      'observation deleted',
    ])
    expect(changesLine(changes)).toBe(
      '1 observation added, 1 deleted, 1 retagged, 1 edited and 1 draft finding changed',
    )
  })

  it('Compare again keeps decisions whose evidence is unchanged and flags the rest', () => {
    const last = comparison([
      decision('P:9:0.0', { action: 'accept', outcome: 'unchanged', sources: ['O:O1'] }),
      decision('P:9:0.1', { action: 'outcome', outcome: 'fixed', note: 'Seen locked.' }),
    ])
    const now = sources.map((s) => (s.key === 'O:O1' ? { ...s, tagHash: 'changed' } : s))

    const { decisions, recheck } = carryDecisions(last, last.items, now)

    expect(decisions.map((d) => [d.item, String(d.carriedFrom)])).toEqual([
      ['P:9:0.1', String(last._id)],
    ])
    expect(recheck.map((r) => r.item).sort()).toEqual(['P:9:0.0', 'P:9:0.2'])
    expect(recheck.find((r) => r.item === 'P:9:0.0')!.reason).toMatch(/^You decided this before/)
  })
})

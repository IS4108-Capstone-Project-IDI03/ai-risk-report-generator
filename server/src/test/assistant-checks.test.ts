// MarshBot's rules without a database (AS-06): the item merge, when coverage is
// due, the report outline, and the checks the Check round fixed (review work
// after Ready to export, the stale export, unseen questions, quick decisions).
// The conversation built from them is tested in assistant-thread.test.ts.
// Each builds just the part of the check context the rule reads.
import { describe, expect, it } from 'vitest'
import type { CoverageState } from '../models/assistant-brief.model'
import type { ChecklistDto } from '../services/checklist.service'
import { coverageGaps } from '../services/assistant/checks/coverage-gaps'
import { quickDecision } from '../services/assistant/checks/quick-decision'
import { reviewItems } from '../services/assistant/checks/review-items'
import { staleExport } from '../services/assistant/checks/stale-export'
import { thinSections } from '../services/assistant/checks/thin-sections'
import { unseenQuestions } from '../services/assistant/checks/unseen-questions'
import type { CheckContext } from '../services/assistant/context'
import { coverageDue } from '../services/assistant/coverage.service'
import { raise } from '../services/assistant/item'
import type { BriefFacts } from '../services/assistant/phrases'
import { areaHealth, sectionStates } from '../services/assistant/progress'
import { mergeItems, type StoredBrief } from '../services/assistant/recheck.service'
import type { BriefItem } from '../services/assistant/types'

const NOW = new Date('2026-11-14T02:00:00Z')
const ctxOf = (part: Partial<CheckContext>) =>
  ({
    now: NOW,
    today: '2026-11-14',
    threads: [],
    activity: new Map(),
    draftedParts: [],
    changedSinceExport: [],
    firstActivityAt: null,
    ...part,
  }) as unknown as CheckContext

// A Review workspace section; `pending` findings of `total`, last decided at `decidedAt`.
const section = (
  id: string,
  { pending = 0, total = 2, decidedAt = '2026-11-13T02:00:00Z', rejected = false } = {},
) => ({
  id,
  title: `Section ${id}`,
  completion: { state: 'complete' },
  findings: { pending, total },
  review: { unsupportedStatements: 0, withdrawnSources: 0, changesSinceDraft: 0 },
  replacement: null,
  draft: {
    id: `d${id}`,
    subsections: [
      {
        statements: Array.from({ length: total }, () => ({
          review: { state: rejected ? 'rejected' : 'accepted' },
        })),
      },
    ],
  },
  history: [{ at: new Date(decidedAt) }],
})

const item = (id: string, kind = 'review-items') =>
  ({
    ...raise({
      id,
      kind,
      stage: 'review',
      weight: 'gap',
      title: id,
      fact: id,
      icon: 'x',
      facts: { id },
    }),
    firstSeenAt: '2026-11-13T00:00:00.000Z',
    resolvedAt: null,
  }) as BriefItem

describe('mergeItems', () => {
  const today = NOW.toISOString().slice(0, 10)
  it.each([
    ['keeps when a raised item was first seen', [item('a')], ['a'], 'a', false, '2026-11-13'],
    ['resolves one no longer raised', [item('a')], [], 'a', true, '2026-11-13'],
    ['opens a new one now', [], ['b'], 'b', false, today],
    [
      'reopens one raised again after it was resolved',
      [{ ...item('a'), resolvedAt: '2026-11-13T05:00:00.000Z' }],
      ['a'],
      'a',
      false,
      today,
    ],
  ])('%s', (_, stored, raised, id, resolved, firstSeen) => {
    const merged = mergeItems(
      stored,
      raised.map((r) => item(r)),
      NOW,
    )
    const found = merged.find((i) => i.id === id && !!i.resolvedAt === resolved)
    expect(found?.firstSeenAt.slice(0, 10)).toBe(firstSeen)
  })
})

describe('coverageDue', () => {
  const brief = (
    stage: string,
    coverage: Partial<CoverageState>,
    facts: Partial<BriefFacts> = {},
  ) =>
    ({
      stage,
      facts: {
        hasChecklist: true,
        categorisedObservations: 1,
        evidenceFingerprint: 'new',
        ...facts,
      },
      coverage: {
        status: 'idle',
        startedAt: null,
        checkedAt: null,
        fingerprint: 'old',
        ...coverage,
      },
    }) as unknown as StoredBrief
  const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000)
  it.each([
    ['changed evidence in Capture', brief('capture', {}), true],
    ['before Prepare', brief('setup', {}), false],
    ['from Review on', brief('review', {}), false],
    ['no checklist', brief('capture', {}, { hasChecklist: false }), false],
    ['no categorised observation', brief('capture', {}, { categorisedObservations: 0 }), false],
    ['evidence already checked', brief('capture', { fingerprint: 'new' }), false],
    ['checked 2 minutes ago', brief('capture', { checkedAt: minutesAgo(2) }), false],
    ['checked 6 minutes ago', brief('capture', { checkedAt: minutesAgo(6) }), true],
    ['running', brief('capture', { status: 'running', startedAt: minutesAgo(1) }), false],
    ['stuck running', brief('capture', { status: 'running', startedAt: minutesAgo(6) }), true],
  ])('%s', (_, b, due) => expect(coverageDue(b, NOW)).toBe(due))
})

describe('sectionStates', () => {
  it('is empty before anything is drafted', () => {
    expect(sectionStates(ctxOf({}))).toEqual([])
  })
  it.each([
    ['decisions left', section('4', { pending: 1 }), ['decisions', null]],
    ['nothing decided yet', section('4', { pending: 2 }), ['not_started', null]],
    ['all decided, dated by the last decision', section('4'), ['reviewed', '2026-11-13']],
  ])('%s', (_, s, expected) => {
    const workspace = { sections: [s] } as unknown as CheckContext['workspace']
    const found = sectionStates(ctxOf({ draftedParts: ['4'], workspace })).find(
      (x) => x.sectionId === '4',
    )
    expect([found?.state, found?.date]).toEqual(expected)
  })
})

describe('after Ready to export (#6, #7)', () => {
  const workspace = {
    sections: [section('7', { pending: 1 })],
  } as unknown as CheckContext['workspace']

  it('still raises review work that reopened', () => {
    for (const stage of ['ready_to_export', 'exported'] as const)
      expect(reviewItems(ctxOf({ stage, workspace })).map((i) => i.id)).toEqual(['review.pending'])
  })

  it('offers the newer version only once the export check is known to be clear', () => {
    const exported = (blockers: CheckContext['blockers']) =>
      staleExport(
        ctxOf({
          stage: 'exported',
          changedSinceExport: ['7'],
          blockers,
          assessment: { exportedAt: NOW } as CheckContext['assessment'],
        }),
      )
    expect(exported(null)).toEqual([])
    expect(exported([{ sectionId: '7', title: '7', where: 'review', reason: 'x' }])).toEqual([])
    expect(exported([]).map((i) => i.id)).toEqual(['exported.stale'])
  })
})

describe('unseenQuestions (#8)', () => {
  const ctx = (seen: Record<string, number>) =>
    ctxOf({
      stage: 'review',
      sections: [
        {
          section: { id: '7', title: 'Construction' },
          latest: { _id: 'd7', questions: ['a', 'b'] },
        },
      ] as unknown as CheckContext['sections'],
      activity: new Map([['section:7', { engagedMs: 600_000, seen }]]),
    })
  it.each([
    ['engaged time alone sees nothing', {}, 2],
    ['one question of this draft seen', { 'question:d7:0': 2500 }, 1],
    ["an older draft's questions seen", { 'question:d6:0': 2500, 'question:d6:1': 2500 }, 2],
    ['both seen', { 'question:d7:0': 2500, 'question:d7:1': 2000 }, 0],
  ])('%s', (_, seen, unseen) => {
    expect(unseenQuestions(ctx(seen))[0]?.facts.unseen ?? 0).toBe(unseen)
  })
})

describe('quickDecision (#15)', () => {
  const ctx = (s: ReturnType<typeof section>, firstActivityAt: Date | null) =>
    ctxOf({
      stage: 'review',
      workspace: { sections: [s] } as unknown as CheckContext['workspace'],
      firstActivityAt,
    })
  const before = new Date('2026-11-12T00:00:00Z')
  it.each([
    ['decided quickly after tracking began', section('5'), before, 1],
    ['decided before tracking began', section('5'), new Date('2026-11-13T05:00:00Z'), 0],
    ['nothing tracked at all', section('5'), null, 0],
    ['every finding rejected (no NaN)', section('5', { rejected: true }), before, 0],
    ['findings still to decide', section('5', { pending: 1 }), before, 0],
  ])('%s', (_, s, first, n) => expect(quickDecision(ctx(s, first))).toHaveLength(n))
})

describe('areaHealth (#52)', () => {
  // RPT-2026-0072's shape: areas in checklist order, `covered` of `total` checked.
  const shape: [string, string, number, number][] = [
    ['5', 'Management Programs', 5, 6],
    ['9', 'Fire Protection', 4, 12],
    ['6', 'Construction', 7, 8],
    ['11', 'External Exposures', 0, 5],
  ]
  const checklist = {
    areas: shape.map(([id, title]) => ({ id, title })),
    items: shape.flatMap(([area, , covered, total]) =>
      Array.from({ length: total }, (_, n) => ({
        id: `${area}.${n}`,
        area,
        status: 'active',
        check: n < covered ? { by: 'x' } : null,
      })),
    ),
  } as unknown as ChecklistDto
  // The coverage check called every area's items uncovered and one observation thin.
  const coverage = {
    uncovered: checklist.items.map((i) => i.id),
    thin: [{ observationId: 'o1', sectionId: '5', reason: 'vague' }],
  } as unknown as CoverageState

  it('marks only the areas the rules call thin, worst first', () => {
    expect(areaHealth(checklist).map(({ open, ...a }) => ({ ...a, open: open.length }))).toEqual([
      { area: 'External Exposures', total: 5, covered: 0, thin: true, open: 5 },
      { area: 'Fire Protection', total: 12, covered: 4, thin: true, open: 8 },
      { area: 'Management Programs', total: 6, covered: 5, thin: false, open: 1 },
      { area: 'Construction', total: 8, covered: 7, thin: false, open: 1 },
    ])
  })

  it("keeps coverage's uncovered items in their own rows, worst area first", () => {
    const ctx = ctxOf({
      stage: 'capture',
      checklist,
      coverage,
      areas: areaHealth(checklist),
      observations: [],
    })
    expect(
      coverageGaps(ctx)
        .filter((i) => i.kind === 'coverage-uncovered')
        .map((i) => i.title),
    ).toEqual(['External Exposures', 'Fire Protection', 'Management Programs', 'Construction'])
  })
})

describe('thinSections (RPT-2026-0092)', () => {
  it('counts one observation in the singular', () => {
    const sections = [
      {
        section: { id: '9', title: 'Fire Protection', min_observations: 1 },
        latest: null,
        usableObservations: 0,
      },
    ] as unknown as CheckContext['sections']
    const [item] = thinSections(ctxOf({ stage: 'ready_for_generation', sections }))
    expect(item.detail).toBe('0 of 1 observation needed')
    expect(item.fact).toBe('Fire Protection has 0 of the 1 observation it needs.')
  })
})

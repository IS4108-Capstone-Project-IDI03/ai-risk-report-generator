// MarshBot's read-only summary (AS-06, for the mobile app): GET .../assistant/summary gives the
// stage, the three facts, the one next step, the open items most urgent first and the checklist
// areas that need more, and unlike GET .../assistant it records no open, saves no conversation
// and makes no wording or coverage call. rag-service is faked (assistant-fixtures.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssistantThreadModel } from '../models/assistant-thread.model'
import { AssistantViewerModel } from '../models/assistant-viewer.model'
import { settleBackground } from '../services/assistant/background'
import { summaryOf, type AssistantSummary } from '../services/assistant/summary'
import type { ThreadBrief } from '../services/assistant/thread/types'
import type { BriefItem } from '../services/assistant/types'
import { drainInlineJobs } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import { assessment, observation, people, rag, REF, session, stubRag } from './assistant-fixtures'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const url = `/api/assessments/${REF}/assistant/summary`
const SURVEY_DAY = new Date('2026-11-14T02:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(SURVEY_DAY)
  stubRag()
})
afterEach(async () => {
  await drainInlineJobs()
  await settleBackground()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// A stored item, as the checks raise it.
const item = (
  id: string,
  weight: BriefItem['weight'],
  extra: Partial<BriefItem> = {},
): BriefItem => ({
  id,
  kind: id.split(':')[0],
  stage: 'capture',
  weight,
  title: `Title ${id}`,
  detail: `Detail ${id}`,
  fact: `Fact ${id}.`,
  icon: 'circle-alert',
  link: { tab: 'observations', params: { obs: id } },
  action: null,
  actionTarget: null,
  facts: {},
  fingerprint: `fp-${id}`,
  dismissible: weight !== 'fix_now',
  firstSeenAt: '2026-11-14T01:00:00.000Z',
  resolvedAt: null,
  ...extra,
})
const brief = (items: BriefItem[], extra: Partial<ThreadBrief> = {}) =>
  ({
    reference: REF,
    stage: 'capture',
    items,
    areas: [],
    sections: [],
    coverage: {
      status: 'idle',
      startedAt: null,
      checkedAt: null,
      fingerprint: null,
      uncovered: [],
      thin: [],
    },
    facts: { reportDue: '2026-12-18', observations: 0, surveyStart: '2026-11-14' },
    updatedAt: new Date('2026-11-14T02:00:00Z'),
    ...extra,
  }) as unknown as ThreadBrief

describe('summaryOf (what the summary says)', () => {
  it('ranks Fix now, then gaps, then reminders; leaves out info, resolved and dismissed items', () => {
    const s = summaryOf(
      brief([
        item('reminder:a', 'reminder'),
        item('gap:b', 'gap'),
        item('info:c', 'info'),
        item('fix:d', 'fix_now'),
        item('gap:resolved', 'gap', { resolvedAt: '2026-11-14T01:30:00.000Z' }),
        item('gap:dismissed', 'gap'),
      ]),
      [{ itemId: 'gap:dismissed', fingerprint: 'fp-gap:dismissed' }],
      SURVEY_DAY,
    )
    expect(s.items.map((i) => i.id)).toEqual(['fix:d', 'gap:b', 'reminder:a'])
    expect(s.items[0]).toEqual({
      id: 'fix:d',
      weight: 'fix_now',
      icon: 'circle-alert',
      title: 'Title fix:d',
      detail: 'Detail fix:d',
      link: { tab: 'observations', params: { obs: 'fix:d' } },
    })
  })

  it('brings a dismissed item back once the thing it is about has changed', () => {
    const s = summaryOf(
      brief([item('gap:b', 'gap', { fingerprint: 'new' })]),
      [{ itemId: 'gap:b', fingerprint: 'old' }],
      SURVEY_DAY,
    )
    expect(s.items.map((i) => i.id)).toEqual(['gap:b'])
  })

  it('names the first open item as the next step, with a button for where it points', () => {
    const s = summaryOf(brief([item('gap:b', 'gap'), item('fix:d', 'fix_now')]), [], SURVEY_DAY)
    expect(s.next).toEqual({
      text: 'Fact fix:d.',
      link: { tab: 'observations', params: { obs: 'fix:d' } },
      label: 'Open observations',
    })
  })

  it("falls back to the stage's own next move when nothing is open", () => {
    const s = summaryOf(brief([]), [], SURVEY_DAY)
    expect(s).toMatchObject({ stage: 'capture', stageLabel: 'Capture', stageIndex: 2, items: [] })
    expect(s.next).toMatchObject({ link: { tab: 'observations' }, label: 'Open observations' })
    expect(s.next.text).toContain('ready to generate')
    // A stage with no move left has no button.
    expect(summaryOf(brief([], { stage: 'exported' }), [], SURVEY_DAY).next).toMatchObject({
      link: null,
      label: null,
    })
  })

  it('gives exactly three facts and only the checklist areas that need more', () => {
    const s = summaryOf(
      brief([], {
        areas: [
          { area: 'Security', total: 4, covered: 1, thin: true, open: [] },
          { area: 'Construction', total: 4, covered: 4, thin: false, open: [] },
        ],
      }),
      [],
      SURVEY_DAY,
    )
    expect(s.glance).toHaveLength(3)
    expect(s.areas).toEqual([
      {
        area: 'Security',
        covered: 1,
        total: 4,
        link: { tab: 'checklist', params: { area: 'Security' } },
      },
    ])
  })
})

describe('GET .../assistant/summary', () => {
  const body = (res: { body: unknown }) => res.body as AssistantSummary

  it("sends the engineer's summary, making the brief if none was saved yet", async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const s = await session(a._id)
    await observation(a._id, s._id, { failed: true })

    const res = await signedInAs(app, engineer).get(url)

    expect(res.status).toBe(200)
    expect(body(res)).toMatchObject({
      reference: REF,
      stage: 'capture',
      stageLabel: 'Capture',
      stageIndex: 2,
    })
    expect(body(res).glance).toHaveLength(3)
    expect(body(res).items[0]).toMatchObject({ weight: 'fix_now' })
    expect(body(res).next.text).toBeTruthy()
  })

  it('is read only: no open recorded, no conversation saved, no wording or coverage call', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const s = await session(a._id)
    await observation(a._id, s._id, { failed: true })
    const api = signedInAs(app, engineer)

    await api.get(url)
    await api.get(url)
    await settleBackground()

    expect(await AssistantViewerModel.countDocuments()).toBe(0)
    expect(await AssistantThreadModel.countDocuments()).toBe(0)
    expect(rag.calls.filter((c) => c.path.startsWith('/assistant/'))).toEqual([])
  })

  it('refuses a colleague and an admin (403), an unknown assessment (404) and an archived one (409)', async () => {
    const { engineer, admin, colleague } = await people()
    await assessment(engineer._id)
    expect((await signedInAs(app, colleague).get(url)).status).toBe(403)
    expect((await signedInAs(app, admin).get(url)).status).toBe(403)
    expect(
      (await signedInAs(app, engineer).get('/api/assessments/RPT-0000/assistant/summary')).status,
    ).toBe(404)
  })

  it('answers 409 with the cause for an archived assessment', async () => {
    const { engineer } = await people()
    await assessment(engineer._id, { archivedAt: new Date() })
    const res = await signedInAs(app, engineer).get(url)
    expect([res.status, res.body]).toEqual([409, { error: `Assessment ${REF} is archived.` }])
  })
})

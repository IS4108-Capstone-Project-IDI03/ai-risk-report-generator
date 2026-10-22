// Drafting Sections 4 and 5's wording (GN-03 AC1, AC4, AC9): only once the
// engineer's figures are complete, with those figures sent for the model to use
// unchanged, and out of date when they change. S4 is a stubbed fetch.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ObservationModel } from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'
import { SiteModel } from '../models/site.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

useMemoryMongo()

const engineer = {
  _id: new Types.ObjectId(),
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'alex@example.com',
  role: 'risk_engineer' as const,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}
const api = signedInAs(app, engineer)
const REFERENCE = 'RPT-2026-0315'
const base = `/api/assessments/${REFERENCE}`
const ROOM = new Types.ObjectId()

const ALL = ['Construction', 'Occupancy', 'Protection', 'Exposure']
const SECTIONS = [
  {
    id: '4',
    title: 'Risk Quality Ratings and Comments',
    cope_dimensions: ALL,
    min_observations: 1,
  },
  { id: '5', title: 'Loss Estimates', cope_dimensions: ALL, min_observations: 1 },
]
const drafts = vi.fn<(body: Record<string, unknown>) => Response>()
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const draftOf = (sectionId: string) => ({
  section_id: sectionId,
  title: SECTIONS.find((s) => s.id === sectionId)!.title,
  subsections: [
    {
      heading: 'Risk Quality Rating Comments',
      kind: 'narrative',
      statements: [{ text: 'Above average for its class.', citations: ['O:x'], supported: true }],
    },
  ],
  sources: {},
  questions: [],
  guardrail: { passed: true, unsupported_count: 0 },
  provenance: {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    effort: 'high',
    prompt_version: 'gn01-v2.6',
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: '2026-10-14T00:00:00+00:00',
  },
})

beforeEach(() => {
  drafts.mockImplementation((body) => json(draftOf(String(body.section_id))))
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) =>
    url.endsWith('/sections/draft')
      ? drafts(JSON.parse(String(init!.body)))
      : json({ template_version: 'global-pre-v2.0-2026-02', sections: SECTIONS }),
  )
})
afterEach(() => {
  drafts.mockReset()
  vi.unstubAllGlobals()
})

async function assessment() {
  const site = await SiteModel.create({
    code: 'SITE-0315',
    name: 'Tower',
    jurisdiction: 'SG',
    facilityType: 'Office',
  })
  const a = await AssessmentModel.create({
    reference: REFERENCE,
    site: site._id,
    client: 'Client',
    surveyType: 'Survey',
    engineer: engineer._id,
    locations: [{ _id: ROOM, name: 'Pump room', key: 'pump room' }],
  })
  const session = await CaptureSessionModel.create({
    assessment: a._id,
    status: 'ready_for_generation',
  })
  await ObservationModel.create({
    assessment: a._id,
    session: session._id,
    engineer: engineer.name,
    note: 'Sprinklered throughout, 2 fire pumps.',
    recordings: [],
    severity: 'low',
    location: ROOM,
    metadata: {
      source_type: 'observation',
      jurisdiction: 'SG',
      facility_type: 'Office',
      COPE_dimension: ['Protection'],
      effective_date: new Date(),
    },
  })
  return a
}

const scores = (current: number) => ({
  categories: [
    'External Exposure',
    'Fire Protection',
    'Occupancy Hazards',
    'Construction',
    'Water Supply',
    'Surveillance',
    'Management Programs',
  ].map((category) => ({ category, current, potential: 10 })),
})
const VALUES = {
  currency: 'SGD',
  dateOfValues: '2026-01-01',
  indemnityMonths: 12,
  pd: [{ key: 'b', item: 'Buildings', value: 1_000_000 }],
  te: [{ key: 'bi', item: 'Business Interruption', value: 120_000 }],
  levels: (['I', 'II', 'III'] as const).map((level, i) => ({
    level,
    pd: [{ key: 'b', percent: [5, 30, 80][i] }],
    te: [{ key: 'bi', months: [1, 6, 12][i], percent: 100 }],
  })),
}
const section = async (id: string) =>
  (await api.get(`${base}/sections`)).body.find((s: { id: string }) => s.id === id)

describe('Section 4 comments (GN-03)', () => {
  it('cannot be drafted until all seven scores are entered, and says so (AC1)', async () => {
    await assessment()
    expect((await section('4')).inputsMissing).toBe(
      'Enter all seven current and potential scores first.',
    )

    const res = await api.post(`${base}/sections/4/draft`)

    expect(res.status).toBe(422)
    expect(res.body.error).toBe('Enter all seven current and potential scores first.')
    expect(drafts).not.toHaveBeenCalled()
  })

  it('sends the computed rating and the scores as facts, and saves them with the draft (AC4)', async () => {
    await assessment()
    await api.put(`${base}/risk-quality`).send(scores(8))
    expect((await section('4')).inputsMissing).toBeNull()

    expect((await api.post(`${base}/sections/4/draft`)).status).toBe(201)

    const facts = String(drafts.mock.calls[0][0].facts)
    expect(facts).toContain('Current Location Risk Quality Score: 80')
    expect(facts).toContain('Current Location Risk Quality Rating: B')
    expect(facts).toContain('Potential Location Risk Quality Rating: A')
    expect(facts).toContain('Fire Protection: current 8, potential 10')
    expect((await ReportSectionModel.findOne({ sectionId: '4' }).lean())?.facts).toBe(facts)
  })

  it('is out of date once the scores change after drafting', async () => {
    await assessment()
    await api.put(`${base}/risk-quality`).send(scores(8))
    await api.post(`${base}/sections/4/draft`)
    expect((await section('4')).changesSinceDraft).toBe(0)

    await api.put(`${base}/risk-quality`).send(scores(7))

    const after = await section('4')
    expect(after.changesSinceDraft).toBe(1)
    expect(after.changeCounts).toEqual({ added: 0, changed: 0, removed: 0, figures: 1 })
  })
})

describe('Figure progress in Review before drafting', () => {
  const figures = async (id: string) =>
    (await api.get(`${base}/review`)).body.sections.find((s: { id: string }) => s.id === id).figures

  it('counts the Section 4 scores saved so far', async () => {
    await assessment()
    expect(await figures('4')).toEqual({ state: 'none', entered: 0, total: 14 })

    const some = scores(8).categories.map((c, i) => (i < 4 ? c : { ...c, current: null }))
    await api.put(`${base}/risk-quality`).send({ categories: some })
    expect(await figures('4')).toEqual({ state: 'some', entered: 11, total: 14 })

    await api.put(`${base}/risk-quality`).send(scores(8))
    expect(await figures('4')).toEqual({ state: 'all', entered: 14, total: 14 })
  })

  it('says whether Section 5 is partly or fully entered', async () => {
    await assessment()
    expect((await figures('5')).state).toBe('none')
    await api.put(`${base}/loss-estimates`).send({ ...VALUES, levels: [] })
    expect((await figures('5')).state).toBe('some')
    await api.put(`${base}/loss-estimates`).send(VALUES)
    expect((await figures('5')).state).toBe('all')
  })
})

describe('Section 4 after a score is cleared (GN-03 AC1)', () => {
  const cleared = () => {
    const body = scores(8)
    body.categories[0] = { ...body.categories[0], current: null as unknown as number }
    return body
  }

  it('shows the draft as out of date, and refuses to regenerate it until the scores are complete', async () => {
    await assessment()
    await api.put(`${base}/risk-quality`).send(scores(8))
    await api.post(`${base}/sections/4/draft`)

    await api.put(`${base}/risk-quality`).send(cleared())

    expect((await section('4')).changeCounts.figures).toBe(1)
    const res = await api.post(`${base}/sections/4/regenerate`).send({})
    expect(res.status).toBe(422)
    expect(res.body.error).toBe('Enter all seven current and potential scores first.')
  })

  it('records who saved the figures', async () => {
    const a = await assessment()
    await api.put(`${base}/risk-quality`).send(scores(8))
    await api.put(`${base}/loss-estimates`).send(VALUES)

    const saved = await AssessmentModel.findById(a._id).lean()
    expect(String(saved?.riskQuality?.updatedBy)).toBe(String(engineer._id))
    expect(String(saved?.lossEstimates?.updatedBy)).toBe(String(engineer._id))
  })
})

describe('Sections 4 and 5 in the Executive Summary (GN-03, GN-07 AC3)', () => {
  it('counts Section 4 as complete once drafted with its figures, and not after they are cleared', async () => {
    await assessment()
    const missing = async () =>
      (await api.get(`${base}/summary`)).body.executiveSummary.missing.map(
        (s: { id: string }) => s.id,
      )
    expect(await missing()).toContain('4')

    await api.put(`${base}/risk-quality`).send(scores(8))
    await api.post(`${base}/sections/4/draft`)
    expect(await missing()).not.toContain('4')

    // A score cleared again: the section's figures are incomplete, so it is too.
    const cleared = scores(8)
    cleared.categories[0] = { ...cleared.categories[0], current: null as unknown as number }
    await api.put(`${base}/risk-quality`).send(cleared)
    expect(await missing()).toContain('4')
  })
})

describe('Section 5 scenarios (GN-03)', () => {
  it('cannot be drafted until the values and every level are entered (AC1)', async () => {
    await assessment()
    await api.put(`${base}/loss-estimates`).send({ ...VALUES, levels: VALUES.levels.slice(0, 2) })

    const res = await api.post(`${base}/sections/5/draft`)

    expect(res.status).toBe(422)
    expect(res.body.error).toBe(
      'Enter the values, currency, date, indemnity period and every level’s % and months first.',
    )
  })

  it("sends the values and each level's figures as facts (AC9)", async () => {
    await assessment()
    await api.put(`${base}/loss-estimates`).send(VALUES)

    expect((await api.post(`${base}/sections/5/draft`)).status).toBe(201)

    const facts = String(drafts.mock.calls[0][0].facts)
    expect(facts).toContain('Values in SGD as at 2026-01-01; indemnity period 12 months.')
    expect(facts).toContain('Buildings: 1000000')
    expect(facts).toContain(
      'Level II: Buildings 30% damage, loss 300000; Business Interruption 6 months at 100% impacted, loss 60000; total 360000.',
    )
  })
})

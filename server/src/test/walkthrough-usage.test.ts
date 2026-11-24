// F-12: AI calls made for a walkthrough are costed as `walkthrough` usage, never to an
// assessment (ADR 0003): a call on a practice assessment (by its reference, as background jobs
// record it), a try-it's request marked `x-walkthrough`, or a request on a practice assessment's path.
// Usage and Costs shows them as their own "Walkthrough" group; an engineer sees only their own.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { walkthroughUsage } from '../middleware/practice.middleware'
import { recordAiCalls, walkthroughRequest } from '../services/ai-usage.service'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const person = (role: 'risk_engineer' | 'knowledge_admin', name: string) => ({
  _id: new Types.ObjectId(),
  staffId: `T-${name}`,
  name,
  email: `${name}@example.com`,
  role,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
})
const alex = person('risk_engineer', 'alex')
const jide = person('risk_engineer', 'jide')
const sana = person('knowledge_admin', 'sana')
const asAlex = signedInAs(app, alex)
const asJide = signedInAs(app, jide)
const asSana = signedInAs(app, sana)

// One usage item as a Python service sends it.
const wire = (feature = 'draft-section') => ({
  feature,
  billed_service: 'anthropic',
  model: 'claude-opus-5-5',
  duration_ms: 100,
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 0,
  usage_status: 'recorded',
})

beforeEach(async () => {
  await UserModel.create([alex, jide, sana])
  const site = await SiteModel.create({
    code: 'SITE-0001',
    name: 'Tuas',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const base = { site: site._id, surveyType: 'First survey', locations: [] }
  await AssessmentModel.create({ ...base, reference: 'RPT-2026-0001', engineer: alex._id })
  await AssessmentModel.create({
    ...base,
    reference: 'PRACTICE-0001',
    engineer: alex._id,
    practice: 'live',
  })
})
afterEach(() => vi.unstubAllGlobals())

const stored = () => AiCallModel.find().sort({ _id: 1 }).lean()

describe('recording a walkthrough call (F-12)', () => {
  it("stores a practice assessment's call as walkthrough, with no report, for its owner", async () => {
    await recordAiCalls([wire()], { reportId: 'PRACTICE-0001', section: '7' })

    const [row] = await stored()
    expect(row).toMatchObject({ feature: 'walkthrough', userId: alex._id })
    expect(row.reportId).toBeUndefined()
    expect(row.section).toBeUndefined()
  })

  it('keeps the user a call names, and leaves a real assessment’s call as it was', async () => {
    await recordAiCalls([wire('ask')], { reportId: 'PRACTICE-0001', userId: String(jide._id) })
    await recordAiCalls([wire()], { reportId: 'RPT-2026-0001', section: '7' })

    const [practice, real] = await stored()
    expect(practice).toMatchObject({ feature: 'walkthrough', userId: jide._id })
    expect(real).toMatchObject({
      feature: 'draft-section',
      reportId: 'RPT-2026-0001',
      section: '7',
    })
  })

  describe('during a request (dictating, whose call names no assessment or user)', () => {
    beforeEach(() =>
      vi.stubGlobal('fetch', async () =>
        Response.json({ transcript: 'The riser is open.', usage: [wire('transcribe')] }),
      ),
    )
    const dictate = (reference: string) =>
      asAlex
        .post(`/api/assessments/${reference}/dictation`)
        .set('Content-Type', 'audio/webm')
        .send(Buffer.from('fake-audio'))

    it('ignores x-walkthrough on a real assessment, so its call keeps its own feature', async () => {
      const res = await dictate('RPT-2026-0001').set('x-walkthrough', 'chat')

      expect(res.status).toBe(200)
      const [row] = await stored()
      expect(row.feature).toBe('transcribe')
    })

    it('counts a call on a practice assessment as walkthrough without the header', async () => {
      expect((await dictate('PRACTICE-0001')).status).toBe(200)
      expect(await stored()).toMatchObject([{ feature: 'walkthrough', userId: alex._id }])
    })

    it('leaves an ordinary request’s call as it was', async () => {
      expect((await dictate('RPT-2026-0001')).status).toBe(200)
      const [row] = await stored()
      expect(row.feature).toBe('transcribe')
      expect(row.userId).toBeUndefined()
    })
  })

  // The middleware alone: whether it marks a request as walkthrough work.
  it('trusts x-walkthrough only with a known try-it id, on the route that try-it calls', () => {
    const marks = (path: string, id?: string) => {
      let marked = false
      const req = { path, headers: id ? { 'x-walkthrough': id } : {}, cookies: {} }
      walkthroughUsage(req as never, {} as never, () => {
        marked = !!walkthroughRequest.getStore()
      })
      return marked
    }
    expect(marks('/api/chat', 'chat')).toBe(true)
    expect(marks('/api/client-intakes', 'new-docs')).toBe(true)
    expect(marks('/api/client-intakes/abc/read', 'new-docs')).toBe(true)
    expect(marks('/api/client-intakes/abc/create', 'new-docs')).toBe(false)
    expect(marks('/api/chat', 'new-docs')).toBe(false)
    expect(marks('/api/chat', '1')).toBe(false)
    expect(marks('/api/assessments/RPT-2026-0001/ask', 'chat')).toBe(false)
    expect(marks('/api/assessments/PRACTICE-0001/ask')).toBe(true)
  })
})

describe('walkthrough calls in Usage and Costs (F-12)', () => {
  // Alex's report call, chat and walkthrough; Jide's walkthrough.
  beforeEach(async () => {
    await recordAiCalls([wire()], { reportId: 'RPT-2026-0001', section: '7' })
    await recordAiCalls([wire('chat')], { userId: String(alex._id) })
    await recordAiCalls([wire()], { reportId: 'PRACTICE-0001', section: '7' })
    await recordAiCalls([wire('ask')], { reportId: 'PRACTICE-0001', userId: String(jide._id) })
  })
  type Group = { key: string; label: string; calls: number; reference: string | null }
  const groups = async (as: typeof asAlex, groupBy: string) =>
    (await as.get(`/api/usage/overview?groupBy=${groupBy}&split=feature&range=all`)).body
      .groups as Group[]
  const walkthroughFeature = async (as: typeof asAlex) =>
    (await as.get('/api/usage/summary')).body.byFeature.find(
      (f: { key: string }) => f.key === 'walkthrough',
    )

  it('form their own "Walkthrough" group by assessment, apart from the Chatbot', async () => {
    const all = await groups(asSana, 'assessment')
    expect(all.find((g) => g.key === 'walkthrough')).toMatchObject({
      label: 'Walkthrough',
      reference: null,
      calls: 2,
    })
    expect(all.find((g) => g.key === 'chat')).toMatchObject({ label: 'Chatbot', calls: 1 })
    expect(all.map((g) => g.key)).not.toContain('PRACTICE-0001')
  })

  it('show an engineer only their own walkthrough calls', async () => {
    expect((await groups(asAlex, 'assessment')).find((g) => g.key === 'walkthrough')).toMatchObject(
      { calls: 1 },
    )
    expect((await groups(asJide, 'assessment')).map((g) => [g.key, g.calls])).toEqual([
      ['walkthrough', 1],
    ])
  })

  it('belong to the user who made them when grouped by engineer', async () => {
    const all = await groups(asSana, 'engineer')
    expect(all.find((g) => g.key === String(alex._id))).toMatchObject({ calls: 3 })
    expect(all.find((g) => g.key === String(jide._id))).toMatchObject({ calls: 1 })
  })

  it("appear in the summary's by-feature list, an engineer's own only", async () => {
    expect(await walkthroughFeature(asSana)).toMatchObject({ calls: 2 })
    expect(await walkthroughFeature(asAlex)).toMatchObject({ calls: 1 })
    expect(await walkthroughFeature(asJide)).toMatchObject({ calls: 1 })
    expect((await asAlex.get('/api/usage/summary')).body.reports).toEqual(['RPT-2026-0001'])
  })
})

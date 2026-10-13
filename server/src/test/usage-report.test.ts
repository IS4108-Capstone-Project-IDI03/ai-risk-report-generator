// EV-04: the usage and cost report built from ai_calls (EV-03). No paid calls.
import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
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
const asSana = signedInAs(app, sana)

const call = (over: Record<string, unknown> = {}) => ({
  feature: 'draft-section',
  billedService: 'anthropic',
  model: 'claude-opus-5-5',
  reportId: 'RPT-A',
  durationMs: 100,
  inputTokens: 1000,
  outputTokens: 500,
  cacheReadTokens: 0,
  searchUnits: null,
  audioSeconds: null,
  usageStatus: 'recorded',
  estimatedCostUsd: 0.5,
  pricingBasis: 'Anthropic list price, 2026-10-08',
  ...over,
})

// Rows are plain objects here; the model checks them when saved.
const seed = (rows: object[]) => AiCallModel.create(rows as never[])

async function assessments() {
  const site = await SiteModel.create({
    code: 'S1',
    name: 'Site',
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  const base = { site: site._id, client: 'C', surveyType: 'Property risk survey' }
  await AssessmentModel.create({ ...base, reference: 'RPT-A', engineer: alex._id })
  await AssessmentModel.create({ ...base, reference: 'RPT-B', engineer: jide._id })
}

describe('GET /api/usage/summary (EV-04)', () => {
  it('totals cost per feature, always listing every feature, chatbot included (AC1)', async () => {
    await seed([
      call(),
      call({ estimatedCostUsd: 0.25 }),
      call({
        feature: 'retrieval',
        billedService: 'cohere-rerank',
        model: 'rerank-v3.5',
        estimatedCostUsd: 0.002,
      }),
    ])
    const { body } = await asSana.get('/api/usage/summary')
    expect(body.byFeature.map((f: { key: string }) => f.key)).toEqual([
      'draft-section',
      'retrieval',
      'transcribe',
      'label-document',
      'interpret-photo',
      'ocr',
      'embed-document',
      'chat',
    ])
    const draft = body.byFeature[0]
    expect(draft).toMatchObject({ calls: 2 })
    expect(draft.estimatedCostUsd).toBeCloseTo(0.75, 6)
    expect(body.byFeature[2]).toMatchObject({ key: 'transcribe', calls: 0, estimatedCostUsd: 0 })
    expect(body.totals.estimatedCostUsd).toBeCloseTo(0.752, 6)
    expect(body.totals.calls).toBe(3)
  })

  it('groups the same costs by billed service (AC3)', async () => {
    await seed([
      call(),
      call({ feature: 'retrieval', billedService: 'cohere-embed', estimatedCostUsd: 0.01 }),
      call({ feature: 'retrieval', billedService: 'cohere-embed', estimatedCostUsd: 0.02 }),
    ])
    const { body } = await asSana.get('/api/usage/summary')
    const embed = body.byService.find((s: { key: string }) => s.key === 'cohere-embed')
    expect(embed.calls).toBe(2)
    expect(embed.estimatedCostUsd).toBeCloseTo(0.03, 6)
    expect(body.byService.map((s: { key: string }) => s.key)).not.toContain('openai-whisper')
  })

  it('summarises latency per feature: average, median, p95, slowest (AC5)', async () => {
    await seed([100, 200, 300, 400].map((d) => call({ durationMs: d })))
    const draft = (await asSana.get('/api/usage/summary')).body.byFeature[0]
    expect(draft.latency).toEqual({ avgMs: 250, p50Ms: 200, p95Ms: 400, maxMs: 400 })
  })

  it('sums tokens, and reports search units and audio minutes where there are no tokens (AC6)', async () => {
    await seed([
      call({ cacheReadTokens: 200 }),
      call({ cacheReadTokens: 300, inputTokens: null, outputTokens: null }),
      call({
        feature: 'retrieval',
        billedService: 'cohere-rerank',
        inputTokens: null,
        outputTokens: null,
        searchUnits: 2,
      }),
      call({
        feature: 'transcribe',
        billedService: 'openai-whisper',
        inputTokens: null,
        outputTokens: null,
        audioSeconds: 90,
      }),
    ])
    const { body } = await asSana.get('/api/usage/summary')
    expect(body.byFeature[0]).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 500,
    })
    expect(body.byFeature[1].searchUnits).toBe(2)
    expect(body.byFeature[2].audioSeconds).toBe(90)
  })

  it('does not add calls without a cost as zero, and flags estimates (AC7)', async () => {
    await seed([
      call(),
      call({
        estimatedCostUsd: null,
        usageStatus: 'unavailable',
        inputTokens: null,
        outputTokens: null,
        pricingBasis: 'provider gave no usage',
      }),
      call({
        feature: 'retrieval',
        billedService: 'cohere-embed',
        estimatedCostUsd: 0.01,
        pricingBasis: 'estimate supplied by Chris, 2026-10-08',
      }),
    ])
    const { body } = await asSana.get('/api/usage/summary')
    expect(body.totals).toMatchObject({ calls: 3, callsWithoutCost: 1, estimatedCalls: 1 })
    expect(body.totals.estimatedCostUsd).toBeCloseTo(0.51, 6)
    expect(body.pricingBases).toEqual(
      expect.arrayContaining([
        { basis: 'estimate supplied by Chris, 2026-10-08', calls: 1, isEstimate: true },
        { basis: 'Anthropic list price, 2026-10-08', calls: 1, isEstimate: false },
      ]),
    )
  })

  it("shows one report's cost when it is chosen (AC2)", async () => {
    await assessments()
    await seed([call(), call({ reportId: 'RPT-B', estimatedCostUsd: 2 })])
    const { body } = await asSana.get('/api/usage/summary?reportId=RPT-B')
    expect(body.scope).toEqual({ reportId: 'RPT-B' })
    expect(body.totals.estimatedCostUsd).toBeCloseTo(2, 6)
    expect(body.reports.sort()).toEqual(['RPT-A', 'RPT-B'])
  })

  it('reports an empty scope as zero calls (AC8)', async () => {
    const { body } = await asSana.get('/api/usage/summary')
    expect(body.totals).toMatchObject({ calls: 0, estimatedCostUsd: 0 })
    expect(body.reports).toEqual([])
  })

  it('limits a risk engineer to the reports assigned to them (AC9)', async () => {
    await assessments()
    await seed([call(), call({ reportId: 'RPT-B', estimatedCostUsd: 2 })])
    const mine = await asAlex.get('/api/usage/summary')
    expect(mine.status).toBe(200)
    expect(mine.body.totals.estimatedCostUsd).toBeCloseTo(0.5, 6)
    expect(mine.body.reports).toEqual(['RPT-A'])
    expect((await asAlex.get('/api/usage/summary?reportId=RPT-B')).status).toBe(403)
    expect((await asAlex.get('/api/usage/export.csv?reportId=RPT-B&groupBy=feature')).status).toBe(
      403,
    )
  })

  it('needs a signed-in user', async () => {
    const { default: request } = await import('supertest')
    expect((await request(app).get('/api/usage/summary')).status).toBe(401)
  })
})

describe('GET /api/usage/export.csv (AC4)', () => {
  it('exports the breakdown by feature, one row per feature', async () => {
    await seed([
      call(),
      call({ feature: 'retrieval', billedService: 'cohere-embed', estimatedCostUsd: 0.01 }),
    ])
    const res = await asSana.get('/api/usage/export.csv?groupBy=feature')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="usage-by-feature/)
    const lines = res.text.trim().split('\n')
    expect(lines[0]).toBe(
      'feature,calls,estimated_cost_usd,calls_without_cost,estimated_calls,input_tokens,output_tokens,cache_read_tokens,search_units,audio_seconds,avg_ms,p50_ms,p95_ms,max_ms',
    )
    expect(lines).toHaveLength(9)
    expect(lines[1]).toMatch(/^draft-section,1,0\.5,/)
  })

  it('exports the breakdown by billed service', async () => {
    await seed([call()])
    const res = await asSana.get('/api/usage/export.csv?groupBy=service')
    expect(res.text.split('\n')[0]).toMatch(/^billed_service,calls,/)
    expect(res.text).toContain('anthropic,1,0.5,')
  })

  it('rejects an unknown grouping', async () => {
    expect((await asSana.get('/api/usage/export.csv?groupBy=nope')).status).toBe(400)
  })
})

describe('GET /api/usage/overview (EV-04)', () => {
  afterEach(() => vi.useRealTimers())

  // The people the overview names: saved, as the gateway reads names from users.
  const people = () => UserModel.collection.insertMany([alex, jide, sana])
  type Group = {
    key: string
    label: string
    reference: string | null
    client: string | null
    siteName: string | null
    engineerId: string | null
    engineerName: string | null
    lastActivityAt: string
    calls: number
    estimatedCostUsd: number
    callsWithoutCost: number
    segments: Record<string, number>
  }
  type Overview = {
    groups: Group[]
    splitKeys: string[]
    totals: { calls: number; estimatedCostUsd: number; callsWithoutCost: number }
    pricingBases: { basis: string }[]
  }
  const overview = async (query: string, as = asSana) => {
    const res = await as.get(`/api/usage/overview?${query}`)
    return { status: res.status, body: res.body as Overview }
  }
  const group = (groups: Group[], key: string) => groups.find((g) => g.key === key)!
  const chat = (userId: Types.ObjectId) =>
    call({ feature: 'chat', billedService: 'cohere-embed', reportId: undefined, userId })

  it('gives each assessment its cost, split by billed service, costliest first (AC1, AC3)', async () => {
    await people()
    await assessments()
    await seed([
      call(),
      call({ billedService: 'cohere-embed', feature: 'retrieval', estimatedCostUsd: 0.1 }),
      call({ reportId: 'RPT-B', estimatedCostUsd: 2 }),
    ])

    const { status, body } = await overview('groupBy=assessment&split=service&range=all')

    expect(status).toBe(200)
    expect(body.groups.map((g) => g.key)).toEqual(['RPT-B', 'RPT-A'])
    const a = group(body.groups, 'RPT-A')
    expect(a).toMatchObject({
      label: 'RPT-A',
      reference: 'RPT-A',
      client: 'C',
      siteName: 'Site',
      engineerId: String(alex._id),
      engineerName: 'alex',
      calls: 2,
    })
    expect(a.estimatedCostUsd).toBeCloseTo(0.6, 6)
    expect(a.segments.anthropic).toBeCloseTo(0.5, 6)
    expect(a.segments['cohere-embed']).toBeCloseTo(0.1, 6)
    expect(body.splitKeys).toEqual(['anthropic', 'cohere-embed'])
    expect(body.totals.calls).toBe(3)
    expect(body.totals.estimatedCostUsd).toBeCloseTo(2.6, 6)
  })

  it('adds up each engineer: their assessments and their chat, split by feature', async () => {
    await people()
    await assessments()
    await seed([
      call(),
      call({ reportId: 'RPT-B', estimatedCostUsd: 2 }),
      { ...chat(alex._id), estimatedCostUsd: 0.01 },
    ])

    const { body } = await overview('groupBy=engineer&split=feature&range=all')

    const mine = group(body.groups, String(alex._id))
    expect(mine).toMatchObject({ label: 'alex', engineerName: 'alex', calls: 2 })
    expect(mine.segments['draft-section']).toBeCloseTo(0.5, 6)
    expect(mine.segments.chat).toBeCloseTo(0.01, 6)
    expect(group(body.groups, String(jide._id)).estimatedCostUsd).toBeCloseTo(2, 6)
  })

  it('shows chat, which has no assessment, as one Chatbot group by assessment', async () => {
    await people()
    await seed([chat(alex._id), chat(jide._id)])

    const { body } = await overview('groupBy=assessment&split=service&range=all')

    expect(body.groups).toHaveLength(1)
    expect(body.groups[0]).toMatchObject({
      key: 'chat',
      label: 'Chatbot',
      calls: 2,
      reference: null,
    })
  })

  it('leaves out document ingestion, which has its own tab', async () => {
    await assessments()
    await seed([
      call(),
      call({ feature: 'label-document', reportId: undefined, documentId: new Types.ObjectId() }),
      call({ feature: 'ocr', reportId: undefined, documentId: new Types.ObjectId() }),
      call({
        feature: 'embed-document',
        billedService: 'cohere-embed',
        reportId: undefined,
        documentId: new Types.ObjectId(),
      }),
    ])

    const { body } = await overview('groupBy=assessment&split=feature&range=all')

    expect(body.groups.map((g) => g.key)).toEqual(['RPT-A'])
    expect(body.splitKeys).toEqual(['draft-section'])
  })

  it('counts calls without a cost but never adds them as zero (AC7)', async () => {
    await assessments()
    await seed([
      call(),
      call({
        estimatedCostUsd: null,
        usageStatus: 'unavailable',
        pricingBasis: 'provider gave no usage',
      }),
    ])

    const { body } = await overview('groupBy=assessment&split=service&range=all')

    expect(body.groups[0]).toMatchObject({ calls: 2, callsWithoutCost: 1 })
    expect(body.groups[0].estimatedCostUsd).toBeCloseTo(0.5, 6)
    expect(body.totals.callsWithoutCost).toBe(1)
    expect(body.pricingBases.map((b) => b.basis)).toContain('provider gave no usage')
  })

  it('keeps to the chosen period: last 7 or 30 days, this month in Singapore, or all time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
    await assessments()
    // Saved straight to the collection so each keeps the time it was made.
    const at = (iso: string, cost: number) => ({
      ...call({ estimatedCostUsd: cost }),
      callCount: 1,
      createdAt: new Date(iso),
    })
    await AiCallModel.collection.insertMany([
      at('2026-10-10T00:00:00Z', 1), // 3 days ago
      at('2026-09-30T17:00:00Z', 2), // 1 Oct, 01:00 in Singapore
      at('2026-09-30T15:00:00Z', 4), // 30 Sep, 23:00 in Singapore
      at('2026-08-01T00:00:00Z', 8), // over 30 days ago
    ])
    const total = async (range: string) =>
      (await overview(`groupBy=assessment&split=service&range=${range}`)).body.totals
        .estimatedCostUsd

    expect(await total('7d')).toBeCloseTo(1, 6)
    expect(await total('month')).toBeCloseTo(3, 6)
    expect(await total('30d')).toBeCloseTo(7, 6)
    expect(await total('all')).toBeCloseTo(15, 6)
  })

  it('names when each group last used AI, for sorting by time', async () => {
    await assessments()
    await AiCallModel.collection.insertMany([
      { ...call(), callCount: 1, createdAt: new Date('2026-10-01T00:00:00Z') },
      { ...call(), callCount: 1, createdAt: new Date('2026-10-05T00:00:00Z') },
    ])

    const { body } = await overview('groupBy=assessment&split=service&range=all')

    expect(body.groups[0].lastActivityAt).toBe('2026-10-05T00:00:00.000Z')
  })

  it('narrows to one engineer’s assessments when their bar is chosen', async () => {
    await people()
    await assessments()
    await seed([call(), call({ reportId: 'RPT-B', estimatedCostUsd: 2 })])

    const { body } = await overview(
      `groupBy=assessment&split=service&range=all&engineer=${String(jide._id)}`,
    )

    expect(body.groups.map((g) => g.key)).toEqual(['RPT-B'])
  })

  it('counts each call a summed row stands for', async () => {
    await assessments()
    await seed([call({ callCount: 3 })])

    const { body } = await overview('groupBy=assessment&split=service&range=all')

    expect(body.groups[0].calls).toBe(3)
  })

  it('shows a risk engineer only their own assessments and chat (AC9)', async () => {
    await people()
    await assessments()
    await seed([
      call(),
      call({ reportId: 'RPT-B', estimatedCostUsd: 2 }),
      chat(alex._id),
      chat(jide._id),
    ])

    const byAssessment = await overview('groupBy=assessment&split=service&range=all', asAlex)
    expect(byAssessment.body.groups.map((g) => g.key).sort()).toEqual(['RPT-A', 'chat'])
    expect(group(byAssessment.body.groups, 'chat').calls).toBe(1)
    const byEngineer = await overview('groupBy=engineer&split=service&range=all', asAlex)
    expect(byEngineer.body.groups.map((g) => g.key)).toEqual([String(alex._id)])
  })

  it('rejects an unknown grouping, split, period or engineer', async () => {
    expect((await overview('groupBy=nope&split=service&range=all')).status).toBe(400)
    expect((await overview('groupBy=assessment&split=nope&range=all')).status).toBe(400)
    expect((await overview('groupBy=assessment&split=service&range=year')).status).toBe(400)
    expect((await overview('groupBy=assessment&split=service&range=all&engineer=x')).status).toBe(
      400,
    )
  })
})

// EV-04: the usage and cost report built from ai_calls (EV-03). No paid calls.
import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import {
  labelUsageToWire,
  recordAiCalls,
  type CallContext,
  type WireUsage,
} from '../services/ai-usage.service'
import { AssessmentModel } from '../models/assessment.model'
import { IngestionJobModel } from '../models/ingestion-job.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
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

describe('GET /api/usage/summary for one assessment: the drill-in (EV-04 AC2)', () => {
  type Summary = {
    byFeatureService: { feature: string; calls: number; segments: Record<string, number> }[]
    bySection: {
      section: string | null
      title: string
      calls: number
      drafts: number
      estimatedCostUsd: number
      callsWithoutCost: number
    }[]
  }
  const summary = async (query = 'reportId=RPT-A') =>
    (await asSana.get(`/api/usage/summary?${query}`)).body as Summary
  const embed = (over: Record<string, unknown> = {}) =>
    call({ feature: 'retrieval', billedService: 'cohere-embed', estimatedCostUsd: 0.1, ...over })

  it('splits each feature by the service that billed it', async () => {
    await assessments()
    await seed([call(), embed(), call({ feature: 'transcribe', billedService: 'openai-whisper' })])

    const { byFeatureService } = await summary()

    expect(byFeatureService.map((f) => f.feature)).toEqual([
      'draft-section',
      'transcribe',
      'retrieval',
    ])
    expect(byFeatureService[0].segments).toEqual({ anthropic: 0.5 })
    expect(byFeatureService[2]).toMatchObject({ calls: 1, segments: { 'cohere-embed': 0.1 } })
  })

  it('gives each report section its drafting cost and runs, in report order', async () => {
    await assessments()
    await seed([
      call({ section: '7' }),
      embed({ section: '7' }),
      call({ section: '7' }),
      call({ section: '2', estimatedCostUsd: 0.3 }),
      // Saved before sections were recorded.
      call({ estimatedCostUsd: 0.2 }),
      // Not drafting, so in no section.
      call({ feature: 'transcribe', billedService: 'openai-whisper', section: undefined }),
    ])

    const { bySection } = await summary()

    expect(bySection.map((s) => [s.section, s.title, s.drafts, s.calls])).toEqual([
      ['2', 'Executive Summary', 1, 1],
      ['7', 'Construction', 2, 3],
      [null, 'Unspecified', 1, 1],
    ])
    expect(bySection[1].estimatedCostUsd).toBeCloseTo(1.1, 6)
  })

  it('names OFIs as Section 3 and counts a section call without a cost apart', async () => {
    await assessments()
    await seed([call({ section: '3', estimatedCostUsd: null, pricingBasis: 'no price for model' })])

    const [ofis] = (await summary()).bySection

    expect(ofis).toMatchObject({
      section: '3',
      title: 'Opportunities for Improvement',
      calls: 1,
      callsWithoutCost: 1,
      estimatedCostUsd: 0,
    })
  })

  it('has no sections when no assessment is chosen', async () => {
    await assessments()
    await seed([call({ section: '7' })])

    expect((await summary('')).bySection).toEqual([])
  })
})

describe('GET /api/usage/overview/export.csv (EV-04 AC4)', () => {
  const people = () => UserModel.collection.insertMany([alex, jide, sana])

  it('writes the overview on screen: one row per group, a column per split key', async () => {
    await people()
    await assessments()
    await seed([
      call(),
      call({ feature: 'retrieval', billedService: 'cohere-embed', estimatedCostUsd: 0.1 }),
      call({ reportId: 'RPT-B', estimatedCostUsd: 2 }),
    ])

    const res = await asSana.get(
      '/api/usage/overview/export.csv?groupBy=assessment&split=service&range=all',
    )

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="usage-by-assessment-service-all.csv"',
    )
    const lines = res.text.trim().split('\n')
    expect(lines[0]).toBe(
      'group,reference,client,site,engineer,last_activity,calls,calls_without_cost,estimated_cost_usd,anthropic,cohere-embed',
    )
    expect(lines[1]).toMatch(/^RPT-B,RPT-B,C,Site,jide,[^,]+,1,0,2,2,0$/)
    expect(lines[2]).toMatch(/^RPT-A,RPT-A,C,Site,alex,[^,]+,2,0,0\.6,0\.5,0\.1$/)
  })

  it('keeps to the risk engineer’s own scope and refuses an unknown grouping', async () => {
    await people()
    await assessments()
    await seed([call(), call({ reportId: 'RPT-B', estimatedCostUsd: 2 })])

    const mine = await asAlex.get(
      '/api/usage/overview/export.csv?groupBy=assessment&split=feature&range=all',
    )
    expect(mine.text.trim().split('\n')).toHaveLength(2)
    expect(mine.text).not.toContain('RPT-B')
    expect(
      (await asSana.get('/api/usage/overview/export.csv?groupBy=nope&split=feature&range=all'))
        .status,
    ).toBe(400)
  })
})

describe('GET /api/usage/ingestion (EV-04, ingestion tab)', () => {
  type Doc = {
    key: string
    title: string
    fileName: string | null
    status: string | null
    saved: boolean
    uploadedAt: string | null
    pages: number | null
    calls: number
    estimatedCostUsd: number
    callsWithoutCost: number
    usdPerPage: number | null
    avgMsPerCall: number | null
    lastActivityAt: string
    segments: Record<string, number>
  }
  type Ingestion = {
    documents: Doc[]
    splitKeys: string[]
    totals: { calls: number; estimatedCostUsd: number }
  }
  const ingestion = async (query = 'split=service&range=all', as = asSana) => {
    const res = await as.get(`/api/usage/ingestion?${query}`)
    return { status: res.status, body: res.body as Ingestion }
  }
  const nfpa = new Types.ObjectId()
  const scan = new Types.ObjectId()
  // Stored documents and their ingestion jobs, written straight to the collections.
  async function documents() {
    await KnowledgeDocumentModel.collection.insertMany([
      {
        _id: nfpa,
        title: 'NFPA 13',
        fileName: 'nfpa13.pdf',
        status: 'complete',
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
      {
        _id: scan,
        title: 'Old scanned code',
        fileName: 'scan.pdf',
        status: 'failed',
        createdAt: new Date('2026-10-02T00:00:00Z'),
      },
    ])
    await IngestionJobModel.collection.insertOne({ documentId: nfpa, pageTotal: 40 })
  }
  const ingest = (documentId: Types.ObjectId | undefined, over: Record<string, unknown> = {}) =>
    call({ reportId: undefined, documentId, ...over })
  const ocr = (id?: Types.ObjectId, over: Record<string, unknown> = {}) =>
    ingest(id, { feature: 'ocr', billedService: 'gemini-ocr', estimatedCostUsd: 0.6, ...over })
  const embed = (id?: Types.ObjectId) =>
    ingest(id, { feature: 'embed-document', billedService: 'cohere-embed', estimatedCostUsd: 0 })
  const label = (id?: Types.ObjectId) =>
    ingest(id, { feature: 'label-document', billedService: 'anthropic', estimatedCostUsd: 0.2 })

  it('gives each document its cost, split by billed service, with its pages and cost per page', async () => {
    await documents()
    await seed([ocr(nfpa, { callCount: 30 }), embed(nfpa), label(nfpa), ocr(scan), call()])

    const { status, body } = await ingestion()

    expect(status).toBe(200)
    expect(body.documents.map((d) => d.key)).toEqual([String(nfpa), String(scan)])
    const [doc] = body.documents
    expect(doc).toMatchObject({
      title: 'NFPA 13',
      fileName: 'nfpa13.pdf',
      status: 'complete',
      saved: true,
      uploadedAt: '2026-10-01T00:00:00.000Z',
      pages: 40,
      calls: 32,
    })
    expect(doc.estimatedCostUsd).toBeCloseTo(0.8, 6)
    expect(doc.usdPerPage).toBeCloseTo(0.02, 6)
    expect(doc.segments).toEqual({ 'gemini-ocr': 0.6, 'cohere-embed': 0, anthropic: 0.2 })
    // A document that failed before parsing has no page count, so no cost per page.
    expect(body.documents[1]).toMatchObject({ status: 'failed', pages: null, usdPerPage: null })
    // Report generation is on the other tab.
    expect(body.totals.calls).toBe(33)
    expect(body.splitKeys).toEqual(['gemini-ocr', 'anthropic', 'cohere-embed'])
  })

  it('splits by stage when asked', async () => {
    await documents()
    await seed([ocr(nfpa), embed(nfpa), label(nfpa)])

    const { body } = await ingestion('split=feature&range=all')

    expect(Object.keys(body.documents[0].segments).sort()).toEqual([
      'embed-document',
      'label-document',
      'ocr',
    ])
  })

  it('keeps the cost of an upload that was never saved, and of labelling from before ids', async () => {
    await documents()
    const rejected = new Types.ObjectId()
    await seed([label(rejected), label(undefined)])

    const { body } = await ingestion()

    expect(body.documents.find((d) => d.key === String(rejected))).toMatchObject({
      title: 'Upload not saved',
      saved: false,
      fileName: null,
    })
    expect(body.documents.find((d) => d.key === 'unlinked')).toMatchObject({
      title: 'Not linked to a document',
      saved: false,
    })
  })

  it('gives the average time per call, as a summed row holds the time of all its calls', async () => {
    await documents()
    await seed([ocr(nfpa, { callCount: 4, durationMs: 8000 }), ocr(nfpa, { durationMs: 3000 })])

    const { body } = await ingestion()

    expect(body.documents[0].avgMsPerCall).toBe(2200)
  })

  it('is for knowledge admins only, and refuses an unknown split or period', async () => {
    expect((await ingestion('split=service&range=all', asAlex)).status).toBe(403)
    expect((await ingestion('split=nope&range=all')).status).toBe(400)
    expect((await ingestion('split=service&range=year')).status).toBe(400)
  })

  it('exports the documents on screen as CSV, a column per split key', async () => {
    await documents()
    await seed([ocr(nfpa), label(nfpa)])

    const res = await asSana.get('/api/usage/ingestion/export.csv?split=service&range=all')

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="usage-ingestion-service-all.csv"',
    )
    const [head, row] = res.text.trim().split('\n')
    expect(head).toBe(
      'title,file_name,status,uploaded_at,pages,calls,calls_without_cost,estimated_cost_usd,usd_per_page,gemini-ocr,anthropic',
    )
    expect(row).toBe('NFPA 13,nfpa13.pdf,complete,2026-10-01T00:00:00.000Z,40,2,0,0.8,0.02,0.6,0.2')
    expect(
      (await asAlex.get('/api/usage/ingestion/export.csv?split=service&range=all')).status,
    ).toBe(403)
  })
})

describe('latency with summed ingestion rows (EV-04 AC5)', () => {
  it('averages per call and leaves summed rows out of the percentiles', async () => {
    await seed([
      call({ feature: 'ocr', reportId: undefined, callCount: 4, durationMs: 400 }),
      call({ feature: 'ocr', reportId: undefined, durationMs: 100 }),
    ])

    const { body } = await asSana.get('/api/usage/summary')
    const ocr = body.byFeature.find((f: { key: string }) => f.key === 'ocr')

    expect(ocr.latency).toEqual({ avgMs: 100, p50Ms: 100, p95Ms: 100, maxMs: 100 })
    expect(ocr.calls).toBe(5)
  })
})

describe('usage and rates on the detail pages (EV-04)', () => {
  afterEach(() => vi.useRealTimers())

  // A usage item as the services send it, saved the way the gateway saves it.
  const wire = (over: Partial<WireUsage> = {}): WireUsage => ({
    feature: 'draft-section',
    billed_service: 'anthropic',
    model: 'claude-opus-5-5',
    duration_ms: 100,
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 0,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
    ...over,
  })
  const record = (items: WireUsage[], context: CallContext = { reportId: 'RPT-A' }) =>
    recordAiCalls(items, context)
  const rowsOf = async (reportId = 'RPT-A') =>
    (await asSana.get(`/api/usage/summary?reportId=${reportId}`)).body.rateRows
  const tokens = (
    quantity: number,
    usdPer: number,
    costUsd: number,
    note: string | null = null,
  ) => ({
    quantity,
    unit: 'tokens',
    usdPer,
    per: 1e6,
    costUsd,
    note,
  })

  it('gives an assessment one row per feature and model, each quantity at the rate it was charged', async () => {
    // Sonnet 5.5 at $2 in, $10 out, $0.1 cached per 1M: 1,000,000 in = $2.00;
    // 100,000 out = $1.00; 500,000 cached = $0.05. $3.05 in all.
    await assessments()
    await record([
      wire({
        model: 'claude-sonnet-5-5',
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_read_tokens: 500_000,
      }),
    ])

    expect(await rowsOf()).toEqual([
      {
        feature: 'draft-section',
        service: 'anthropic',
        model: 'claude-sonnet-5-5',
        calls: 1,
        rates: 'charged',
        note: null,
        cells: {
          input: tokens(1_000_000, 2, 2),
          output: tokens(100_000, 10, 1),
          'cached input': tokens(500_000, 0.1, 0.05),
        },
        costUsd: 3.05,
        avgMsPerCall: 100,
      },
    ])
  })

  it('prices OpenAI input net of its cached tokens', async () => {
    // gpt-6.1-sol at $2 in, $10 out, $2 cached per 1M. 300,000 in, 100,000 of
    // them cached: 200,000 × $2 = $0.40; 50,000 × $10 = $0.50; 100,000 × $2 = $0.20.
    await assessments()
    await record([
      wire({
        billed_service: 'openai',
        model: 'gpt-6.1-sol',
        input_tokens: 300_000,
        output_tokens: 50_000,
        cache_read_tokens: 100_000,
      }),
    ])

    const [row] = await rowsOf()

    expect(row.cells).toEqual({
      input: tokens(200_000, 2, 0.4),
      output: tokens(50_000, 10, 0.5),
      'cached input': tokens(100_000, 2, 0.2),
    })
    expect(row.costUsd).toBe(1.1)
  })

  it('gives Whisper audio minutes, Cohere searches, and a trial key its reason', async () => {
    // 600 seconds = 10 minutes × $0.006 = $0.06. Cohere is free on the trial key.
    await assessments()
    const none = { input_tokens: null, output_tokens: null, cache_read_tokens: null }
    await record([
      wire({
        ...none,
        feature: 'transcribe',
        billed_service: 'openai-whisper',
        model: 'whisper-1',
        audio_seconds: 600,
      }),
      wire({
        ...none,
        feature: 'retrieval',
        billed_service: 'cohere-rerank',
        model: 'rerank-v3.5',
        search_units: 140,
      }),
    ])

    const rows = await rowsOf()
    const cellsOf = (service: string) =>
      rows.find((r: { service: string }) => r.service === service).cells

    expect(cellsOf('openai-whisper')).toEqual({
      audio: { quantity: 10, unit: 'minutes', usdPer: 0.006, per: 1, costUsd: 0.06, note: null },
    })
    expect(cellsOf('cohere-rerank')).toEqual({
      searches: {
        quantity: 140,
        unit: 'searches',
        usdPer: 0,
        per: 1000,
        costUsd: 0,
        note: 'Trial key: free',
      },
    })
  })

  it('starts a new row when the rate changed, older rate first', async () => {
    // gemini-3.8-flash input: $0.75 per 1M until 2026-12-31, $1.50 from 2027-01-01.
    await assessments()
    const gemini = wire({
      feature: 'interpret-photo',
      billed_service: 'gemini-vision',
      model: 'gemini-3.8-flash',
      input_tokens: 1_000_000,
      output_tokens: 0,
      cache_read_tokens: null,
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-01-02T00:00:00Z'))
    await record([gemini])
    vi.setSystemTime(new Date('2026-12-31T00:00:00Z'))
    await record([gemini, gemini])
    vi.useRealTimers()

    const rows = await rowsOf()

    expect(
      rows.map((r: { calls: number; cells: { input: { usdPer: number } }; costUsd: number }) => [
        r.calls,
        r.cells.input.usdPer,
        r.costUsd,
      ]),
    ).toEqual([
      [2, 0.75, 1.5],
      [1, 1.5, 1.5],
    ])
  })

  it('shows a call with no price, and one saved before rates were kept, without rates', async () => {
    await assessments()
    await record([wire({ model: 'claude-unknown-9', input_tokens: 10_000, output_tokens: 2_000 })])
    // No costParts: saved before EV-04 kept rates, and not matched by the backfill.
    await seed([
      call({
        model: 'claude-sonnet-5-5',
        inputTokens: 1_000_000,
        outputTokens: 0,
        estimatedCostUsd: 3,
      }),
    ])

    const rows = await rowsOf()
    const unrated = (input: number) => ({
      quantity: input,
      unit: 'tokens',
      usdPer: null,
      per: 1e6,
      costUsd: null,
      note: null,
    })

    expect(rows).toEqual([
      expect.objectContaining({
        model: 'claude-sonnet-5-5',
        rates: 'not recorded',
        note: 'Saved before rates were recorded',
        cells: { input: unrated(1_000_000) },
        costUsd: 3,
      }),
      expect.objectContaining({
        model: 'claude-unknown-9',
        rates: 'not priced',
        note: 'no price for model',
        cells: { input: unrated(10_000), output: unrated(2_000) },
        costUsd: null,
      }),
    ])
  })

  it('keeps the overview and ingestion lists to their totals: rates are on the detail pages', async () => {
    await assessments()
    await record([wire()])
    await record([wire({ feature: 'ocr', document_id: String(new Types.ObjectId()) })], {})

    const overview = await asSana.get(
      '/api/usage/overview?groupBy=assessment&split=service&range=all',
    )
    const ingestion = await asSana.get('/api/usage/ingestion?split=service&range=all')

    for (const row of [overview.body.groups[0], ingestion.body.documents[0]]) {
      expect(row).not.toHaveProperty('totalTokens')
      expect(row).not.toHaveProperty('costLines')
    }
  })

  it('has no rate rows without a chosen assessment', async () => {
    await assessments()
    await record([wire()])

    expect((await asSana.get('/api/usage/summary')).body.rateRows).toEqual([])
  })

  it("exports an assessment's usage and rates, one line per billed part, adding up to its total", async () => {
    // Sonnet at $2 / $10 / $0.1 per 1M: $2.00 + $1.00 + $0.05. Whisper: 10 min × $0.006 = $0.06.
    // An Opus call saved before rates were kept, at its stored $0.50. In all, $3.61.
    await assessments()
    await record([
      wire({
        model: 'claude-sonnet-5-5',
        input_tokens: 1_000_000,
        output_tokens: 100_000,
        cache_read_tokens: 500_000,
      }),
      wire({
        feature: 'transcribe',
        billed_service: 'openai-whisper',
        model: 'whisper-1',
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        audio_seconds: 600,
      }),
      wire({ model: 'claude-unknown-9', input_tokens: 10_000, output_tokens: 2_000 }),
    ])
    await seed([call()]) // no costParts

    const res = await asSana.get('/api/usage/export.csv?groupBy=rates&reportId=RPT-A')

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toBe('attachment; filename="usage-rates-RPT-A.csv"')
    const lines = res.text.trim().split('\n')
    const old = 'Saved before rates were recorded'
    expect(lines).toEqual([
      'feature,service,model,rates,part,quantity,unit,usd_per,per,cost_usd,calls,avg_ms_per_call,note',
      `draft-section,anthropic,claude-opus-5-5,not recorded,input,1000,tokens,,1000000,,1,100,${old}`,
      `draft-section,anthropic,claude-opus-5-5,not recorded,output,500,tokens,,1000000,,1,100,${old}`,
      `draft-section,anthropic,claude-opus-5-5,not recorded,stored cost,,,,,0.5,1,100,${old}`,
      'draft-section,anthropic,claude-sonnet-5-5,charged,input,1000000,tokens,2,1000000,2,1,100,',
      'draft-section,anthropic,claude-sonnet-5-5,charged,output,100000,tokens,10,1000000,1,1,100,',
      'draft-section,anthropic,claude-sonnet-5-5,charged,cached input,500000,tokens,0.1,1000000,0.05,1,100,',
      'draft-section,anthropic,claude-unknown-9,not priced,input,10000,tokens,,1000000,,1,100,no price for model',
      'draft-section,anthropic,claude-unknown-9,not priced,output,2000,tokens,,1000000,,1,100,no price for model',
      'transcribe,openai-whisper,whisper-1,charged,audio,10,minutes,0.006,1,0.06,1,100,',
    ])
    const costs = lines.slice(1).map((l) => Number(l.split(',')[9] || 0))
    expect(costs.reduce((t, c) => t + c, 0)).toBeCloseTo(3.61, 6)
  })

  it('exports rates only for a chosen assessment', async () => {
    expect((await asSana.get('/api/usage/export.csv?groupBy=rates')).status).toBe(400)
  })
})

describe('GET /api/usage/ingestion/:key, one document (EV-04)', () => {
  const nfpa = new Types.ObjectId()
  const document = () =>
    KnowledgeDocumentModel.collection.insertOne({
      _id: nfpa,
      title: 'NFPA 13',
      fileName: 'nfpa13.pdf',
      status: 'complete',
      createdAt: new Date('2026-10-01T00:00:00Z'),
    })
  // Labelling with gpt-6-luna at $0.10 in, $0.50 out per 1M, as the ingestion
  // service priced it: 1,000,000 in = $0.10; 200,000 out = $0.10.
  const labelling = () =>
    labelUsageToWire([
      {
        model: 'gpt-6-luna',
        input_tokens: 1_000_000,
        output_tokens: 200_000,
        cost_usd: 0.2,
        seconds: 2,
        input_usd_per_1m: 0.1,
        output_usd_per_1m: 0.5,
      },
    ])
  // Four OCR calls summed into one row by the worker, 4 seconds in all.
  // Gemini 3.8 Flash at $0.75 in, $3.75 out per 1M: 400,000 in = $0.30; 40,000 out = $0.15.
  const ocr = (documentId: string): WireUsage => ({
    feature: 'ocr',
    billed_service: 'gemini-ocr',
    model: 'gemini-3.8-flash',
    duration_ms: 4000,
    input_tokens: 400_000,
    output_tokens: 40_000,
    cache_read_tokens: null,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
    call_count: 4,
    document_id: documentId,
  })
  const open = (key: string, as = asSana) => as.get(`/api/usage/ingestion/${key}`)

  it('gives a document its details, cost per stage, and usage at the rates charged', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-02T00:00:00Z'))
    await document()
    await IngestionJobModel.collection.insertOne({ documentId: nfpa, pageTotal: 40 })
    await recordAiCalls(labelling(), { documentId: String(nfpa) })
    await recordAiCalls([ocr(String(nfpa))])
    vi.useRealTimers()

    const res = await open(String(nfpa))

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      key: String(nfpa),
      title: 'NFPA 13',
      fileName: 'nfpa13.pdf',
      status: 'complete',
      saved: true,
      uploadedAt: '2026-10-01T00:00:00.000Z',
      pages: 40,
      totals: { calls: 5, estimatedCostUsd: 0.65, callsWithoutCost: 0 },
    })
    expect(res.body.byFeatureService.map((f: { feature: string }) => f.feature)).toEqual([
      'ocr',
      'label-document',
    ])
    const per1M = (quantity: number, usdPer: number, costUsd: number) => ({
      quantity,
      unit: 'tokens',
      usdPer,
      per: 1e6,
      costUsd,
      note: null,
    })
    expect(res.body.rateRows).toEqual([
      expect.objectContaining({
        feature: 'ocr',
        model: 'gemini-3.8-flash',
        calls: 4,
        cells: { input: per1M(400_000, 0.75, 0.3), output: per1M(40_000, 3.75, 0.15) },
        costUsd: 0.45,
        avgMsPerCall: 1000,
      }),
      expect.objectContaining({
        feature: 'label-document',
        model: 'gpt-6-luna',
        calls: 1,
        cells: { input: per1M(1_000_000, 0.1, 0.1), output: per1M(200_000, 0.5, 0.1) },
        costUsd: 0.2,
        avgMsPerCall: 2000,
      }),
    ])
  })

  it('opens labelling from before calls named their document, and an upload never saved', async () => {
    await recordAiCalls(labelling())
    const refused = new Types.ObjectId()
    await recordAiCalls(labelling(), { documentId: String(refused) })

    const unlinked = await open('unlinked')
    const unsaved = await open(String(refused))

    expect(unlinked.body).toMatchObject({ title: 'Not linked to a document', saved: false })
    expect(unlinked.body.totals.calls).toBe(1)
    expect(unsaved.body).toMatchObject({ title: 'Upload not saved', saved: false, pages: null })
  })

  it('has nothing for a document with no calls, or a key that is not one', async () => {
    await document()

    expect((await open(String(nfpa))).status).toBe(404)
    expect((await open('not-an-id')).status).toBe(404)
  })

  it('is for knowledge admins only', async () => {
    await recordAiCalls(labelling(), { documentId: String(nfpa) })

    expect((await open(String(nfpa), asAlex)).status).toBe(403)
  })

  it("exports a document's usage and rates as CSV, named after it", async () => {
    await document()
    await recordAiCalls(labelling(), { documentId: String(nfpa) })
    await recordAiCalls([ocr(String(nfpa))])

    const res = await asSana.get(`/api/usage/ingestion/${nfpa}/export.csv`)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="usage-document-NFPA_13.csv"',
    )
    expect(res.text.trim().split('\n')).toEqual([
      'feature,service,model,rates,part,quantity,unit,usd_per,per,cost_usd,calls,avg_ms_per_call,note',
      'ocr,gemini-ocr,gemini-3.8-flash,charged,input,400000,tokens,0.75,1000000,0.3,4,1000,',
      'ocr,gemini-ocr,gemini-3.8-flash,charged,output,40000,tokens,3.75,1000000,0.15,4,1000,',
      'label-document,openai-label,gpt-6-luna,charged,input,1000000,tokens,0.1,1000000,0.1,1,2000,',
      'label-document,openai-label,gpt-6-luna,charged,output,200000,tokens,0.5,1000000,0.1,1,2000,',
    ])
  })

  it('exports nothing for a document with no calls, and only for knowledge admins', async () => {
    await recordAiCalls(labelling(), { documentId: String(nfpa) })

    expect(
      (await asSana.get(`/api/usage/ingestion/${new Types.ObjectId()}/export.csv`)).status,
    ).toBe(404)
    expect((await asAlex.get(`/api/usage/ingestion/${nfpa}/export.csv`)).status).toBe(403)
  })
})

describe('GET /api/usage/chat, the chatbot (EV-04, CB-01)', () => {
  afterEach(() => vi.useRealTimers())

  // One chat answer from gpt-6.1-sol at $2 in, $10 out per 1M:
  // 1,000 in = $0.002; 500 out = $0.005. $0.007 each.
  const answer: WireUsage = {
    feature: 'chat',
    billed_service: 'openai',
    model: 'gpt-6.1-sol',
    duration_ms: 100,
    input_tokens: 1000,
    output_tokens: 500,
    cache_read_tokens: 0,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
  }
  const askedAt = async (iso: string, who: { _id: Types.ObjectId }) => {
    vi.setSystemTime(new Date(iso))
    await recordAiCalls([answer], { userId: String(who._id) })
  }
  // Now is 13 Oct 2026, 18:00 in Singapore. Alex asked on 20 Sep, 11 Oct and
  // (04:00 Singapore time) 13 Oct; Jide at 01:00 on 1 Oct, Singapore time,
  // which is still 30 Sep in UTC.
  async function chats() {
    await UserModel.collection.insertMany([alex, jide, sana])
    vi.useFakeTimers({ toFake: ['Date'] })
    await askedAt('2026-09-20T02:00:00Z', alex)
    await askedAt('2026-09-30T17:00:00Z', jide)
    await askedAt('2026-10-11T02:00:00Z', alex)
    await askedAt('2026-10-12T20:00:00Z', alex)
    vi.setSystemTime(new Date('2026-10-13T10:00:00Z'))
  }
  const chat = (query: string, as = asSana) => as.get(`/api/usage/chat?${query}`)
  type Bucket = { key: string; calls: number; estimatedCostUsd: number }

  it('gives a month a bar per Singapore day, up to today, and the month before to compare', async () => {
    await chats()

    const { status, body } = await chat('period=month&at=2026-10')

    expect(status).toBe(200)
    expect(body.scope).toMatchObject({ period: 'month', at: '2026-10', complete: false })
    expect(body.totals).toMatchObject({ calls: 3, estimatedCostUsd: 0.021, callsWithoutCost: 0 })
    expect(body.splitKeys).toEqual(['openai'])
    expect(body.buckets.map((b: Bucket) => b.key)).toEqual(
      Array.from({ length: 13 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`),
    )
    const day = (key: string) => body.buckets.find((b: Bucket) => b.key === key)
    expect(day('2026-10-01')).toMatchObject({
      calls: 1,
      estimatedCostUsd: 0.007,
      segments: { openai: 0.007 },
    })
    expect(day('2026-10-12')).toMatchObject({ calls: 0, estimatedCostUsd: 0, segments: {} })
    expect(day('2026-10-13')).toMatchObject({ calls: 1, estimatedCostUsd: 0.007 })
    expect(body.previous).toEqual({ at: '2026-09', calls: 1, estimatedCostUsd: 0.007 })
  })

  it('gives a finished month every day, marked complete', async () => {
    await chats()

    const { body } = await chat('period=month&at=2026-09')

    expect(body.scope.complete).toBe(true)
    expect(body.buckets).toHaveLength(30)
    expect(body.totals.calls).toBe(1)
    expect(body.previous).toEqual({ at: '2026-08', calls: 0, estimatedCostUsd: 0 })
  })

  it('gives a year a bar per month, up to this month, and the year before to compare', async () => {
    await chats()

    const { body } = await chat('period=year&at=2026')

    expect(body.scope).toMatchObject({ period: 'year', at: '2026', complete: false })
    expect(body.buckets.map((b: Bucket) => [b.key, b.calls])).toEqual([
      ['2026-01', 0],
      ['2026-02', 0],
      ['2026-03', 0],
      ['2026-04', 0],
      ['2026-05', 0],
      ['2026-06', 0],
      ['2026-07', 0],
      ['2026-08', 0],
      ['2026-09', 1],
      ['2026-10', 3],
    ])
    expect(body.previous).toEqual({ at: '2025', calls: 0, estimatedCostUsd: 0 })
  })

  it('gives each person who asked their cost, costliest first, and the usage at the rates charged', async () => {
    await chats()

    const { body } = await chat('period=month&at=2026-10')

    expect(body.byUser).toEqual([
      expect.objectContaining({
        key: String(alex._id),
        name: 'alex',
        calls: 2,
        estimatedCostUsd: 0.014,
      }),
      expect.objectContaining({
        key: String(jide._id),
        name: 'jide',
        calls: 1,
        estimatedCostUsd: 0.007,
      }),
    ])
    expect(body.rateRows).toEqual([
      expect.objectContaining({
        feature: 'chat',
        service: 'openai',
        model: 'gpt-6.1-sol',
        calls: 3,
        costUsd: 0.021,
      }),
    ])
  })

  it('shows a risk engineer only their own chat', async () => {
    await chats()

    const { body } = await chat('period=month&at=2026-10', asAlex)

    expect(body.totals.calls).toBe(2)
    expect(body.byUser.map((u: { name: string }) => u.name)).toEqual(['alex'])
    expect(body.previous.calls).toBe(1)
  })

  it('rejects a period it does not know', async () => {
    for (const query of [
      'period=week&at=2026-10',
      'period=month&at=2026-13',
      'period=month',
      'period=year&at=2026-10',
    ])
      expect((await chat(query)).status).toBe(400)
  })

  it("exports the chat's usage and rates for the period", async () => {
    await chats()

    const res = await asSana.get('/api/usage/chat/export.csv?period=month&at=2026-10')

    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="usage-chat-rates-2026-10.csv"',
    )
    expect(res.text.trim().split('\n').slice(1)).toEqual([
      'chat,openai,gpt-6.1-sol,charged,input,3000,tokens,2,1000000,0.006,3,100,',
      'chat,openai,gpt-6.1-sol,charged,output,1500,tokens,10,1000000,0.015,3,100,',
    ])
  })
})

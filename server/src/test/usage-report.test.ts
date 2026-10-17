// EV-04: the usage and cost report built from ai_calls (EV-03). No paid calls.
import { Types } from 'mongoose'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
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
      'group,reference,client,site,engineer,last_activity,calls,calls_without_cost,total_tokens,estimated_cost_usd,anthropic,cohere-embed',
    )
    // Each call used 1,000 input + 500 output tokens.
    expect(lines[1]).toMatch(/^RPT-B,RPT-B,C,Site,jide,[^,]+,1,0,1500,2,2,0$/)
    expect(lines[2]).toMatch(/^RPT-A,RPT-A,C,Site,alex,[^,]+,2,0,3000,0\.6,0\.5,0\.1$/)
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
      'title,file_name,status,uploaded_at,pages,calls,calls_without_cost,total_tokens,estimated_cost_usd,usd_per_page,gemini-ocr,anthropic',
    )
    // Two calls of 1,000 input + 500 output tokens each.
    expect(row).toBe(
      'NFPA 13,nfpa13.pdf,complete,2026-10-01T00:00:00.000Z,40,2,0,3000,0.8,0.02,0.6,0.2',
    )
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

describe('per-row tokens and cost calculation (EV-04)', () => {
  // Hand-worked: Sonnet 5.5 at $2 in, $10 out, $0.1 cache-read per 1M tokens.
  // 1,000,000 in = $2.00; 100,000 out = $1.00; 500,000 cached = $0.05. $3.05 in all.
  const sonnet = () =>
    call({
      model: 'claude-sonnet-5-5',
      inputTokens: 1_000_000,
      outputTokens: 100_000,
      cacheReadTokens: 500_000,
      estimatedCostUsd: 3.05,
    })
  const firstGroup = async () => {
    const res = await asSana.get('/api/usage/overview?groupBy=assessment&split=service&range=all')
    return res.body.groups[0]
  }

  it('gives each assessment its total tokens: input, output and cached', async () => {
    await assessments()
    await seed([sonnet()])

    expect((await firstGroup()).totalTokens).toBe(1_600_000)
  })

  it('counts OpenAI cached tokens once: its input already includes them', async () => {
    // 300,000 in (100,000 of them cached) + 50,000 out = 350,000 tokens.
    await seed([
      call({
        feature: 'chat',
        billedService: 'openai',
        model: 'gpt-6.1-sol',
        reportId: undefined,
        userId: sana._id,
        inputTokens: 300_000,
        outputTokens: 50_000,
        cacheReadTokens: 100_000,
        estimatedCostUsd: 1.1,
      }),
    ])

    expect((await firstGroup()).totalTokens).toBe(350_000)
  })

  it('breaks a Claude assessment into input, output and cached lines that add up to its cost', async () => {
    await assessments()
    await seed([sonnet()])

    const g = await firstGroup()

    const line = {
      service: 'anthropic',
      model: 'claude-sonnet-5-5',
      unit: 'tokens',
      per: 1_000_000,
    }
    expect(g.costLines).toEqual([
      { ...line, part: 'input', quantity: 1_000_000, usdPer: 2, costUsd: 2, note: null },
      { ...line, part: 'output', quantity: 100_000, usdPer: 10, costUsd: 1, note: null },
      { ...line, part: 'cached input', quantity: 500_000, usdPer: 0.1, costUsd: 0.05, note: null },
    ])
    expect(g.reconciliation).toEqual({ calculatedUsd: 3.05, recordedUsd: 3.05, differenceUsd: 0 })
  })

  it('prices OpenAI input net of its cached tokens', async () => {
    // gpt-6.1-sol at $2 in, $10 out, $2 cached per 1M. 300,000 in, 100,000 of
    // them cached: 200,000 × $2 = $0.40; 50,000 × $10 = $0.50; 100,000 × $2 = $0.20.
    await seed([
      call({
        feature: 'chat',
        billedService: 'openai',
        model: 'gpt-6.1-sol',
        reportId: undefined,
        userId: sana._id,
        inputTokens: 300_000,
        outputTokens: 50_000,
        cacheReadTokens: 100_000,
        estimatedCostUsd: 1.1,
      }),
    ])

    const g = await firstGroup()

    expect(
      g.costLines.map((l: { part: string; quantity: number; costUsd: number }) => [
        l.part,
        l.quantity,
        l.costUsd,
      ]),
    ).toEqual([
      ['input', 200_000, 0.4],
      ['output', 50_000, 0.5],
      ['cached input', 100_000, 0.2],
    ])
    expect(g.reconciliation).toEqual({ calculatedUsd: 1.1, recordedUsd: 1.1, differenceUsd: 0 })
  })

  it('shows Whisper in minutes, outside the token count', async () => {
    // 600 seconds = 10 minutes × $0.006 = $0.06.
    await assessments()
    await seed([
      call({
        feature: 'transcribe',
        billedService: 'openai-whisper',
        model: 'whisper-1',
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        audioSeconds: 600,
        estimatedCostUsd: 0.06,
      }),
    ])

    const g = await firstGroup()

    expect(g.totalTokens).toBe(0)
    expect(g.costLines).toEqual([
      {
        service: 'openai-whisper',
        model: 'whisper-1',
        part: 'audio',
        unit: 'minutes',
        quantity: 10,
        usdPer: 0.006,
        per: 1,
        costUsd: 0.06,
        note: null,
      },
    ])
  })

  it('shows trial-key Cohere at $0 with its reason, rerank in searches', async () => {
    await assessments()
    const cohere = {
      feature: 'retrieval',
      model: 'embed-v4.0',
      outputTokens: null,
      cacheReadTokens: null,
    }
    await seed([
      call({ ...cohere, billedService: 'cohere-embed', inputTokens: 90_000, estimatedCostUsd: 0 }),
      call({
        ...cohere,
        billedService: 'cohere-rerank',
        model: 'rerank-v3.5',
        inputTokens: null,
        searchUnits: 140,
        estimatedCostUsd: 0,
      }),
    ])

    const g = await firstGroup()

    expect(g.totalTokens).toBe(90_000)
    expect(g.costLines).toEqual([
      expect.objectContaining({
        part: 'input',
        unit: 'tokens',
        quantity: 90_000,
        usdPer: 0,
        costUsd: 0,
        note: 'Trial key: free',
      }),
      expect.objectContaining({
        part: 'searches',
        unit: 'searches',
        quantity: 140,
        usdPer: 0,
        costUsd: 0,
        note: 'Trial key: free',
      }),
    ])
  })

  it('splits Gemini lines at the 2027 price change', async () => {
    // gemini-3.8-flash input: $0.75 per 1M until 2026-12-31, $1.50 from 2027-01-01.
    await assessments()
    const gemini = (iso: string, cost: number) => ({
      ...call({
        feature: 'interpret-photo',
        billedService: 'gemini-vision',
        model: 'gemini-3.8-flash',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: null,
        estimatedCostUsd: cost,
      }),
      callCount: 1,
      createdAt: new Date(iso),
    })
    // Saved straight to the collection so each keeps the time it was made.
    await AiCallModel.collection.insertMany([
      gemini('2026-12-31T00:00:00Z', 0.75),
      gemini('2027-01-02T00:00:00Z', 1.5),
    ])

    const g = await firstGroup()
    const inputs = g.costLines.filter((l: { part: string }) => l.part === 'input')

    expect(
      inputs.map((l: { quantity: number; usdPer: number; costUsd: number }) => [
        l.quantity,
        l.usdPer,
        l.costUsd,
      ]),
    ).toEqual([
      [1_000_000, 0.75, 0.75],
      [1_000_000, 1.5, 1.5],
    ])
    expect(g.reconciliation.differenceUsd).toBe(0)
  })

  it('lists calls without a cost as a not-priced line, outside the calculated total', async () => {
    await assessments()
    await seed([
      sonnet(),
      call({
        model: 'claude-unknown-9',
        inputTokens: 10_000,
        outputTokens: 2_000,
        cacheReadTokens: 0,
        estimatedCostUsd: null,
        pricingBasis: 'no price for model',
      }),
    ])

    const g = await firstGroup()

    expect(g.costLines).toContainEqual({
      service: 'anthropic',
      model: 'claude-unknown-9',
      part: 'not priced',
      unit: 'tokens',
      quantity: 12_000,
      usdPer: 0,
      per: 1_000_000,
      costUsd: 0,
      note: 'no price for model',
    })
    expect(g.reconciliation).toEqual({ calculatedUsd: 3.05, recordedUsd: 3.05, differenceUsd: 0 })
  })

  it("shows the difference when a stored cost no longer matches today's rate", async () => {
    // Recorded at an older price: $3.00 then, $3.05 at today's rates.
    await assessments()
    await seed([{ ...sonnet(), estimatedCostUsd: 3 }])

    expect((await firstGroup()).reconciliation).toEqual({
      calculatedUsd: 3.05,
      recordedUsd: 3,
      differenceUsd: 0.05,
    })
  })

  it("gives each ingested document its tokens and cost lines, labelling at the ingestion service's price", async () => {
    // Labelling with gpt-6-luna at $0.10 in, $0.50 out per 1M (ingestion PRICES):
    // 1,000,000 in = $0.10; 200,000 out = $0.10.
    const documentId = new Types.ObjectId()
    await seed([
      call({
        feature: 'label-document',
        billedService: 'openai-label',
        model: 'gpt-6-luna',
        reportId: undefined,
        documentId,
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheReadTokens: null,
        estimatedCostUsd: 0.2,
        pricingBasis: 'ingestion-service PRICES table',
      }),
    ])

    const res = await asSana.get('/api/usage/ingestion?split=service&range=all')
    const doc = res.body.documents[0]

    expect(doc.totalTokens).toBe(1_200_000)
    expect(
      doc.costLines.map((l: { part: string; usdPer: number; costUsd: number }) => [
        l.part,
        l.usdPer,
        l.costUsd,
      ]),
    ).toEqual([
      ['input', 0.1, 0.1],
      ['output', 0.5, 0.1],
    ])
    expect(doc.reconciliation.differenceUsd).toBe(0)
  })

  it('shows self-hosted OCR tokens at $0, and why', async () => {
    await seed([
      call({
        feature: 'ocr',
        billedService: 'self-hosted-ocr',
        model: 'docling-ocr',
        reportId: undefined,
        documentId: new Types.ObjectId(),
        inputTokens: 4_000,
        outputTokens: 1_000,
        cacheReadTokens: null,
        estimatedCostUsd: 0,
      }),
    ])

    const res = await asSana.get('/api/usage/ingestion?split=service&range=all')
    const doc = res.body.documents[0]

    expect(doc.totalTokens).toBe(5_000)
    expect(
      doc.costLines.map((l: { part: string; quantity: number; costUsd: number; note: string }) => [
        l.part,
        l.quantity,
        l.costUsd,
        l.note,
      ]),
    ).toEqual([
      ['input', 4_000, 0, 'Self-hosted'],
      ['output', 1_000, 0, 'Self-hosted'],
    ])
  })

  it('leaves out parts a call did not use', async () => {
    await assessments()
    await seed([call()]) // Opus, no cache reads

    const parts = (await firstGroup()).costLines.map((l: { part: string }) => l.part)

    expect(parts).toEqual(['input', 'output'])
  })
})

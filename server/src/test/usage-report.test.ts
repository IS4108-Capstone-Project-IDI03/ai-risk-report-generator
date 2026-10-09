// EV-04: the usage and cost report built from ai_calls (EV-03). No paid calls.
import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
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
  it('totals cost per feature, always listing all four features (AC1)', async () => {
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
    expect(lines).toHaveLength(5)
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

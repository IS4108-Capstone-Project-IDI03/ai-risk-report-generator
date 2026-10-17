// EV-03: AI-call usage records. Pure pricing tests, the recorder, and the three
// callers (speech, labelling, drafting) with their downstream services stubbed.
// No test here reaches a paid API.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config'
import { AiCallModel } from '../models/ai-call.model'
import { estimateCost } from '../services/ai-pricing.service'
import { backfillCostParts } from '../scripts/backfill-cost-parts'
import { repriceAiCalls } from '../scripts/reprice-ai-calls'
import { labelUsageToWire, recordAiCalls, type WireUsage } from '../services/ai-usage.service'
import { labelDocument } from '../services/ingestion.service'
import { transcribe } from '../services/speech.service'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// A wire item as the Python services send it (microservices/*, EV-03 spec).
const item = (over: Partial<WireUsage> = {}): WireUsage => ({
  feature: 'draft-section',
  billed_service: 'anthropic',
  model: 'claude-opus-5-5',
  duration_ms: 4200,
  input_tokens: 1000,
  output_tokens: 500,
  cache_read_tokens: 2000,
  search_units: null,
  audio_seconds: null,
  usage_status: 'recorded',
  ...over,
})

describe('estimateCost (AC3)', () => {
  it('prices Claude tokens, cache reads included, and names its source', () => {
    const { estimatedCostUsd, pricingBasis } = estimateCost(item())
    expect(estimatedCostUsd).toBeCloseTo((1000 * 4 + 500 * 20 + 2000 * 0.2) / 1e6, 8)
    expect(pricingBasis).toContain('platform.claude.com')
  })

  it('returns the parts the cost is made of: quantity, rate and cost each', () => {
    // Opus at $4 in, $20 out, $0.2 cached per 1M tokens.
    const { costParts } = estimateCost(item())
    const tokens = { unit: 'tokens', per: 1e6, note: null }
    expect(costParts).toEqual([
      { ...tokens, part: 'input', quantity: 1000, usdPer: 4, costUsd: expect.closeTo(0.004, 10) },
      { ...tokens, part: 'output', quantity: 500, usdPer: 20, costUsd: expect.closeTo(0.01, 10) },
      {
        ...tokens,
        part: 'cached input',
        quantity: 2000,
        usdPer: 0.2,
        costUsd: expect.closeTo(0.0004, 10),
      },
    ])
  })

  it('has no parts when there is no price', () => {
    expect(estimateCost(item({ model: 'claude-future-9' })).costParts).toBeNull()
  })

  it('matches a dated model id to its price', () => {
    const cost = estimateCost(item({ model: 'claude-haiku-4-5-20251001' }))
    expect(cost.estimatedCostUsd).toBeCloseTo((1000 * 1 + 500 * 5 + 2000 * 0.1) / 1e6, 8)
  })

  it('prices Sonnet 5.5, the drafting model', () => {
    const cost = estimateCost(item({ model: 'claude-sonnet-5-5' }))
    expect(cost.estimatedCostUsd).toBeCloseTo((1000 * 2 + 500 * 10 + 2000 * 0.1) / 1e6, 8)
  })

  it('counts OpenAI cached tokens once, as part of the input (CB-01 chat)', () => {
    // OpenAI's input_tokens already includes the cached ones; Anthropic's does not.
    const sol = item({
      billed_service: 'openai',
      model: 'gpt-6.1-sol',
      input_tokens: 6000,
      cache_read_tokens: 2000,
    })
    const cost = estimateCost(sol)
    expect(cost.estimatedCostUsd).toBeCloseTo((4000 * 2 + 500 * 10 + 2000 * 2) / 1e6, 8)
    expect(cost.pricingBasis).toContain('developers.openai.com')
  })

  it('has no cost for a model it has no price for', () => {
    const cost = estimateCost(item({ model: 'claude-future-9' }))
    expect(cost).toEqual({
      estimatedCostUsd: null,
      pricingBasis: 'no price for model',
      costParts: null,
    })
  })

  it('prices Whisper by the minute of audio', () => {
    const whisper = estimateCost(
      item({
        billed_service: 'openai-whisper',
        model: 'whisper-1',
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        audio_seconds: 120,
      }),
    )
    expect(whisper.estimatedCostUsd).toBeCloseTo(0.012, 8)
  })

  it('does not price a call whose usage is incomplete (no zero costs)', () => {
    const noOutput = estimateCost(item({ output_tokens: null }))
    expect(noOutput.estimatedCostUsd).toBeNull()
    const noTokens = estimateCost(
      item({ input_tokens: null, output_tokens: null, cache_read_tokens: null }),
    )
    expect(noTokens.estimatedCostUsd).toBeNull()
  })

  // Google list price for gemini-3.8-flash, ai.google.dev/gemini-api/docs/pricing,
  // read 2026-10-13: $0.75 in / $3.75 out per 1M until 2026-12-31, then $1.50 / $7.50.
  const gemini = (over: Partial<WireUsage> = {}) =>
    item({
      feature: 'interpret-photo',
      billed_service: 'gemini-vision',
      model: 'gemini-3.8-flash',
      input_tokens: 10_000,
      output_tokens: 2_000,
      cache_read_tokens: null,
      ...over,
    })

  it('prices Gemini photo and OCR calls at the price in force on the call date', () => {
    const before = estimateCost(gemini(), new Date('2026-12-31T23:00:00Z'))
    expect(before.estimatedCostUsd).toBeCloseTo(0.015, 8)
    expect(before.pricingBasis).toContain('ai.google.dev')
    const after = estimateCost(gemini(), new Date('2027-01-01T00:00:00Z'))
    expect(after.estimatedCostUsd).toBeCloseTo(0.03, 8)
    const ocr = estimateCost(
      gemini({ feature: 'ocr', billed_service: 'gemini-ocr' }),
      new Date('2026-10-13'),
    )
    expect(ocr.estimatedCostUsd).toBeCloseTo(0.015, 8)
  })

  it('has no cost for a Gemini model it has no price for', () => {
    expect(estimateCost(gemini({ model: 'gemini-9-ultra' }))).toEqual({
      estimatedCostUsd: null,
      pricingBasis: 'no price for model',
      costParts: null,
    })
  })

  it('prices self-hosted OCR at zero and says why', () => {
    const cost = estimateCost(
      item({ feature: 'ocr', billed_service: 'self-hosted-ocr', model: 'local-ocr' }),
    )
    expect(cost.estimatedCostUsd).toBe(0)
    expect(cost.pricingBasis).toContain('self-hosted')
  })

  it('leaves the cost empty when the provider gave no usage', () => {
    const cost = estimateCost(
      item({
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        usage_status: 'unavailable',
      }),
    )
    expect(cost.estimatedCostUsd).toBeNull()
  })
})

describe('recordAiCalls (AC1-AC7)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('stores duration, tokens, cost, feature, report and billed service', async () => {
    await recordAiCalls([item()], { reportId: 'RPT-2026-0901' })
    const row = await AiCallModel.findOne().lean()
    expect(row).toMatchObject({
      feature: 'draft-section',
      billedService: 'anthropic',
      model: 'claude-opus-5-5',
      reportId: 'RPT-2026-0901',
      durationMs: 4200,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      usageStatus: 'recorded',
    })
    expect(row?.estimatedCostUsd).toBeGreaterThan(0)
    expect(row?.pricingBasis).toBeTruthy()
  })

  it('stores the rates each call was priced at, so its cost can be explained later', async () => {
    await recordAiCalls([item({ cache_read_tokens: 0 })])
    const row = await AiCallModel.findOne().lean()
    // Opus: 1,000 in × $4/1M = $0.004; 500 out × $20/1M = $0.01.
    expect(row?.costParts).toEqual([
      expect.objectContaining({ part: 'input', quantity: 1000, usdPer: 4, per: 1e6 }),
      expect.objectContaining({ part: 'output', quantity: 500, usdPer: 20, per: 1e6 }),
      expect.objectContaining({ part: 'cached input', quantity: 0, usdPer: 0.2, per: 1e6 }),
    ])
  })

  it('stores no rates for a call with no price, unlike a row saved before rates were kept', async () => {
    await recordAiCalls([item({ model: 'claude-future-9' })])
    const row = await AiCallModel.findOne().lean()
    expect(row).toHaveProperty('costParts', null)
  })

  it('marks missing usage as unavailable, never zero', async () => {
    await recordAiCalls(
      [
        item({
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          usage_status: 'unavailable',
        }),
      ],
      {},
    )
    const row = await AiCallModel.findOne().lean()
    expect(row).toMatchObject({
      usageStatus: 'unavailable',
      inputTokens: null,
      estimatedCostUsd: null,
    })
    expect(row?.reportId).toBeUndefined()
  })

  it('marks a call unavailable when every amount is empty, whatever its status says', async () => {
    await recordAiCalls(
      [
        item({
          input_tokens: null,
          output_tokens: null,
          cache_read_tokens: null,
          usage_status: 'recorded',
        }),
      ],
      {},
    )
    expect(await AiCallModel.findOne().lean()).toMatchObject({
      usageStatus: 'unavailable',
      estimatedCostUsd: null,
    })
  })

  it('stores the chat user, document and report section it is given', async () => {
    const userId = new Types.ObjectId().toString()
    const documentId = new Types.ObjectId().toString()
    await recordAiCalls([item()], { reportId: 'RPT-2026-0901', section: '2.1', userId, documentId })
    const row = await AiCallModel.findOne().lean()
    expect(row?.section).toBe('2.1')
    expect(String(row?.userId)).toBe(userId)
    expect(String(row?.documentId)).toBe(documentId)
    expect(row?.callCount).toBe(1)
  })

  it("stores an ingestion row's call count and the document id it was sent with", async () => {
    const documentId = new Types.ObjectId().toString()
    await recordAiCalls([
      item({
        feature: 'ocr',
        billed_service: 'anthropic',
        model: 'claude-haiku-5-5',
        input_tokens: 1_000_000,
        output_tokens: 0,
        cache_read_tokens: null,
        call_count: 40,
        document_id: documentId,
      }),
    ])
    const row = await AiCallModel.findOne().lean()
    expect(row).toMatchObject({ feature: 'ocr', callCount: 40, inputTokens: 1_000_000 })
    expect(String(row?.documentId)).toBe(documentId)
    // Priced on the summed tokens: 1M input tokens of Haiku 5.5 at $0.10.
    expect(row?.estimatedCostUsd).toBeCloseTo(0.1, 8)
  })

  it('drops a malformed id rather than failing the save', async () => {
    await recordAiCalls([item({ document_id: 'not-an-id' })], { userId: 'nope' })
    const row = await AiCallModel.findOne().lean()
    expect(row?.documentId).toBeUndefined()
    expect(row?.userId).toBeUndefined()
  })

  it('writes one row per call', async () => {
    await recordAiCalls(
      [item(), item({ feature: 'retrieval', billed_service: 'cohere-embed' })],
      {},
    )
    expect(await AiCallModel.countDocuments()).toBe(2)
  })

  it('ignores a payload that is not a usage list', async () => {
    await recordAiCalls(undefined, {})
    await recordAiCalls('nope', {})
    await recordAiCalls([{ feature: 'bogus' }, null], {})
    expect(await AiCallModel.countDocuments()).toBe(0)
  })

  it('never throws when saving fails', async () => {
    vi.spyOn(AiCallModel, 'insertMany').mockRejectedValue(new Error('db down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordAiCalls([item()], {})).resolves.toBeUndefined()
  })
})

describe('callers record what their service returned', () => {
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  it('records Whisper usage when a recording is transcribed (S5 itself stores nothing)', async () => {
    const whisper = item({
      feature: 'transcribe',
      billed_service: 'openai-whisper',
      model: 'whisper-1',
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      audio_seconds: 30,
    })
    vi.mocked(fetch).mockResolvedValue(json({ transcript: 'hello', usage: [whisper] }))
    expect(await transcribe('audio/a.m4a', 'RPT-2026-0901')).toBe('hello')
    expect(await AiCallModel.findOne().lean()).toMatchObject({
      feature: 'transcribe',
      billedService: 'openai-whisper',
      reportId: 'RPT-2026-0901',
      audioSeconds: 30,
    })
  })

  it('records labelling usage with the cost the labelling service worked out', async () => {
    const usage = [
      {
        model: 'claude-haiku-5-5',
        input_tokens: 9000,
        output_tokens: 400,
        cost_usd: 0.0011,
        seconds: 3.2,
      },
      { model: 'jev', input_tokens: 9000, output_tokens: 0, cost_usd: 0.00038, seconds: 1.1 },
    ]
    vi.mocked(fetch).mockResolvedValue(json({ details: {}, unconfirmed: [], usage }))
    await labelDocument(Buffer.from('%PDF'))
    const rows = await AiCallModel.find().sort({ billedService: 1 }).lean()
    expect(rows.map((r) => r.billedService)).toEqual(['anthropic', 'typesafe-jev'])
    expect(rows[0]).toMatchObject({
      feature: 'label-document',
      durationMs: 3200,
      estimatedCostUsd: 0.0011,
    })
    expect(rows[0].pricingBasis).toContain('ingestion-service')
  })

  it('stores the rates the labelling service priced its calls at', async () => {
    // gpt-6-luna at $0.10 in, $0.50 out per 1M: 1,000,000 in = $0.10; 200,000 out = $0.10.
    const usage = [
      {
        model: 'gpt-6-luna',
        input_tokens: 1_000_000,
        output_tokens: 200_000,
        cost_usd: 0.2,
        seconds: 2,
        input_usd_per_1m: 0.1,
        output_usd_per_1m: 0.5,
      },
    ]
    vi.mocked(fetch).mockResolvedValue(json({ details: {}, unconfirmed: [], usage }))
    await labelDocument(Buffer.from('%PDF'))
    const row = await AiCallModel.findOne().lean()
    expect(row?.estimatedCostUsd).toBe(0.2)
    expect(row?.costParts).toEqual([
      expect.objectContaining({ part: 'input', quantity: 1_000_000, usdPer: 0.1, costUsd: 0.1 }),
      expect.objectContaining({ part: 'output', quantity: 200_000, usdPer: 0.5, costUsd: 0.1 }),
    ])
  })

  it('maps labelling usage items into the common shape', () => {
    const [wire] = labelUsageToWire([
      { model: 'gpt-6-luna', input_tokens: 10, output_tokens: 5, cost_usd: 0.1, seconds: 2 },
    ])
    expect(wire).toMatchObject({
      feature: 'label-document',
      billed_service: 'openai-label',
      duration_ms: 2000,
    })
  })
})

describe('Cohere price settings', () => {
  const original = { ...config.prices }
  afterEach(() => Object.assign(config.prices, original))
  const embed = (over: Partial<WireUsage> = {}) =>
    item({
      billed_service: 'cohere-embed',
      model: 'embed-v4.0',
      input_tokens: 1_000_000,
      output_tokens: null,
      cache_read_tokens: null,
      ...over,
    })
  const rerank = item({
    billed_service: 'cohere-rerank',
    model: 'rerank-v3.5',
    input_tokens: null,
    output_tokens: null,
    cache_read_tokens: null,
    search_units: 1000,
  })

  const COHERE_TRIAL = expect.stringContaining('trial key')

  it('prices nothing on the free trial key, the default, and says so', () => {
    expect(config.prices.cohereKeyTier).toBe('trial')
    for (const call of [embed(), rerank]) {
      const cost = estimateCost(call)
      expect(cost.estimatedCostUsd).toBe(0)
      expect(cost.pricingBasis).toContain('trial key')
    }
    // Free whatever it reports.
    const nothing = estimateCost(embed({ input_tokens: null, usage_status: 'unavailable' }))
    expect(nothing).toMatchObject({ estimatedCostUsd: 0, pricingBasis: COHERE_TRIAL })
  })

  it('prices embed tokens and rerank searches as labelled estimates on a production key', () => {
    config.prices.cohereKeyTier = 'production'
    const e = estimateCost(embed())
    expect(e.estimatedCostUsd).toBeCloseTo(0.12, 8)
    expect(e.pricingBasis).toContain('estimate')
    expect(estimateCost(rerank).estimatedCostUsd).toBeCloseTo(2, 8)
    // As for any paid call, incomplete usage is not priced at all (no zero costs).
    expect(estimateCost({ ...rerank, search_units: null }).estimatedCostUsd).toBeNull()
  })

  it('can be overridden from the environment settings', () => {
    config.prices.cohereKeyTier = 'production'
    config.prices.cohereEmbedUsdPer1M = 0.5
    const cost = estimateCost(
      item({
        billed_service: 'cohere-embed',
        model: 'embed-v4.0',
        input_tokens: 1_000_000,
        output_tokens: null,
      }),
    )
    expect(cost.estimatedCostUsd).toBeCloseTo(0.5, 8)
  })
})

describe('backfillCostParts', () => {
  const old = {
    feature: 'draft-section',
    billedService: 'anthropic',
    model: 'claude-sonnet-5-5',
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    usageStatus: 'recorded',
    pricingBasis: 'Anthropic list price, 2026-10-08',
  }

  it("stores today's rates on old rows they reproduce exactly, and leaves the rest", async () => {
    await AiCallModel.insertMany([
      // 1,000 in × $2/1M + 500 out × $10/1M = $0.007: today's rates.
      { ...old, reportId: 'match', estimatedCostUsd: 0.007 },
      // Saved at an earlier price: today's rates would misstate it.
      { ...old, reportId: 'earlier', estimatedCostUsd: 0.005 },
      // Labelling, priced by the ingestion service: gpt-6-luna at $0.10 in, $0.50 out.
      {
        ...old,
        feature: 'label-document',
        billedService: 'openai-label',
        model: 'gpt-6-luna',
        reportId: 'label',
        inputTokens: 1_000_000,
        outputTokens: 200_000,
        cacheReadTokens: null,
        estimatedCostUsd: 0.2,
        pricingBasis: 'ingestion-service PRICES table',
      },
      // No cost: nothing to explain.
      { ...old, reportId: 'free', estimatedCostUsd: null, pricingBasis: 'no price for model' },
    ])

    expect(await backfillCostParts()).toEqual({ stored: 2, left: 1 })

    const parts = async (reportId: string) =>
      (await AiCallModel.findOne({ reportId }).lean())?.costParts
    expect(await parts('match')).toEqual([
      expect.objectContaining({ part: 'input', quantity: 1000, usdPer: 2 }),
      expect.objectContaining({ part: 'output', quantity: 500, usdPer: 10 }),
      expect.objectContaining({ part: 'cached input', quantity: 0, usdPer: 0.1 }),
    ])
    expect(await parts('label')).toEqual([
      expect.objectContaining({ part: 'input', quantity: 1_000_000, usdPer: 0.1 }),
      expect.objectContaining({ part: 'output', quantity: 200_000, usdPer: 0.5 }),
    ])
    expect(await parts('earlier')).toBeUndefined()
    expect(await parts('free')).toBeUndefined()
    // Safe to run again: nothing left that it can match.
    expect(await backfillCostParts()).toEqual({ stored: 0, left: 1 })
  })
})

describe('repriceAiCalls', () => {
  it('prices rows saved before their model had a price, and leaves the rest', async () => {
    const row = {
      feature: 'draft-section',
      billedService: 'anthropic',
      reportId: 'RPT-2026-0001',
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      usageStatus: 'recorded',
      estimatedCostUsd: null,
      pricingBasis: 'no price for model',
    }
    await AiCallModel.insertMany([
      { ...row, model: 'claude-sonnet-5-5' },
      { ...row, model: 'claude-future-9' },
    ])

    expect(await repriceAiCalls()).toEqual({ priced: 1, unpriced: 1 })
    const sonnet = await AiCallModel.findOne({ model: 'claude-sonnet-5-5' }).lean()
    expect(sonnet?.estimatedCostUsd).toBeCloseTo((1000 * 2 + 500 * 10) / 1e6, 8)
    expect(sonnet?.pricingBasis).toContain('platform.claude.com')
    expect(sonnet?.costParts).toContainEqual(
      expect.objectContaining({ part: 'input', quantity: 1000, usdPer: 2 }),
    )
    const future = await AiCallModel.findOne({ model: 'claude-future-9' }).lean()
    expect(future?.estimatedCostUsd).toBeNull()
  })
})

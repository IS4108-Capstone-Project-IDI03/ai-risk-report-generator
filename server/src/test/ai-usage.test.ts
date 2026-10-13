// EV-03: AI-call usage records. Pure pricing tests, the recorder, and the three
// callers (speech, labelling, drafting) with their downstream services stubbed.
// No test here reaches a paid API.
import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config'
import { AiCallModel } from '../models/ai-call.model'
import { estimateCost } from '../services/ai-pricing.service'
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

  it('matches a dated model id to its price', () => {
    const cost = estimateCost(item({ model: 'claude-haiku-4-5-20251001' }))
    expect(cost.estimatedCostUsd).toBeCloseTo((1000 * 1 + 500 * 5 + 2000 * 0.1) / 1e6, 8)
  })

  it('has no cost for a model it has no price for', () => {
    const cost = estimateCost(item({ model: 'claude-future-9' }))
    expect(cost).toEqual({ estimatedCostUsd: null, pricingBasis: 'no price for model' })
  })

  it('prices Cohere embed tokens and rerank searches as labelled estimates', () => {
    const embed = estimateCost(
      item({
        billed_service: 'cohere-embed',
        model: 'embed-v4.0',
        input_tokens: 1_000_000,
        output_tokens: null,
        cache_read_tokens: null,
      }),
    )
    expect(embed.estimatedCostUsd).toBeCloseTo(0.12, 8)
    expect(embed.pricingBasis).toContain('estimate')
    const rerank = estimateCost(
      item({
        billed_service: 'cohere-rerank',
        model: 'rerank-v3.5',
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        search_units: 1000,
      }),
    )
    expect(rerank.estimatedCostUsd).toBeCloseTo(2, 8)
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
    const noUnits = estimateCost(
      item({ billed_service: 'cohere-rerank', model: 'rerank-v3.5', search_units: null }),
    )
    expect(noUnits.estimatedCostUsd).toBeNull()
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
        feature: 'embed-document',
        billed_service: 'cohere-embed',
        model: 'embed-v4.0',
        input_tokens: 1_000_000,
        output_tokens: null,
        cache_read_tokens: null,
        call_count: 40,
        document_id: documentId,
      }),
    ])
    const row = await AiCallModel.findOne().lean()
    expect(row).toMatchObject({ feature: 'embed-document', callCount: 40, inputTokens: 1_000_000 })
    expect(String(row?.documentId)).toBe(documentId)
    // Priced on the summed tokens: 1M tokens at the $0.12 default.
    expect(row?.estimatedCostUsd).toBeCloseTo(0.12, 8)
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

  it('can be overridden from the environment settings', () => {
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

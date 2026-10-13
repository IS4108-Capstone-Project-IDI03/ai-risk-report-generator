// POST /api/internal/ai-usage (EV-03): the ingestion worker posts what a
// document's OCR and embedding used; the gateway prices and saves it.
import { Types } from 'mongoose'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import app from '../index'
import { config } from '../config'
import { AiCallModel } from '../models/ai-call.model'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const KEY = config.serviceApiKey
if (!KEY) throw new Error('SERVICE_API_KEY must be set for the internal usage tests.')

const documentId = new Types.ObjectId().toString()
// One summed item as app/usage.py sends it: 40 OCR calls for one document.
const OCR = {
  feature: 'ocr',
  billed_service: 'anthropic',
  model: 'claude-haiku-5-5',
  document_id: documentId,
  call_count: 40,
  duration_ms: 96_000,
  input_tokens: 400_000,
  output_tokens: 20_000,
  cache_read_tokens: null,
  search_units: null,
  audio_seconds: null,
  usage_status: 'recorded',
}
// `null` sends no key at all.
const post = (body: unknown, key: string | null = KEY!) => {
  const req = request(app).post('/api/internal/ai-usage')
  return (key ? req.set('x-service-key', key) : req).send(body as object)
}

describe('POST /api/internal/ai-usage', () => {
  it('saves each item against its document, priced by the gateway', async () => {
    const res = await post({ usage: [OCR] })

    expect(res.status).toBe(204)
    const [row] = await AiCallModel.find().lean()
    expect(row).toMatchObject({
      feature: 'ocr',
      billedService: 'anthropic',
      callCount: 40,
      durationMs: 96_000,
      usageStatus: 'recorded',
    })
    expect(String(row.documentId)).toBe(documentId)
    expect(row.reportId).toBeUndefined()
    // Haiku 5.5 at $0.10 in / $0.50 out per 1M: 0.04 + 0.01.
    expect(row.estimatedCostUsd).toBeCloseTo(0.05, 8)
  })

  it('needs the service key', async () => {
    expect((await post({ usage: [OCR] }, null)).status).toBe(401)
    expect((await post({ usage: [OCR] }, 'wrong-key')).status).toBe(401)
    expect(await AiCallModel.countDocuments()).toBe(0)
  })

  it('refuses a body that is not a usage list', async () => {
    expect((await post({ usage: 'nope' })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect(await AiCallModel.countDocuments()).toBe(0)
  })

  it('saves self-hosted OCR at no cost even when it reports no tokens', async () => {
    await post({
      usage: [
        {
          ...OCR,
          billed_service: 'self-hosted-ocr',
          model: 'glm-ocr',
          input_tokens: null,
          output_tokens: null,
          usage_status: 'unavailable',
        },
      ],
    })

    const [row] = await AiCallModel.find().lean()
    expect(row).toMatchObject({ usageStatus: 'unavailable', estimatedCostUsd: 0 })
    expect(row.pricingBasis).toContain('self-hosted')
  })
})

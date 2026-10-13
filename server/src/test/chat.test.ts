import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// POST /api/chat (CB-01 Step 0): the gateway streams S4's chat events through
// unchanged, to signed-in users only. S4 stands in as a stubbed fetch.
const engineer = signedInAsRole(app, 'risk_engineer')
const EVENTS =
  'data: {"type":"TEXT_MESSAGE_START","messageId":"m"}\n\n' +
  'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":"Hi"}\n\n'
const BODY = { messages: [{ id: '1', role: 'user', content: 'Where are sprinklers needed?' }] }

afterEach(() => vi.unstubAllGlobals())

describe('POST /api/chat', () => {
  it("streams S4's answer events through with the question it was sent", async () => {
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      sent(url, JSON.parse(String(init!.body)))
      return new Response(EVENTS, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const res = await engineer.post('/api/chat').send(BODY)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    expect(res.text).toBe(EVENTS)
    expect(sent).toHaveBeenCalledWith(expect.stringMatching(/\/chat$/), BODY)
  })

  // S4 ends every answer with one chat_result event carrying the usage list (CB-01).
  const usageItem = (over: object) => ({
    feature: 'chat',
    billed_service: 'anthropic',
    model: 'claude-sonnet-5-5',
    duration_ms: 1200,
    input_tokens: 15000,
    output_tokens: 300,
    cache_read_tokens: 0,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
    ...over,
  })
  const RESULT =
    'data: ' +
    JSON.stringify({
      type: 'CUSTOM',
      name: 'chat_result',
      value: {
        citations: [],
        usage: [
          usageItem({}),
          usageItem({ feature: 'retrieval', billed_service: 'openai', model: 'gpt-6-luna' }),
        ],
      },
    }) +
    '\n\n'
  const stubS4 = (body: string) =>
    vi.stubGlobal(
      'fetch',
      async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
    )

  it('records the usage in the chat_result event and still passes it on unchanged', async () => {
    stubS4(EVENTS + RESULT)
    const res = await engineer.post('/api/chat').send(BODY)
    expect(res.text).toBe(EVENTS + RESULT)
    await vi.waitFor(async () => expect(await AiCallModel.countDocuments()).toBe(2))
    const row = await AiCallModel.findOne({ feature: 'chat' }).lean()
    expect(row).toMatchObject({ billedService: 'anthropic', model: 'claude-sonnet-5-5' })
    expect(row?.reportId).toBeUndefined()
    expect(row?.estimatedCostUsd).toBeCloseTo((15000 * 2 + 300 * 10) / 1e6, 8)
  })

  it('records nothing when the stream has no chat_result event', async () => {
    stubS4(EVENTS)
    await engineer.post('/api/chat').send(BODY)
    await new Promise((r) => setTimeout(r, 50))
    expect(await AiCallModel.countDocuments()).toBe(0)
  })

  it('needs a signed-in user', async () => {
    expect((await request(app).post('/api/chat').send(BODY)).status).toBe(401)
  })

  it('says so when S4 cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const res = await engineer.post('/api/chat').send(BODY)
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/could not be reached/)
  })
})

import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import type { IUser } from '../models/user.model'
import { signedInAs, signedInAsRole } from './auth-test-helpers'
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

// S4 ends each answer with what its paid calls used (EV-03), for the gateway alone.
const EMBED = {
  feature: 'retrieval',
  billed_service: 'cohere-embed',
  model: 'embed-v4.0',
  duration_ms: 120,
  input_tokens: 7,
  output_tokens: null,
  cache_read_tokens: null,
  search_units: null,
  audio_seconds: null,
  usage_status: 'recorded',
}
const USAGE = `data: ${JSON.stringify({ type: 'CUSTOM', name: 'usage', value: [EMBED] })}\n\n`

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

  it("records the answer's paid calls as chat, for the user who asked, and keeps them from the browser (EV-03)", async () => {
    const userId = new Types.ObjectId()
    const user = { _id: userId, role: 'risk_engineer', name: 'Alex' } as unknown as IUser & {
      _id: unknown
    }
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(EVENTS + USAGE, { headers: { 'Content-Type': 'text/event-stream' } }),
    )

    const res = await signedInAs(app, user).post('/api/chat').send(BODY)

    expect(res.text).toBe(EVENTS)
    const rows = await AiCallModel.find().lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      feature: 'chat',
      billedService: 'cohere-embed',
      inputTokens: 7,
    })
    expect(String(rows[0].userId)).toBe(String(userId))
    expect(rows[0].reportId).toBeUndefined()
  })

  it('finds the usage event even when it arrives split across chunks', async () => {
    const whole = new TextEncoder().encode(EVENTS + USAGE)
    const cut = EVENTS.length + 20
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(whole.slice(0, cut))
              controller.enqueue(whole.slice(cut))
              controller.close()
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    )

    const res = await engineer.post('/api/chat').send(BODY)

    expect(res.text).toBe(EVENTS)
    expect(await AiCallModel.countDocuments({ feature: 'chat' })).toBe(1)
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

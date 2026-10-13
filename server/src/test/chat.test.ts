import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
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

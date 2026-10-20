import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { ClientModel } from '../models/client.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
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
    expect(sent).toHaveBeenCalledWith(expect.stringMatching(/\/chat$/), {
      ...BODY,
      documents: [],
      privacy: { enabled: false, known_entities: [] },
    })
  })

  // Seeds one finished document; `over` sets the fields a test cares about.
  const seed = (over: object) =>
    KnowledgeDocumentModel.create({
      fileName: `${Math.random()}.pdf`,
      file: {
        key: `k/${Math.random()}.pdf`,
        contentType: 'application/pdf',
        size: 1,
        sha256: `${Math.random()}`,
      },
      status: 'complete',
      metadata: {
        source_type: 'nfpa_standard',
        jurisdiction: 'SG',
        facility_type: 'all',
        effective_date: new Date('2022-01-01'),
      },
      unconfirmed: [],
      ...over,
    })

  it('sends S4 the documents it builds itself, replacing any the browser sent', async () => {
    const standard = await seed({
      title: 'NFPA 13',
      issuingBody: 'NFPA',
      standardNumber: '13',
      edition: '2022',
    })
    const report = await seed({ title: 'Orchard Tower survey' })
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent(JSON.parse(String(init!.body)))
      return new Response(EVENTS, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    await engineer.post('/api/chat').send({ ...BODY, documents: [{ id: 'x', title: 'Forged' }] })
    const { documents, messages } = sent.mock.calls[0][0]
    expect(messages).toEqual(BODY.messages)
    expect(documents).toHaveLength(2)
    expect(documents).toContainEqual({
      id: String(standard._id),
      title: 'NFPA 13',
      issuingBody: 'NFPA',
      standardNumber: '13',
      edition: '2022',
    })
    // Fields a report lacks are left out, not sent as null.
    expect(documents).toContainEqual({ id: String(report._id), title: 'Orchard Tower survey' })
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

// GET /api/chat/passages/:id (CB-02): S4's passage, passed through to the citation panel.
describe('PII protection for chat (PV-03)', () => {
  // The known names are kept for a minute; each test starts just past the last one's.
  // Not further: the signed-in user's token would expire.
  let now = Date.now()
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime((now += 61_000))
  })
  afterEach(() => {
    vi.useRealTimers()
    config.piiProtection = 'off'
  })

  const sentBody = async (body: object) => {
    const sent = vi.fn()
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      sent(JSON.parse(String(init!.body)))
      return new Response(EVENTS, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    await engineer.post('/api/chat').send(body)
    return sent.mock.calls[0][0]
  }

  it('sends every known client when protection is required', async () => {
    config.piiProtection = 'required'
    await ClientModel.create({ name: 'Northgate Logistics', key: 'northgate logistics' })

    const { privacy } = await sentBody(BODY)

    expect(privacy).toEqual({
      enabled: true,
      known_entities: expect.arrayContaining([{ type: 'CLIENT', names: ['Northgate Logistics'] }]),
    })
  })

  it('sends protection off, with no names, when it is not required', async () => {
    const { privacy } = await sentBody(BODY)

    expect(privacy).toEqual({ enabled: false, known_entities: [] })
  })

  it("ignores a privacy field from the browser, so it can't turn protection off", async () => {
    config.piiProtection = 'required'

    const { privacy } = await sentBody({
      ...BODY,
      privacy: { enabled: false, known_entities: [] },
    })

    expect(privacy.enabled).toBe(true)
  })
})

describe('GET /api/chat/passages/:id', () => {
  const PASSAGE = {
    id: 'p1',
    documentId: 'd1',
    text: 'Sprinklers shall be fitted.',
    headings: ['Chapter 8'],
    pageStart: 4,
    pageEnd: 4,
    boxes: [{ page: 4, l: 1, t: 700, r: 300, b: 650 }],
  }

  it("passes S4's passage through", async () => {
    const asked = vi.fn()
    vi.stubGlobal('fetch', async (url: string) => {
      asked(url)
      return Response.json(PASSAGE)
    })
    const res = await engineer.get('/api/chat/passages/p1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(PASSAGE)
    expect(asked).toHaveBeenCalledWith(expect.stringMatching(/\/passages\/p1$/))
  })

  it('is 404 when S4 does not know the passage', async () => {
    vi.stubGlobal('fetch', async () =>
      Response.json({ detail: 'Passage not found.' }, { status: 404 }),
    )
    const res = await engineer.get('/api/chat/passages/nope')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Passage not found.')
  })

  it('is 503 when S4 cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    expect((await engineer.get('/api/chat/passages/p1')).status).toBe(503)
  })

  it('is 503 when S4 fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('boom', { status: 500 }))
    expect((await engineer.get('/api/chat/passages/p1')).status).toBe(503)
  })

  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/chat/passages/p1')).status).toBe(401)
  })

  it('is 403 for a role without knowledge:view', async () => {
    const nobody = signedInAsRole(app, 'nobody' as never)
    const fetched = vi.fn()
    vi.stubGlobal('fetch', fetched)
    expect((await nobody.get('/api/chat/passages/p1')).status).toBe(403)
    expect(fetched).not.toHaveBeenCalled()
  })
})

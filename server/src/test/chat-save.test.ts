import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// CB-03: POST /api/chat saves the question and the answer into the chat named by
// threadId. S4 stands in as a stubbed fetch, so no paid call is made.
const alex = signedInAsRole(app, 'risk_engineer', 'Alex')
const jide = signedInAsRole(app, 'risk_engineer', 'Jide')
const sse = (e: object) => `data: ${JSON.stringify(e)}\n\n`
const ANSWER =
  sse({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }) +
  sse({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'root = Answer([s1])\n' }) +
  sse({
    type: 'TEXT_MESSAGE_CONTENT',
    messageId: 'a1',
    delta: 's1 = Statement("Fit sprinklers.", [])',
  }) +
  sse({ type: 'TEXT_MESSAGE_END', messageId: 'a1' })

afterEach(() => vi.unstubAllGlobals())

const stubS4 = (body: string | ReadableStream) =>
  vi.stubGlobal(
    'fetch',
    async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
  )
const newChat = async (who = alex, content = 'Where are sprinklers needed?') =>
  (await who.post('/api/chat/conversations').send({ message: { content } })).body.id as string
const ask = (who: typeof alex, threadId: string, content = 'Where are sprinklers needed?') =>
  who.post('/api/chat').send({ threadId, messages: [{ id: 'q1', role: 'user', content }] })

describe('saving a chat (CB-03)', () => {
  it('saves the question and the finished answer, and a reopened chat returns both in order (AC1, AC6)', async () => {
    stubS4(ANSWER)
    const id = await newChat()
    const res = await ask(alex, id)
    expect(res.status).toBe(200)
    expect(res.text).toBe(ANSWER)
    const { body } = await alex.get(`/api/chat/conversations/${id}`)
    expect(body.messages).toEqual([
      { id: 'q1', role: 'user', content: 'Where are sprinklers needed?' },
      {
        id: expect.any(String),
        role: 'assistant',
        content: 'root = Answer([s1])\ns1 = Statement("Fit sprinklers.", [])',
      },
    ])
  })

  it('saves an answer cut off mid-way as stopped, not lost', async () => {
    // One chunk, then the connection drops on the next read (an error queued behind a chunk
    // would discard it before the gateway saw it).
    const first = new TextEncoder().encode(
      sse({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }) +
        sse({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'root = Ans' }),
    )
    let reads = 0
    const half = new ReadableStream({
      async pull(controller) {
        if (reads++ === 0) return controller.enqueue(first)
        // Gives the gateway time to pass the first chunk on before the drop.
        await new Promise((resolve) => setTimeout(resolve, 50))
        controller.error(new Error('dropped'))
      },
    })
    stubS4(half)
    const id = await newChat()
    // The cut-off stream breaks the response, so the request itself errors.
    await ask(alex, id).catch(() => {})
    await vi.waitFor(async () => {
      const { body } = await alex.get(`/api/chat/conversations/${id}`)
      expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant'])
      expect(body.messages[1].content).toBe('root = Ans')
    })
  })

  it("refuses to save into another user's chat, and sends nothing to S4 (AC7)", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const id = await newChat()
    const res = await ask(jide, id)
    expect(res.status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('still answers a question that names no chat', async () => {
    stubS4(ANSWER)
    const res = await alex
      .post('/api/chat')
      .send({ messages: [{ id: 'q', role: 'user', content: 'Hi' }] })
    expect(res.status).toBe(200)
    expect(res.text).toBe(ANSWER)
  })

  describe('searching my chats (AC3)', () => {
    const found = async (q: string) =>
      (await alex.get('/api/chat/conversations').query({ q })).body.threads.map(
        (t: { id: string }) => t.id,
      )

    it('finds chats whose name, questions or answers contain my words, in any case and part-word', async () => {
      stubS4(ANSWER) // every answer says "Fit sprinklers."
      const byName = await newChat(alex, 'Chiller room notes')
      const byQuestion = await newChat(alex, 'Hangar notes')
      await ask(alex, byQuestion, 'Is a deluge system needed?')
      const byAnswer = await newChat(alex, 'Warehouse notes')
      await ask(alex, byAnswer, 'Where?')
      expect(await found('CHILLER')).toEqual([byName])
      expect(await found('delug')).toEqual([byQuestion])
      expect(await found('sprinkl')).toEqual([byAnswer, byQuestion]) // newest first
      expect(await found('nothing like this')).toEqual([])
    })

    it("never returns another user's chats, and treats symbols as plain text", async () => {
      stubS4(ANSWER)
      await ask(jide, await newChat(jide, 'Secret'), 'secret deluge question')
      expect(await found('deluge')).toEqual([])
      expect((await alex.get('/api/chat/conversations').query({ q: '(.*' })).status).toBe(200)
    })
  })
})

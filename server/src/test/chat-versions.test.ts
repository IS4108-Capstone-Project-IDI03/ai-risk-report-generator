import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// CB-04: a retry or an edited question adds a sibling in the chat's message tree; the chat
// shows one path and a switch flips to another. S4 is a stubbed fetch, so no paid call is made.
const alex = signedInAsRole(app, 'risk_engineer', 'Alex')
const jide = signedInAsRole(app, 'risk_engineer', 'Jide')
const sse = (e: object) => `data: ${JSON.stringify(e)}\n\n`
const answer = (id: string, text: string) =>
  sse({ type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' }) +
  sse({ type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: text }) +
  sse({ type: 'TEXT_MESSAGE_END', messageId: id })

afterEach(() => vi.unstubAllGlobals())

const CHATS = '/api/chat/conversations'
const user = (id: string, content: string) => ({ id, role: 'user', content })
const bot = (id: string, content: string) => ({ id, role: 'assistant', content })
const newChat = async () =>
  (await alex.post(CHATS).send({ message: { content: 'Start' } })).body.id as string

// Sends `messages` (the path on screen) and S4 answers with `text` as message `answerId`.
async function send(threadId: string, messages: object[], answerId: string, text: string) {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(answer(answerId, text), { headers: { 'Content-Type': 'text/event-stream' } }),
  )
  const res = await alex.post('/api/chat').send({ threadId, messages })
  expect(res.status).toBe(200)
}
const view = async (threadId: string, who = alex) => (await who.get(`${CHATS}/${threadId}`)).body
const texts = (body: { messages: { content: string }[] }) => body.messages.map((m) => m.content)

describe('retrying and editing (CB-04)', () => {
  it('a retry adds a second answer under the same question and shows it, with a way back (AC1)', async () => {
    const id = await newChat()
    await send(id, [user('q1', 'Q1')], 'a1', 'first answer')
    // Retry: the browser cuts the chat back to the question and asks again.
    await send(id, [user('q1b', 'Q1')], 'a2', 'second answer')
    const body = await view(id)
    expect(texts(body)).toEqual(['Q1', 'second answer'])
    expect(body.versions.a2).toEqual({ ids: ['a1', 'a2'], index: 1 })
    // The retried question is the same question, not a second one.
    expect(Object.keys(body.versions)).toEqual(['a2'])
  })

  it('switching versions shows the earlier answer, and the choice is kept (AC1)', async () => {
    const id = await newChat()
    await send(id, [user('q1', 'Q1')], 'a1', 'first answer')
    await send(id, [user('q1', 'Q1')], 'a2', 'second answer')
    const res = await alex.patch(`${CHATS}/${id}/active`).send({ messageId: 'a1' })
    expect(texts(res.body)).toEqual(['Q1', 'first answer'])
    expect(res.body.versions.a1).toEqual({ ids: ['a1', 'a2'], index: 0 })
    expect(texts(await view(id))).toEqual(['Q1', 'first answer'])
  })

  it('an edited question is a sibling branch; the original stays whole (AC2)', async () => {
    const id = await newChat()
    await send(id, [user('q1', 'Q1')], 'a1', 'answer 1')
    await send(id, [user('q1', 'Q1'), bot('a1', 'answer 1'), user('q2', 'Q2')], 'a2', 'answer 2')
    // Edit Q2: same parent (a1), new wording.
    await send(
      id,
      [user('q1', 'Q1'), bot('a1', 'answer 1'), user('q3', 'Q2 reworded')],
      'a3',
      'answer 3',
    )
    const body = await view(id)
    expect(texts(body)).toEqual(['Q1', 'answer 1', 'Q2 reworded', 'answer 3'])
    expect(body.versions.q3).toEqual({ ids: ['q2', 'q3'], index: 1 })
    const original = await alex.patch(`${CHATS}/${id}/active`).send({ messageId: 'q2' })
    expect(texts(original.body)).toEqual(['Q1', 'answer 1', 'Q2', 'answer 2'])
  })

  it('a follow-up hangs under the version on screen, not the newest message (AC4)', async () => {
    const id = await newChat()
    await send(id, [user('q1', 'Q1')], 'a1', 'first answer')
    await send(id, [user('q1', 'Q1')], 'a2', 'second answer')
    // On screen: the first answer (a1). The follow-up must hang under it.
    await send(
      id,
      [user('q1', 'Q1'), bot('a1', 'first answer'), user('q2', 'Q2')],
      'a3',
      'follow-up',
    )
    await alex.patch(`${CHATS}/${id}/active`).send({ messageId: 'a2' })
    expect(texts(await view(id))).toEqual(['Q1', 'second answer'])
    const back = await alex.patch(`${CHATS}/${id}/active`).send({ messageId: 'a1' })
    expect(texts(back.body)).toEqual(['Q1', 'first answer', 'Q2', 'follow-up'])
  })

  it("will not switch another user's chat, or to a message from another chat", async () => {
    const id = await newChat()
    await send(id, [user('q1', 'Q1')], 'a1', 'answer')
    const other = await newChat()
    await send(other, [user('q9', 'Q9')], 'z1', 'other answer')
    expect((await jide.patch(`${CHATS}/${id}/active`).send({ messageId: 'a1' })).status).toBe(404)
    expect((await alex.patch(`${CHATS}/${id}/active`).send({ messageId: 'z1' })).status).toBe(404)
  })
})

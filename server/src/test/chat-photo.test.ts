import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { resetChatLimits } from '../services/chat-limits.service'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CB-08: a photo attached to a chat question. S3, S5 (face check and description) and S4 are
// stubbed, so no paid call is made.
const s3 = new Map<string, Buffer>()
vi.mock('../services/storage.service', () => ({
  putObject: vi.fn(async (key: string, body: Buffer) => void s3.set(key, body)),
  getObjectStream: async (key: string) => {
    if (!s3.has(key)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
    return Readable.from([s3.get(key)!])
  },
  deleteObject: vi.fn(async (key: string) => void s3.delete(key)),
  copyObject: vi.fn(),
}))

useMemoryMongo()

const alex = signedInAsRole(app, 'risk_engineer', 'Alex')
const jide = signedInAsRole(app, 'risk_engineer', 'Jide')
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)])
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
])
const sse = (e: object) => `data: ${JSON.stringify(e)}\n\n`
const ANSWER =
  sse({ type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant' }) +
  sse({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 'root = Answer([s1])\n' }) +
  sse({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: 's1 = Statement("Ok.", [])' }) +
  sse({ type: 'TEXT_MESSAGE_END', messageId: 'a1' })

// What the stubbed services were asked, and how they answer.
let faces = 0
let unclear = ''
let faceCheckDown = false
let describeDown = false
let s4Body: { context?: { value: string }[] } = {}
const s5Calls: string[] = []

beforeEach(() => {
  resetChatLimits()
  s3.clear()
  s5Calls.length = 0
  faces = 0
  unclear = ''
  faceCheckDown = false
  describeDown = false
  s4Body = {}
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    if (url.endsWith('/chat-photo/faces')) {
      s5Calls.push(JSON.parse(init.body).s3_key)
      if (faceCheckDown) return Response.json({ detail: 'privacy service down' }, { status: 502 })
      return Response.json({
        faces,
        blurred_base64: faces ? Buffer.from([0xff, 0xd8, 0xff, 9]).toString('base64') : null,
      })
    }
    if (url.endsWith('/chat-photo/describe')) {
      s5Calls.push(JSON.parse(init.body).s3_key)
      if (describeDown) return Response.json({ detail: 'vision down' }, { status: 502 })
      return Response.json({
        description: 'A wet-pipe riser with a shut valve.',
        unclear,
        usage: [],
      })
    }
    s4Body = JSON.parse(init.body)
    return new Response(ANSWER, { headers: { 'Content-Type': 'text/event-stream' } })
  })
})
afterEach(() => vi.unstubAllGlobals())

const upload = (who: typeof alex, bytes: Buffer, type = 'image/jpeg') =>
  who.post('/api/chat/photos').set('Content-Type', type).send(bytes)
const newChat = async (who = alex) =>
  (await who.post('/api/chat/conversations').send({ message: { content: 'Q' } })).body.id as string
const ask = (who: typeof alex, threadId: string, attachments?: string[], content = 'Is this OK?') =>
  who
    .post('/api/chat')
    .send({ threadId, attachments, messages: [{ id: 'q1', role: 'user', content }] })

describe('attaching a photo (CB-08 AC2, AC3)', () => {
  it('accepts a JPG or PNG and reports no faces', async () => {
    for (const [bytes, type, ext] of [
      [JPEG, 'image/jpeg', 'jpg'],
      [PNG, 'image/png', 'png'],
    ] as const) {
      const res = await upload(alex, bytes, type)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ faces: 0, blurredId: null })
      expect(res.body.id).toMatch(new RegExp(`\\.${ext}$`))
    }
  })

  it('reports the faces found and keeps a blurred copy beside the original', async () => {
    faces = 2
    const res = await upload(alex, JPEG)
    expect(res.body.faces).toBe(2)
    expect(res.body.blurredId).toMatch(/\.blurred\.jpg$/)
    expect(s3.size).toBe(2)
  })

  it('refuses other types, fake images, empty and oversized files, storing nothing', async () => {
    expect((await upload(alex, Buffer.from('GIF89a-not-allowed'), 'image/gif')).status).toBe(415)
    // A text file renamed .jpg: the type says image, the first bytes say otherwise.
    expect((await upload(alex, Buffer.from('not an image at all'))).status).toBe(415)
    expect((await upload(alex, Buffer.alloc(0))).status).toBe(400)
    expect((await upload(alex, Buffer.concat([JPEG, Buffer.alloc(9 * 1024 * 1024)]))).status).toBe(
      413,
    )
    expect(s3.size).toBe(0)
  })

  it('does not keep the photo when the face check cannot run (fail closed)', async () => {
    faceCheckDown = true
    const res = await upload(alex, JPEG)
    expect(res.status).toBe(503)
    expect(s3.size).toBe(0)
  })

  it('shows a photo to its owner only', async () => {
    const { id } = (await upload(alex, JPEG)).body
    expect((await alex.get(`/api/chat/photos/${id}`)).status).toBe(200)
    expect((await jide.get(`/api/chat/photos/${id}`)).status).toBe(404)
    expect((await alex.get('/api/chat/photos/..%2F..%2Fsecret.jpg')).status).toBe(404)
  })

  it('removes a photo, with its blurred copy', async () => {
    faces = 1
    const { id } = (await upload(alex, JPEG)).body
    expect((await alex.delete(`/api/chat/photos/${id}`)).status).toBe(204)
    expect(s3.size).toBe(0)
  })
})

describe('asking about a photo (CB-08 AC1, AC4, AC5)', () => {
  it('gives S4 what the photo shows, and what could not be made out', async () => {
    unclear = 'The gauge reading.'
    const threadId = await newChat()
    const { id } = (await upload(alex, JPEG)).body
    const res = await ask(alex, threadId, [id])
    expect(res.status).toBe(200)
    const line = (s4Body.context ?? []).map((c) => c.value).join('\n')
    expect(line).toContain('Photo 1: A wet-pipe riser with a shut valve.')
    expect(line).toContain('Could not make out: The gauge reading.')
  })

  it('sends the blurred copy when the engineer chose it and drops the original', async () => {
    faces = 1
    const threadId = await newChat()
    const up = (await upload(alex, JPEG)).body
    await ask(alex, threadId, [up.blurredId])
    expect(s5Calls.at(-1)).toContain('.blurred.jpg')
    expect([...s3.keys()].some((k) => k.endsWith(up.id))).toBe(false)
  })

  it('sends the original when the engineer chose that and drops the blurred copy', async () => {
    faces = 1
    const threadId = await newChat()
    const up = (await upload(alex, JPEG)).body
    await ask(alex, threadId, [up.id])
    expect(s5Calls.at(-1)).toContain(up.id)
    expect([...s3.keys()].some((k) => k.includes('.blurred.'))).toBe(false)
  })

  it('shows the photo with the question when the chat is reopened, and on a retry', async () => {
    const threadId = await newChat()
    const { id } = (await upload(alex, JPEG)).body
    await ask(alex, threadId, [id])
    const view = (await alex.get(`/api/chat/conversations/${threadId}`)).body
    const question = view.messages.find((m: { role: string }) => m.role === 'user')
    expect(question.attachments).toEqual([{ id, url: `/api/chat/photos/${id}` }])
    // "Try again" sends the question without photos: the saved ones are used again.
    s4Body = {}
    await ask(alex, threadId, undefined)
    expect((s4Body.context ?? []).map((c) => c.value).join()).toContain('Photo 1:')
  })

  it("refuses more than 3 photos, or ones that are not the engineer's", async () => {
    const threadId = await newChat()
    const ids = []
    for (let i = 0; i < 4; i++) ids.push((await upload(alex, JPEG)).body.id)
    const many = await ask(alex, threadId, ids)
    expect(many.status).toBe(400)
    const theirs = (await upload(jide, JPEG)).body.id
    const stolen = await ask(alex, threadId, [theirs])
    expect(stolen.status).toBe(400)
  })

  it('answers in the chat when the photo cannot be read, and calls no answer model', async () => {
    describeDown = true
    const threadId = await newChat()
    const { id } = (await upload(alex, JPEG)).body
    const res = await ask(alex, threadId, [id])
    expect(res.status).toBe(200)
    expect(res.text).toMatch(/could not read that photo/i)
    expect(s4Body).toEqual({})
  })

  it('deletes the photos with the conversation', async () => {
    const threadId = await newChat()
    const { id } = (await upload(alex, JPEG)).body
    await ask(alex, threadId, [id])
    expect((await alex.delete(`/api/chat/conversations/${threadId}`)).status).toBe(204)
    expect(s3.size).toBe(0)
  })
})

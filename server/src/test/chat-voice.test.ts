import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { resetChatLimits } from '../services/chat-limits.service'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CB-10: a spoken question becomes text in the message box. The audio goes to S3 only for the
// moment S5 reads it, then is deleted. S3 and S5 are stubbed, so no paid call is made.
const s3 = new Map<string, Buffer>()
vi.mock('../services/storage.service', () => ({
  putObject: vi.fn(async (key: string, body: Buffer) => void s3.set(key, body)),
  getObjectStream: async (key: string) => Readable.from([s3.get(key)!]),
  deleteObject: vi.fn(async (key: string) => void s3.delete(key)),
  copyObject: vi.fn(),
}))

useMemoryMongo()

const VOICE = '/api/chat/transcribe'
let engineer: ReturnType<typeof signedInAsRole>

beforeEach(() => {
  resetChatLimits()
  s3.clear()
  engineer = signedInAsRole(app, 'risk_engineer')
})
afterEach(() => vi.unstubAllGlobals())

const s5Says = (reply: Response) => {
  const calls: { body: { s3_key: string } }[] = []
  vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
    calls.push({ body: JSON.parse(init.body) })
    return reply.clone()
  })
  return calls
}
const send = (audio: Buffer, type = 'audio/webm') =>
  engineer.post(VOICE).set('Content-Type', type).send(audio)

describe('ask by voice (CB-10)', () => {
  it('returns the transcript and keeps no audio afterwards (AC1)', async () => {
    const calls = s5Says(Response.json({ transcript: ' What sprinkler density for EH2? ' }))
    const res = await send(Buffer.from('fake-audio'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ text: 'What sprinkler density for EH2?' })
    expect(calls).toHaveLength(1)
    expect(s3.size).toBe(0)
  })

  it('refuses a file that is not audio, or too large, or empty', async () => {
    s5Says(Response.json({ transcript: 'never used' }))
    expect((await send(Buffer.from('x'), 'text/plain')).status).toBe(415)
    expect((await send(Buffer.alloc(3 * 1024 * 1024))).status).toBe(413)
    expect((await send(Buffer.alloc(0))).status).toBe(400)
    expect(s3.size).toBe(0)
  })

  it('says so when nothing was heard, and still deletes the audio', async () => {
    s5Says(Response.json({ transcript: '   ' }))
    const res = await send(Buffer.from('fake-audio'))
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/no speech/i)
    expect(s3.size).toBe(0)
  })

  it('answers 503 when the speech service fails, and deletes the audio', async () => {
    s5Says(Response.json({ detail: 'down' }, { status: 503 }))
    const res = await send(Buffer.from('fake-audio'))
    expect(res.status).toBe(503)
    expect(s3.size).toBe(0)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { resetChatLimits } from '../services/chat-limits.service'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

// CB-10: a spoken question becomes text in the message box. The clip goes straight to S5 as
// bytes and is stored nowhere. S5 is a stubbed fetch, so no paid call is made.
useMemoryMongo()

const VOICE = '/api/chat/transcribe'
let engineer: ReturnType<typeof signedInAsRole>

beforeEach(() => {
  resetChatLimits()
  engineer = signedInAsRole(app, 'risk_engineer')
})
afterEach(() => vi.unstubAllGlobals())

const s5Says = (reply: Response) => {
  const calls: { url: string; body: { audio_base64: string; filename: string } }[] = []
  vi.stubGlobal('fetch', async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return reply.clone()
  })
  return calls
}
const send = (audio: Buffer, type = 'audio/webm') =>
  engineer.post(VOICE).set('Content-Type', type).send(audio)

describe('ask by voice (CB-10)', () => {
  it('sends the clip straight to S5 and returns the transcript (AC1)', async () => {
    const calls = s5Says(
      Response.json({ transcript: ' What sprinkler density for EH2? ', usage: [] }),
    )
    const res = await send(Buffer.from('fake-audio'))
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ text: 'What sprinkler density for EH2?' })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toMatch(/\/transcribe-clip$/)
    // The bytes travel in the request; nothing is written to storage.
    expect(Buffer.from(calls[0].body.audio_base64, 'base64').toString()).toBe('fake-audio')
    expect(calls[0].body.filename).toBe('question.webm')
  })

  it('refuses a file that is not audio, or too large, or empty', async () => {
    s5Says(Response.json({ transcript: 'never used' }))
    expect((await send(Buffer.from('x'), 'text/plain')).status).toBe(415)
    expect((await send(Buffer.alloc(3 * 1024 * 1024))).status).toBe(413)
    expect((await send(Buffer.alloc(0))).status).toBe(400)
  })

  it('says so when nothing was heard', async () => {
    s5Says(Response.json({ transcript: '   ' }))
    const res = await send(Buffer.from('fake-audio'))
    expect(res.status).toBe(422)
    expect(res.body.error).toMatch(/no speech/i)
  })

  it('answers 503 when the speech service fails', async () => {
    s5Says(Response.json({ detail: 'down' }, { status: 503 }))
    const res = await send(Buffer.from('fake-audio'))
    expect(res.status).toBe(503)
  })
})

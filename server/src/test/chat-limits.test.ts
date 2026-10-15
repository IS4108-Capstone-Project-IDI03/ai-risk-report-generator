import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'
import { addChatSpend, checkChatLimits, resetChatLimits } from '../services/chat-limits.service'

useMemoryMongo()

// CB-01 AC16: a too-long message, or one over the question or spend limits, is
// refused before S4 (and so any model) is called, with the reason as the answer.
const EVENTS = 'data: {"type":"TEXT_MESSAGE_START","messageId":"m"}\n\n'
const ask = (content: string) => ({ messages: [{ id: '1', role: 'user', content }] })
const TOO_LONG = 'Your message is too long. Please keep it under 4,000 characters.'
const PER_MINUTE =
  "You've asked a lot of questions in the last minute. Please wait a minute and try again."
const TODAY = "You've reached today's chat limit. You can ask again tomorrow."

const ITEM = {
  feature: 'chat',
  billed_service: 'anthropic',
  model: 'claude-sonnet-5-5',
  input_tokens: 1,
  output_tokens: 1,
  usage_status: 'recorded',
}
// A chat_result event whose one item costs exactly `usd` (its own cost_usd).
const resultCosting = (usd: number) =>
  'data: ' +
  JSON.stringify({
    type: 'CUSTOM',
    name: 'chat_result',
    value: {
      usage: [{ ...ITEM, cost_usd: usd }],
    },
  }) +
  '\n\n'

let s4Calls: ReturnType<typeof vi.fn>
let s4Body: string
beforeEach(() => {
  resetChatLimits()
  s4Body = EVENTS
  s4Calls = vi.fn()
  vi.stubGlobal('fetch', async () => {
    s4Calls()
    return new Response(s4Body, { headers: { 'Content-Type': 'text/event-stream' } })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// The refusal is a normal 200 answer stream (see chat.routes.ts), so read the message out of it.
const refusalText = (text: string) => {
  const delta = JSON.parse(
    text
      .split('\n\n')
      .find((e) => e.includes('TEXT_MESSAGE_CONTENT'))!
      .replace(/^data: /, ''),
  ).delta as string
  return JSON.parse(delta.match(/Statement\((".*"), \[\]\)/)![1]) as string
}

describe('POST /api/chat limits (AC16)', () => {
  it('refuses a message over 4,000 characters, tells why, and never calls S4', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    const res = await user.post('/api/chat').send(ask('x'.repeat(4001)))
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    expect(refusalText(res.text)).toBe(TOO_LONG)
    expect(res.text).not.toContain('chat_result')
    expect(res.text).toContain('TEXT_MESSAGE_START')
    expect(res.text).toContain('TEXT_MESSAGE_END')
    expect(s4Calls).not.toHaveBeenCalled()
  })

  it('lets a message of exactly 4,000 characters through', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    const res = await user.post('/api/chat').send(ask('x'.repeat(4000)))
    expect(res.text).toBe(EVENTS)
    expect(s4Calls).toHaveBeenCalledTimes(1)
  })

  it('refuses the 11th question within a minute without calling S4', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    for (let i = 0; i < 10; i++) await user.post('/api/chat').send(ask('q'))
    const res = await user.post('/api/chat').send(ask('q'))
    expect(refusalText(res.text)).toBe(PER_MINUTE)
    expect(s4Calls).toHaveBeenCalledTimes(10)
  })

  it('refuses once today’s spend reaches $2.00, using the chat_result cost', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    s4Body = EVENTS + resultCosting(2)
    await user.post('/api/chat').send(ask('q'))
    s4Calls.mockClear()
    const res = await user.post('/api/chat').send(ask('q'))
    expect(refusalText(res.text)).toBe(TODAY)
    expect(s4Calls).not.toHaveBeenCalled()
  })

  it('keeps counting spend under $2.00 and answers normally', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    s4Body = EVENTS + resultCosting(1.99)
    await user.post('/api/chat').send(ask('q'))
    const res = await user.post('/api/chat').send(ask('q'))
    expect(res.text).toBe(s4Body)
  })

  it('counts limits per user', async () => {
    const a = signedInAsRole(app, 'risk_engineer')
    const b = signedInAsRole(app, 'risk_engineer')
    for (let i = 0; i < 10; i++) await a.post('/api/chat').send(ask('q'))
    expect((await b.post('/api/chat').send(ask('q'))).text).toBe(EVENTS)
  })

  it('does not count refused requests toward the limits', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    for (let i = 0; i < 12; i++) await user.post('/api/chat').send(ask('x'.repeat(4001)))
    for (let i = 0; i < 10; i++) {
      expect((await user.post('/api/chat').send(ask('q'))).text).toBe(EVENTS)
    }
  })
  it('refuses a too-long earlier message hidden behind a blank last one', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    const body = {
      messages: [
        { id: '1', role: 'user', content: 'x'.repeat(4001) },
        { id: '2', role: 'user', content: '' },
      ],
    }
    expect(refusalText((await user.post('/api/chat').send(body)).text)).toBe(TOO_LONG)
    expect(s4Calls).not.toHaveBeenCalled()
  })

  it('refuses a too-long context entry', async () => {
    const user = signedInAsRole(app, 'risk_engineer')
    const body = { ...ask('q'), context: [{ description: 'note', value: 'x'.repeat(4001) }] }
    expect(refusalText((await user.post('/api/chat').send(body)).text)).toBe(TOO_LONG)
    expect(s4Calls).not.toHaveBeenCalled()
  })
})

describe('checkChatLimits clock windows', () => {

  it('counts an estimate for each answer, so stopped answers still reach the cap', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 9, 0, 0))
    // No chat_result ever arrives (the engineer stops each answer): 100 x $0.02 = $2.
    for (let n = 0; n < 10; n++) {
      for (let i = 0; i < 10; i++) expect(checkChatLimits('u', ['q'])).toBeNull()
      vi.advanceTimersByTime(61_000)
    }
    expect(checkChatLimits('u', ['q'])).toBe(TODAY)
  })
  it('lets questions through again 60 seconds after the burst', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0))
    for (let i = 0; i < 10; i++) expect(checkChatLimits('u', ['q'])).toBeNull()
    expect(checkChatLimits('u', ['q'])).toBe(PER_MINUTE)
    vi.advanceTimersByTime(61_000)
    expect(checkChatLimits('u', ['q'])).toBeNull()
  })

  it('refuses the 201st question of the day and resets at midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 0, 0, 1))
    // 20 bursts of 10, a minute apart, to stay under the per-minute limit. Each
    // answer finishes and costs $0.001, so the spend cap stays out of the way.
    for (let n = 0; n < 20; n++) {
      for (let i = 0; i < 10; i++) {
        expect(checkChatLimits('u', ['q'])).toBeNull()
        addChatSpend('u', [{ ...ITEM, cost_usd: 0.001 }])
      }
      vi.advanceTimersByTime(61_000)
    }
    expect(checkChatLimits('u', ['q'])).toBe(TODAY)
    vi.setSystemTime(new Date(2026, 9, 16, 0, 0, 1))
    expect(checkChatLimits('u', ['q'])).toBeNull()
  })

  it('forgets the day’s spend at midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 15, 23, 59, 0))
    checkChatLimits('u', ['q'])
    addChatSpend('u', [{ ...ITEM, cost_usd: 2 }])
    expect(checkChatLimits('u', ['q'])).toBe(TODAY)
    vi.setSystemTime(new Date(2026, 9, 16, 0, 0, 1))
    expect(checkChatLimits('u', ['q'])).toBeNull()
  })
})

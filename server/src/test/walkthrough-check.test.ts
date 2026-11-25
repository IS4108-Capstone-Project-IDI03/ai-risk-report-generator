// F-12 test seam 1: the quick check before a try-it passes and fails with the services'
// health routes and provider checks stubbed (no real call, no real cost). Calls
// GET /api/walkthroughs/check through supertest, and tryItReady directly for the timeout.
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { AiCallModel } from '../models/ai-call.model'
import { forgetTryItPasses, tryItReady } from '../services/walkthrough-check.service'
import { saveModelChoice } from '../services/settings.service'
import { signedInAsRole } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const engineer = signedInAsRole(app, 'risk_engineer', 'Priya Nair')
const check = (id: string) => engineer.get(`/api/walkthroughs/check?for=${id}`)

// The services' URLs in vitest.config.mts, all on a closed port; the paths tell them apart.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
let calls: { url: string; init?: RequestInit }[] = []
// A path (plus query) that should answer differently; the rest answer OK.
let answers: Record<string, () => Response | Promise<Response>> = {}

beforeEach(() => {
  calls = []
  answers = {}
  forgetTryItPasses()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const where = new URL(String(url))
    const answer = answers[where.pathname + where.search]
    if (answer) return answer()
    return where.pathname === '/health' ? json({ status: 'ok' }) : json({ ok: true, usage: [] })
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const paths = () => calls.map((c) => new URL(c.url).pathname + new URL(c.url).search).sort()
// All three services sit at the same dead address in tests, so a call is told by its path.
const READY: Record<string, string[]> = {
  'new-docs': ['/health', '/health', '/health/providers?need=llm'],
  'new-observation': ['/health', '/health', '/health/providers', '/health/providers?need=llm'],
  'split-note': ['/health', '/health/providers?need=llm'],
  'site-walk': ['/health', '/health', '/health/providers', '/health/providers?need=llm'],
  ask: ['/health', '/health/providers?need=llm', '/health/providers?need=search'],
  chat: ['/health', '/health/providers?need=chat', '/health/providers?need=search'],
}

describe('a try-it is ready', () => {
  it.each(Object.keys(READY))('%s passes when its services answer OK', async (id) => {
    const res = await check(id)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(paths()).toEqual([...READY[id]].sort())
  })

  it('has no try-it for an unknown id (404)', async () => {
    expect((await check('welcome')).status).toBe(404)
    expect((await check('toString')).status).toBe(404)
    expect((await check('')).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/walkthroughs/check?for=chat')).status).toBe(401)
  })
})

describe('a try-it is not ready', () => {
  it('fails when a health call fails (non-OK answer)', async () => {
    answers['/health'] = () => json({}, 503)
    expect((await check('new-docs')).body).toEqual({ ok: false })
  })

  it('fails when a service cannot be reached at all', async () => {
    answers['/health/providers'] = () => {
      throw new TypeError('fetch failed')
    }
    expect((await check('site-walk')).body).toEqual({ ok: false })
  })

  it('fails when a provider check says no', async () => {
    answers['/health/providers?need=llm'] = () => json({ ok: false, usage: [] })
    expect((await check('split-note')).body).toEqual({ ok: false })
  })

  it('fails when a provider check answers with an error status', async () => {
    answers['/health/providers?need=search'] = () => json({ detail: 'boom' }, 500)
    expect((await check('ask')).body).toEqual({ ok: false })
  })

  it('fails on a timeout (5 s for health, 15 s for a provider) instead of waiting', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    // Hangs until the caller gives up.
    const hang = (_: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const stop = () => reject(new DOMException('aborted', 'AbortError'))
        if (init?.signal?.aborted) stop()
        init?.signal?.addEventListener('abort', stop)
      })
    vi.stubGlobal('fetch', hang)
    const result = tryItReady('chat', { id: 'u1', role: 'risk_engineer', name: 'Priya Nair' })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await result).toBe(false)
  })
})

describe('remembering a pass', () => {
  it('reuses a pass for 5 minutes without calling anything', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    expect((await check('chat')).body.ok).toBe(true)
    const first = calls.length
    expect((await check('chat')).body.ok).toBe(true)
    expect(calls.length).toBe(first)
    vi.advanceTimersByTime(4 * 60_000)
    await check('chat')
    expect(calls.length).toBe(first)
    vi.advanceTimersByTime(61_000)
    await check('chat')
    expect(calls.length).toBe(first * 2)
  })

  it('remembers a fail for 30 seconds only, so a down service is not paid for on every request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    answers['/health/providers?need=llm'] = () => json({ ok: false, usage: [] })
    await check('split-note')
    const first = calls.length
    expect((await check('split-note')).body.ok).toBe(false)
    expect(calls.length).toBe(first)
    delete answers['/health/providers?need=llm']
    vi.advanceTimersByTime(31_000)
    expect((await check('split-note')).body.ok).toBe(true)
    expect(calls.length).toBe(first * 2)
  })

  it('makes no paid ping when a free health call fails', async () => {
    answers['/health'] = () => json({}, 503)
    expect((await check('chat')).body.ok).toBe(false)
    expect(paths()).toEqual(['/health'])
  })

  it('shares one check between requests that arrive while it runs', async () => {
    const priya = { id: 'u1', role: 'risk_engineer' as const, name: 'Priya Nair' }
    expect(await Promise.all([tryItReady('chat', priya), tryItReady('chat', priya)])).toEqual([
      true,
      true,
    ])
    expect(paths()).toEqual([...READY.chat].sort())
  })

  it('checks again after an admin switches the drafting model', async () => {
    const admin = { id: '65f000000000000000000001', role: 'knowledge_admin' as const, name: 'Sana' }
    await saveModelChoice(admin, 'drafting', 'anthropic:claude-sonnet-5-5')
    await check('split-note')
    const first = calls.length
    await saveModelChoice(admin, 'drafting', 'anthropic:claude-opus-5-5')
    await check('split-note')
    expect(calls.length).toBe(first * 2)
    expect(calls.at(-1)?.init?.headers).toEqual({ 'X-Model': 'claude-opus-5-5' })
  })

  it('keeps a pass per set of needs (another try-it is checked on its own)', async () => {
    await check('split-note')
    const before = calls.length
    await check('chat')
    expect(calls.length).toBeGreaterThan(before)
  })
})

describe('what is sent', () => {
  it('sends no body, no cookie and nothing about the user or any client', async () => {
    for (const id of Object.keys(READY)) {
      forgetTryItPasses()
      await check(id)
    }
    const sent = JSON.stringify(calls)
    expect(calls.every((c) => !c.init?.body && (c.init?.method ?? 'GET') === 'GET')).toBe(true)
    for (const text of ['Priya', 'Nair', 'session', 'Cookie', 'Harbourline', 'Authorization']) {
      expect(sent).not.toContain(text)
    }
  })

  it("tests the admin's chosen drafting model through the X-Model header", async () => {
    const admin = { id: '65f000000000000000000001', role: 'knowledge_admin' as const, name: 'Sana' }
    await saveModelChoice(admin, 'drafting', 'anthropic:claude-sonnet-5-5')
    await check('ask')
    const llm = calls.find((c) => c.url.endsWith('need=llm'))!
    expect(llm.init?.headers).toEqual({ 'X-Model': 'claude-sonnet-5-5' })
    expect(calls.filter((c) => c.init?.headers)).toHaveLength(1)
  })

  it('also checks privacy-service, through rag-service, when client-detail protection is on', async () => {
    const was = config.piiProtection
    config.piiProtection = 'required'
    try {
      await check('chat')
      expect(paths()).toContain('/health/providers?need=privacy')
      forgetTryItPasses()
      calls = []
      answers['/health/providers?need=privacy'] = () => json({ ok: false, usage: [] })
      expect((await check('chat')).body.ok).toBe(false)
    } finally {
      config.piiProtection = was
    }
    forgetTryItPasses()
    calls = []
    await check('chat')
    expect(paths()).not.toContain('/health/providers?need=privacy')
  })
})

describe('the tiny paid request', () => {
  const item = {
    feature: 'draft-section',
    billed_service: 'anthropic',
    model: 'claude-opus-5-5',
    duration_ms: 900,
    input_tokens: 20,
    output_tokens: 5,
    cache_read_tokens: null,
    search_units: null,
    audio_seconds: null,
    usage_status: 'recorded',
  }

  it('is recorded under Walkthrough for the user, with no assessment, even when it failed', async () => {
    answers['/health/providers?need=llm'] = () => json({ ok: false, usage: [item] })
    await check('split-note')
    const rows = await AiCallModel.find().lean()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      feature: 'walkthrough',
      model: 'claude-opus-5-5',
      inputTokens: 20,
    })
    expect(rows[0].reportId).toBeUndefined()
    expect(String(rows[0].userId)).toMatch(/^[0-9a-f]{24}$/)
  })

  it('is not recorded again when a remembered pass is reused', async () => {
    answers['/health/providers?need=llm'] = () => json({ ok: true, usage: [item] })
    await check('split-note')
    await check('split-note')
    expect(await AiCallModel.countDocuments()).toBe(1)
  })
})

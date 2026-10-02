import bcrypt from 'bcrypt'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { UserModel } from '../models/user.model'
import { useMemoryMongo } from './memory-mongo'
import { signedInAs } from './auth-test-helpers'

useMemoryMongo()

async function seedUser(overrides: Record<string, unknown> = {}) {
  return UserModel.create({
    staffId: 'MRE-0002',
    name: 'Jide Okafor',
    email: 'jide.okafor@example.com',
    role: 'risk_engineer',
    passwordHash: await bcrypt.hash('correct horse', 10),
    ...overrides,
  })
}

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials and sets a session cookie', async () => {
    await seedUser()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jide.okafor@example.com', password: 'correct horse' })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ role: 'risk_engineer' })
    expect(res.headers['set-cookie']?.[0]).toMatch(/^session=/)
  })

  it('rejects an incorrect password', async () => {
    await seedUser()
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jide.okafor@example.com', password: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('rejects an unknown email with the same generic error', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'whatever' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Incorrect email or password.')
  })
})

describe('POST /api/auth/login lockout (AC7)', () => {
  it('locks out after 5 failed attempts, even with the correct password', async () => {
    await seedUser({ email: 'lockout@example.com' })
    const attempt = (password: string) =>
      request(app).post('/api/auth/login').send({ email: 'lockout@example.com', password })
    for (let i = 0; i < 5; i++) {
      expect((await attempt('wrong')).status).toBe(401)
    }
    const res = await attempt('correct horse')
    expect(res.status).toBe(429)
  })
})

describe('POST /api/auth/login for a deactivated account', () => {
  it('refuses it with the same generic error', async () => {
    await seedUser({ active: false })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jide.okafor@example.com', password: 'correct horse' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Incorrect email or password.')
    expect(res.headers['set-cookie']).toBeUndefined()
  })
})

describe('Sliding session expiry (F-07)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stays valid past the original TTL as long as there is activity', async () => {
    await seedUser({ email: 'sliding@example.com' })
    const agent = request.agent(app)
    vi.useFakeTimers({ toFake: ['Date'] })
    await agent
      .post('/api/auth/login')
      .send({ email: 'sliding@example.com', password: 'correct horse' })

    vi.advanceTimersByTime(14 * 60 * 1000) // just before the 15-min TTL
    expect((await agent.get('/api/auth/me')).status).toBe(200)

    vi.advanceTimersByTime(10 * 60 * 1000) // 24 min since login, 10 since the last request
    expect((await agent.get('/api/auth/me')).status).toBe(200)
  })

  it('expires after 15 minutes with no activity', async () => {
    await seedUser({ email: 'idle@example.com' })
    const agent = request.agent(app)
    vi.useFakeTimers({ toFake: ['Date'] })
    await agent
      .post('/api/auth/login')
      .send({ email: 'idle@example.com', password: 'correct horse' })

    vi.advanceTimersByTime(16 * 60 * 1000)
    expect((await agent.get('/api/auth/me')).status).toBe(401)
  })
})

describe('POST /api/auth/logout (F-07 AC4)', () => {
  it('invalidates the session, not just the browser cookie', async () => {
    await seedUser({ email: 'logout@example.com' })
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'logout@example.com', password: 'correct horse' })
    const cookie = loginRes.headers['set-cookie']![0].split(';')[0]

    expect((await request(app).get('/api/auth/me').set('Cookie', cookie)).status).toBe(200)

    await request(app).post('/api/auth/logout').set('Cookie', cookie)

    // Re-send the exact same old cookie, as a copied/stolen one would — the
    // server must reject it, not rely on the browser having dropped it.
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie)
    expect(res.status).toBe(401)
  })
})

describe('GET /api/auth/me', () => {
  it('401s without a session cookie', async () => {
    const res = await request(app).get('/api/auth/me')
    expect(res.status).toBe(401)
  })

  it('returns the signed-in user via signedInAs()', async () => {
    const user = await seedUser()
    const agent = signedInAs(app, user)
    const res = await agent.get('/api/auth/me')
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ role: 'risk_engineer', name: 'Jide Okafor' })
  })
})

// Captures the token the same way a real reset is read: off the console log
// line, not an internal export — proves the thing you'll actually demo.
async function requestResetAndCaptureToken(email: string) {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  await request(app).post('/api/auth/request-reset').send({ email })
  const line = spy.mock.calls
    .map((call) => String(call[0]))
    .find((l) => l.includes('[password reset]'))
  spy.mockRestore()
  return line?.match(/token: ([a-f0-9]+)/)?.[1]
}

describe('POST /api/auth/request-reset (F-06 AC6)', () => {
  afterEach(() => vi.useRealTimers())

  it('responds identically whether or not the email is registered', async () => {
    await seedUser({ email: 'reset@example.com' })
    const known = await request(app)
      .post('/api/auth/request-reset')
      .send({ email: 'reset@example.com' })
    const unknown = await request(app)
      .post('/api/auth/request-reset')
      .send({ email: 'nobody@example.com' })
    expect(known.status).toBe(unknown.status)
    expect(known.body).toEqual(unknown.body)
  })

  it('only actually logs/sends a token for a registered email', async () => {
    await seedUser({ email: 'reset2@example.com' })
    expect(await requestResetAndCaptureToken('reset2@example.com')).toBeTruthy()
    expect(await requestResetAndCaptureToken('nobody2@example.com')).toBeUndefined()
  })
})

describe('POST /api/auth/reset (F-06)', () => {
  afterEach(() => vi.useRealTimers())

  it('changes the password; old password fails, new one works', async () => {
    await seedUser({ email: 'reset3@example.com' })
    const token = await requestResetAndCaptureToken('reset3@example.com')

    const resetRes = await request(app)
      .post('/api/auth/reset')
      .send({ token, password: 'a whole new password' })
    expect(resetRes.status).toBe(200)

    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset3@example.com', password: 'correct horse' })
    expect(oldLogin.status).toBe(401)

    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reset3@example.com', password: 'a whole new password' })
    expect(newLogin.status).toBe(200)
  })

  it('rejects an unknown or already-used token', async () => {
    const res = await request(app)
      .post('/api/auth/reset')
      .send({ token: 'not-a-real-token', password: 'whatever12345' })
    expect(res.status).toBe(400)
  })

  it('rejects a token twice (single-use)', async () => {
    await seedUser({ email: 'reset4@example.com' })
    const token = await requestResetAndCaptureToken('reset4@example.com')

    const first = await request(app)
      .post('/api/auth/reset')
      .send({ token, password: 'first new password' })
    expect(first.status).toBe(200)

    const second = await request(app)
      .post('/api/auth/reset')
      .send({ token, password: 'second new password' })
    expect(second.status).toBe(400)
  })

  it('rejects an expired token', async () => {
    await seedUser({ email: 'reset5@example.com' })
    vi.useFakeTimers({ toFake: ['Date'] })
    const token = await requestResetAndCaptureToken('reset5@example.com')

    vi.advanceTimersByTime(31 * 60 * 1000) // past the 30-minute expiry
    const res = await request(app).post('/api/auth/reset').send({ token, password: 'too late now' })
    expect(res.status).toBe(400)
  })
})

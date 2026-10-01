import bcrypt from 'bcrypt'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
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

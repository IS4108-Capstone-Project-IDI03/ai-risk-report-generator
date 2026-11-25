// New-site form: GET /api/sites/address turns a pin's coordinates into an address (one way only).
// The Google call is mocked; no real request is made.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { config } from '../config'
import { UserModel } from '../models/user.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const alex = {
  staffId: 'TEST-1',
  name: 'Alex Rowe',
  email: 'test-1@example.com',
  role: 'risk_engineer' as const,
  active: true,
}
const api = signedInAs(app, alex as never)
const google = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body)))

beforeEach(async () => {
  await UserModel.create(alex)
  config.weather.key = 'test-key'
})
afterEach(() => {
  vi.unstubAllGlobals()
  config.weather.key = undefined
})

describe('GET /api/sites/address', () => {
  it('returns the address nearest the point', async () => {
    const fetchMock = google({
      status: 'OK',
      results: [{ formatted_address: '21 Lower Kent Ridge Rd, Singapore' }],
    })
    vi.stubGlobal('fetch', fetchMock)
    const res = await api.get('/api/sites/address?lat=1.2966&lng=103.852')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ address: '21 Lower Kent Ridge Rd, Singapore' })
  })

  it('returns address null when Google has none', async () => {
    vi.stubGlobal('fetch', google({ status: 'ZERO_RESULTS', results: [] }))
    const res = await api.get('/api/sites/address?lat=0&lng=0')
    expect(res.body).toEqual({ address: null })
  })

  it('refuses a bad point with 400', async () => {
    expect((await api.get('/api/sites/address?lat=abc&lng=1')).status).toBe(400)
    expect((await api.get('/api/sites/address?lat=91&lng=1')).status).toBe(400)
  })

  it('answers 503 with no server key', async () => {
    config.weather.key = undefined
    expect((await api.get('/api/sites/address?lat=1&lng=1')).status).toBe(503)
  })

  it('answers 503 when Google cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    )
    expect((await api.get('/api/sites/address?lat=1&lng=1')).status).toBe(503)
  })
})

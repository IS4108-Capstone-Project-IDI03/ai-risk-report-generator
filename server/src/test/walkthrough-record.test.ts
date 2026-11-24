// F-12 test seam 1: the walkthrough record saves with personal settings, returns with the
// signed-in user, and clears. Calls PATCH /api/settings/me, GET /api/auth/me and
// POST /api/auth/login through supertest on an in-memory Mongo.
import bcrypt from 'bcrypt'
import { Types } from 'mongoose'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { UserModel } from '../models/user.model'
import { UserSettingsModel } from '../models/user-settings.model'
import { signedInAs } from './auth-test-helpers'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const person = (name: string, email: string) => ({
  _id: new Types.ObjectId(),
  staffId: `MRE-${Math.floor(1000 + Math.random() * 8999)}`,
  name,
  email,
  role: 'risk_engineer' as const,
  active: true,
})
const alex = person('Alex Tan', 'alex@example.com')
const sam = person('Sam Lee', 'sam@example.com')
const asAlex = signedInAs(app, alex as never)
const asSam = signedInAs(app, sam as never)

const save = (walkthroughs: unknown, who = asAlex) =>
  who.patch('/api/settings/me').send({ walkthroughs })
const record = async (who = asAlex) => (await who.get('/api/auth/me')).body.walkthroughs
const stored = async (user = alex) =>
  (await UserSettingsModel.findOne({ user: String(user._id) }).lean())?.walkthroughs

// The practice assessment is made on first sign-in from rag-service's section list; this is
// the only outside call allowed.
const TEMPLATE = ['4', '5', '6', '7', '8', '9', '10', '11', '12'].map((id) => ({
  id,
  title: `Title ${id}`,
  cope_dimensions: ['Construction'],
  min_observations: 1,
}))
beforeEach(async () => {
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/sections') && !init?.body)
      return new Response(JSON.stringify({ sections: TEMPLATE }), {
        headers: { 'Content-Type': 'application/json' },
      })
    throw new Error(`No outside call expected: ${url}`)
  })
  await UserModel.create([alex, sam])
})
afterEach(() => vi.unstubAllGlobals())

describe('reading the record', () => {
  it('gives a new account the defaults and its practice assessment', async () => {
    const r = await record()
    expect(r).toMatchObject({ welcomeAt: null, offers: true, seen: {}, otherWay: [], counts: {} })
    expect(r.practice).toMatch(/^PRACTICE-\d{4}$/)
  })

  it('shows one account its own record only', async () => {
    await save({ welcome: true, seen: { welcome: 'played' }, count: 'manual-observation' })
    const other = await record(asSam)
    expect(other).toMatchObject({ welcomeAt: null, seen: {}, counts: {} })
    expect(other.practice).not.toBe((await record()).practice)
  })

  it('returns the same record from another device (a second session)', async () => {
    await save({ welcome: true, offers: false, seen: { clients: 'skipped' } })
    const secondSession = signedInAs(app, alex as never)
    expect(await record(secondSession)).toEqual(await record())
  })

  it('comes back from sign-in too, and sign-in does not fail without a saved record', async () => {
    await UserModel.updateOne(
      { _id: alex._id },
      { passwordHash: await bcrypt.hash('Correct-horse-9', 4) },
    )
    await save({ welcome: true })
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: alex.email, password: 'Correct-horse-9' })
    expect(res.status).toBe(200)
    expect(res.body.walkthroughs.welcomeAt).toEqual(expect.any(String))
    expect(res.body.walkthroughs.practice).toMatch(/^PRACTICE-/)
  })

  it('gives the defaults with no practice, and still answers, when the record cannot be read', async () => {
    const find = vi.spyOn(UserSettingsModel, 'findOne').mockImplementation(() => {
      throw new Error('database down')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await asAlex.get('/api/auth/me')
    find.mockRestore()
    log.mockRestore()
    expect(res.status).toBe(200)
    expect(res.body.walkthroughs).toEqual({
      welcomeAt: null,
      offers: true,
      seen: {},
      otherWay: [],
      counts: {},
      practice: null,
    })
  })
})

describe('saving with PATCH /api/settings/me', () => {
  it('welcome stamps the time', async () => {
    const res = await save({ welcome: true })
    expect(res.status).toBe(200)
    expect(res.body.canEditGlobal).toBeDefined()
    expect(Date.parse((await record()).welcomeAt)).toBeGreaterThan(Date.now() - 5000)
  })

  it('offers switches the offers off and on', async () => {
    await save({ offers: false })
    expect((await record()).offers).toBe(false)
    await save({ offers: true })
    expect((await record()).offers).toBe(true)
  })

  it('seen merges per id, stamps each with the time and keeps earlier ids', async () => {
    await save({ seen: { clients: 'played' } })
    await save({ seen: { 'new-docs': 'declined', settings: 'skipped' } })
    await save({ seen: { clients: 'skipped' } })
    const seen = (await record()).seen
    expect(Object.keys(seen).sort()).toEqual(['clients', 'new-docs', 'settings'])
    expect(seen.clients.state).toBe('skipped')
    expect(seen['new-docs'].state).toBe('declined')
    expect(Date.parse(seen.settings.at)).toBeGreaterThan(Date.now() - 5000)
  })

  it('otherWay adds to a set (no repeats)', async () => {
    await save({ otherWay: ['a-b', 'c'] })
    await save({ otherWay: ['c', 'd'] })
    expect((await record()).otherWay).toEqual(['a-b', 'c', 'd'])
  })

  it('count adds 1 to one tally', async () => {
    await save({ count: 'manual-observation' })
    await save({ count: 'manual-observation' })
    await save({ count: 'other' })
    expect((await record()).counts).toEqual({ 'manual-observation': 2, other: 1 })
  })

  it('takes several walkthrough keys together, and refuses the removed note codes and glossary (CP-36)', async () => {
    const res = await asAlex.patch('/api/settings/me').send({
      walkthroughs: { welcome: true, offers: false },
    })
    expect(res.status).toBe(200)
    expect((await record()).welcomeAt).not.toBeNull()
    expect((await record()).offers).toBe(false)
    const gone = await asAlex.patch('/api/settings/me').send({ glossary: [], noteCodes: null })
    expect(gone.status).toBe(400)
  })

  it('clear empties the four fields and keeps offers and the practice assessment', async () => {
    const practice = (await record()).practice
    await save({
      welcome: true,
      offers: false,
      seen: { clients: 'played' },
      otherWay: ['x'],
      count: 'k',
    })
    await save({ clear: true })
    expect(await record()).toEqual({
      welcomeAt: null,
      offers: false,
      seen: {},
      otherWay: [],
      counts: {},
      practice,
    })
  })

  it('never drops practiceRemoved (the practice service keeps it in the same place)', async () => {
    await asAlex.delete('/api/walkthroughs/practice')
    await save({ seen: { clients: 'played' } })
    await save({ clear: true })
    await save({ welcome: true })
    expect(await stored()).toMatchObject({ practiceRemoved: true })
    expect((await record()).practice).toBeNull()
  })

  it('refuses a bad value with 400 and saves nothing', async () => {
    const bad: unknown[] = [
      { seen: { 'Bad Id': 'played' } },
      { seen: { clients: 'maybe' } },
      { seen: ['clients'] },
      { otherWay: ['UPPER'] },
      { otherWay: 'x' },
      { count: 'has space' },
      { count: 1 },
      { offers: 'yes' },
      { welcome: false },
      { clear: 1 },
      { unknown: true },
      { seen: { ok: 'played' }, extra: 1 },
      {},
      null,
      { otherWay: Array.from({ length: 101 }, (_, i) => `id-${i}`) },
      { seen: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`id-${i}`, 'played'])) },
      { offers: false, seen: { fine: 'played' }, count: 'Bad' },
    ]
    for (const walkthroughs of bad) {
      const res = await save(walkthroughs)
      expect(res.status, JSON.stringify(walkthroughs)).toBe(400)
    }
    expect(await stored()).toBeUndefined()
  })

  it('saves none of the personal settings when the walkthrough part is bad', async () => {
    const res = await asAlex.patch('/api/settings/me').send({
      glossary: [{ term: 'TIV', meaning: 'total insured value' }],
      walkthroughs: { unknown: 1 },
    })
    expect(res.status).toBe(400)
    expect(await UserSettingsModel.countDocuments()).toBe(0)
  })

  it('still refuses an unknown top-level key', async () => {
    expect((await asAlex.patch('/api/settings/me').send({ other: 1 })).status).toBe(400)
  })
})

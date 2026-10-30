import { Types } from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config, piiProtectionFrom } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { chatKnownEntities, chatPrivacy, knownEntities } from '../services/privacy.service'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// chatKnownEntities keeps what it read for a minute. Only Date is faked, so Mongo's
// own timers still run, and each test starts an hour past the last one's cache.
let now = Date.now()
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime((now += 60 * 60_000))
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function user(name: string, active: boolean) {
  return {
    _id: new Types.ObjectId(),
    staffId: `TEST-${name}`,
    name,
    email: `${name.split(' ')[0].toLowerCase()}@example.com`,
    role: 'risk_engineer' as const,
    active,
  }
}

const SITE = {
  code: 'SITE-0001',
  name: 'Jurong Distribution Hub',
  address: '2 Jurong Port Road',
  jurisdiction: 'SG',
  facilityType: 'Distribution warehouse',
}

describe('knownEntities', () => {
  beforeEach(async () => {
    await UserModel.create([user('Alex Rowe', true), user('Jide Okafor', false)])
  })

  it('returns the client, site, address and active users of an assessment', async () => {
    const client = await ClientModel.create({
      name: 'Jurong Port Pte Ltd',
      key: 'jurong port pte ltd',
    })
    const site = await SiteModel.create({ ...SITE, client: client._id })
    await AssessmentModel.create({ reference: 'RPT-2026-0001', site: site._id, surveyType: 'PRE' })

    expect(await knownEntities('RPT-2026-0001')).toEqual([
      { type: 'CLIENT', names: ['Jurong Port Pte Ltd'] },
      { type: 'SITE', names: ['Jurong Distribution Hub', 'SITE-0001'] },
      { type: 'ADDRESS', names: ['2 Jurong Port Road'] },
      { type: 'PERSON', names: ['Alex Rowe'] },
    ])
  })

  it('falls back to the client name typed before CP-17 when the site has no client', async () => {
    const site = await SiteModel.create(SITE)
    await AssessmentModel.create({
      reference: 'RPT-2026-0002',
      site: site._id,
      surveyType: 'PRE',
      client: 'Jurong Port',
    })

    expect((await knownEntities('RPT-2026-0002'))[0]).toEqual({
      type: 'CLIENT',
      names: ['Jurong Port'],
    })
  })
})

describe('chatKnownEntities', () => {
  it('is read once a minute, not on every chat message', async () => {
    await ClientModel.create({ name: 'Mapletree', key: 'mapletree' })
    await chatKnownEntities()
    await ClientModel.create({ name: 'Keppel', key: 'keppel' })

    vi.setSystemTime(now + 59_000)
    expect(await chatKnownEntities()).not.toContainEqual({ type: 'CLIENT', names: ['Keppel'] })

    vi.setSystemTime(now + 61_000)
    expect(await chatKnownEntities()).toContainEqual({ type: 'CLIENT', names: ['Keppel'] })
  })

  it('reads again on the next message after a failed read, instead of failing for a minute', async () => {
    await ClientModel.create({ name: 'Mapletree', key: 'mapletree' })
    vi.spyOn(ClientModel, 'find').mockReturnValueOnce({
      lean: () => Promise.reject(new Error('Mongo is down')),
    } as never)

    await expect(chatKnownEntities()).rejects.toThrow('Mongo is down')

    expect(await chatKnownEntities()).toContainEqual({ type: 'CLIENT', names: ['Mapletree'] })
  })

  it('returns every client, site, address and active user, since chat has no assessment', async () => {
    await UserModel.create([user('Alex Rowe', true), user('Jide Okafor', false)])
    const port = await ClientModel.create({
      name: 'Jurong Port Pte Ltd',
      key: 'jurong port pte ltd',
    })
    await ClientModel.create({ name: 'Mapletree', key: 'mapletree' })
    const hub = await SiteModel.create({ ...SITE, client: port._id })
    await SiteModel.create({
      ...SITE,
      code: 'SITE-0002',
      name: 'Tuas Cold Store',
      address: undefined,
    })
    await AssessmentModel.create({
      reference: 'RPT-2026-0003',
      site: hub._id,
      surveyType: 'PRE',
      client: 'Jurong Port',
    })

    const entities = await chatKnownEntities()

    expect(entities).toHaveLength(7)
    expect(entities).toEqual(
      expect.arrayContaining([
        { type: 'CLIENT', names: ['Jurong Port Pte Ltd'] },
        { type: 'CLIENT', names: ['Mapletree'] },
        // An assessment from before CP-17 holds the client's name as typed.
        { type: 'CLIENT', names: ['Jurong Port'] },
        { type: 'SITE', names: ['Jurong Distribution Hub', 'SITE-0001'] },
        { type: 'SITE', names: ['Tuas Cold Store', 'SITE-0002'] },
        { type: 'ADDRESS', names: ['2 Jurong Port Road'] },
        { type: 'PERSON', names: ['Alex Rowe'] },
      ]),
    )
  })
})

describe('chatPrivacy', () => {
  afterEach(() => {
    config.piiProtection = 'off'
  })

  it('sends no names when protection is off', async () => {
    await UserModel.create(user('Alex Rowe', true))
    config.piiProtection = 'off'

    expect(await chatPrivacy()).toEqual({ enabled: false, known_entities: [] })
  })

  it("sends every known name when protection is required, since chat isn't one assessment's", async () => {
    await UserModel.create(user('Mei Lin', true))
    config.piiProtection = 'required'

    expect(await chatPrivacy()).toEqual({
      enabled: true,
      known_entities: expect.arrayContaining([{ type: 'PERSON', names: ['Mei Lin'] }]),
    })
  })
})

describe('piiProtectionFrom', () => {
  it('is off unless PII_PROTECTION says required', () => {
    expect(piiProtectionFrom(undefined)).toBe('off')
    expect(piiProtectionFrom('off')).toBe('off')
    expect(piiProtectionFrom('required')).toBe('required')
  })

  it('refuses any other value, so a typo never silently leaves protection off', () => {
    expect(() => piiProtectionFrom('requried')).toThrow('PII_PROTECTION')
  })
})

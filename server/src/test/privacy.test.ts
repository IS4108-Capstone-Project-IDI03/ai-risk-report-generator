import { Types } from 'mongoose'
import { beforeEach, describe, expect, it } from 'vitest'
import { piiProtectionFrom } from '../config'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { knownEntities } from '../services/privacy.service'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

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

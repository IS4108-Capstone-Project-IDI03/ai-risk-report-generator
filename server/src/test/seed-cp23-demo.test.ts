import { expect, it, vi } from 'vitest'
import { AssessmentModel } from '../models/assessment.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { clientKey } from '../services/client.service'
import { add, assertLocalTarget, remove } from '../scripts/seed-cp23-demo'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// No real S3: the seed's files go to a map.
const s3 = vi.hoisted(() => new Map<string, Buffer>())
vi.mock('../services/storage.service', () => ({
  putObject: async (key: string, body: Buffer) => void s3.set(key, body),
  deleteObject: async (key: string) => void s3.delete(key),
}))

// The CP-23 demo seed adds once however often it runs, and removes only its own rows.
it('adds idempotently and removes only what it added', async () => {
  await UserModel.create([
    { staffId: 'MRE-0001', name: 'Alex Rowe', email: 'a@example.com', role: 'risk_engineer' },
    { staffId: 'MRE-0002', name: 'Jide Okafor', email: 'j@example.com', role: 'risk_engineer' },
  ])
  await SiteModel.create({
    code: 'REAL-1',
    name: 'Real',
    jurisdiction: 'SG',
    facilityType: 'Office',
  })
  await add()
  const counts = async () => [
    await ClientModel.countDocuments(),
    await SiteModel.countDocuments(),
    await AssessmentModel.countDocuments(),
    await ClientDocumentModel.countDocuments(),
  ]
  const first = await counts()
  await add()
  expect(await counts()).toEqual(first)
  expect(first[0]).toBe(9)
  expect(s3.size).toBe(first[3])
  await remove()
  expect(await counts()).toEqual([0, 1, 0, 0])
  expect(s3.size).toBe(0)
}, 60_000)

// A first run on a clashing real client aborts before writing anything.
it('refuses a clashing real client before any write', async () => {
  await UserModel.create([
    { staffId: 'MRE-0001', name: 'Alex Rowe', email: 'a@example.com', role: 'risk_engineer' },
    { staffId: 'MRE-0002', name: 'Jide Okafor', email: 'j@example.com', role: 'risk_engineer' },
  ])
  await ClientModel.create({ name: 'Kampung Retail Group', key: clientKey('Kampung Retail Group') })
  await expect(add()).rejects.toThrow(
    'Client Kampung Retail Group already exists; rename it in the seed or remove it',
  )
  expect(await ClientModel.countDocuments()).toBe(1)
  expect(await SiteModel.countDocuments()).toBe(0)
  expect(s3.size).toBe(0)
})

it('uses the app values: UK, and a First survey first at each site', async () => {
  await UserModel.create([
    { staffId: 'MRE-0001', name: 'Alex Rowe', email: 'a@example.com', role: 'risk_engineer' },
    { staffId: 'MRE-0002', name: 'Jide Okafor', email: 'j@example.com', role: 'risk_engineer' },
  ])
  await add()
  expect(await SiteModel.countDocuments({ jurisdiction: 'GB' })).toBe(0)
  expect(await SiteModel.countDocuments({ jurisdiction: 'UK' })).toBeGreaterThan(0)
  const types = await AssessmentModel.distinct('surveyType')
  expect(types.every((t) => ['First survey', 'Resurvey', 'Follow-up visit'].includes(t))).toBe(true)
  for (const site of await SiteModel.find().lean()) {
    const first = await AssessmentModel.find({ site: site._id }).sort({ reference: 1 }).lean()
    expect(first[0].surveyType).toBe('First survey')
  }
})

it('only runs on the local riskreport database', () => {
  expect(() => assertLocalTarget('riskreport', 'localhost')).not.toThrow()
  expect(() => assertLocalTarget('riskreport', 'cluster0.mongodb.net')).toThrow()
  expect(() => assertLocalTarget('prod', 'localhost')).toThrow()
})

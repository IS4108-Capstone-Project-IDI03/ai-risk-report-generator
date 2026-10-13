import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { AssessmentModel } from '../models/assessment.model'
import { ClientModel } from '../models/client.model'
import { SiteModel } from '../models/site.model'
import { migrateClients } from '../scripts/migrate-clients'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// A site and its one assessment, as saved before CP-17: the client is only
// the name typed on the assessment.
async function savedBefore(code: string, siteName: string, client: string) {
  const site = await SiteModel.create({
    code,
    name: siteName,
    jurisdiction: 'SG',
    facilityType: 'Warehouse',
  })
  await AssessmentModel.create({
    reference: `RPT-2026-${code.slice(-4)}`,
    site: site._id,
    client,
    surveyType: 'Property risk survey',
    engineer: new Types.ObjectId(),
  })
  return site
}

describe('migrating client names to clients (CP-17)', () => {
  it('makes one client per name ignoring case and spacing, never merging sites, and changes nothing run again', async () => {
    const dublin = await savedBefore('SITE-0001', 'Dublin Warehouse 4', 'Northgate Logistics')
    const tilbury = await savedBefore('SITE-0002', 'Tilbury', 'northgate  logistics ')
    const again = await savedBefore('SITE-0003', 'Tilbury', 'Northgate Logistics')
    const leeds = await savedBefore('SITE-0004', 'Leeds Cold Store', 'Fennick Foods')
    // A near-miss stays its own client: the script doesn't guess.
    const typo = await savedBefore('SITE-0005', 'Leeds Cold Store', 'Fennick Food')
    // The health check's test record has no assessment to name a client.
    const orphan = await SiteModel.create({
      code: 'SYN-SG-001',
      name: 'Synthetic Singapore Warehouse',
      jurisdiction: 'SG',
      facilityType: 'Warehouse',
    })

    expect(await migrateClients()).toEqual({ clients: 3, sites: 5, unlinked: 1 })

    const clients = await ClientModel.find().sort({ _id: 1 }).lean()
    // Spelt as on the first assessment found.
    expect(clients.map((c) => c.name)).toEqual([
      'Northgate Logistics',
      'Fennick Foods',
      'Fennick Food',
    ])
    const clientOf = async (siteId: Types.ObjectId) => {
      const site = await SiteModel.findById(siteId).lean()
      return clients.find((c) => c._id.equals(site?.client))?.name
    }
    expect(await clientOf(dublin._id)).toBe('Northgate Logistics')
    expect(await clientOf(tilbury._id)).toBe('Northgate Logistics')
    expect(await clientOf(leeds._id)).toBe('Fennick Foods')
    expect(await clientOf(typo._id)).toBe('Fennick Food')
    // Two sites of one name stay two.
    expect(await clientOf(again._id)).toBe('Northgate Logistics')
    expect(await SiteModel.countDocuments({ name: 'Tilbury' })).toBe(2)
    expect((await SiteModel.findById(orphan._id).lean())?.client).toBeUndefined()
    // The typed name stays on the assessment.
    const kept = await AssessmentModel.findOne({ site: tilbury._id }).lean()
    expect(kept?.client).toBe('northgate  logistics')

    expect(await migrateClients()).toEqual({ clients: 0, sites: 0, unlinked: 1 })
  })

  it('links a site to a client already added since CP-17', async () => {
    const existing = await ClientModel.create({ name: 'Fennick Foods', key: 'fennick foods' })
    const leeds = await savedBefore('SITE-0001', 'Leeds Cold Store', 'FENNICK FOODS')

    expect(await migrateClients()).toEqual({ clients: 0, sites: 1, unlinked: 0 })
    expect((await SiteModel.findById(leeds._id).lean())?.client).toEqual(existing._id)
  })
})

import { Types } from 'mongoose'
import { describe, expect, it } from 'vitest'
import { ObservationModel } from '../models/observation.model'
import { ReportSectionModel } from '../models/report-section.model'
import { migrateCopeCategories } from '../scripts/migrate-cope-categories'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const metadata = (COPE_dimension: unknown) => ({
  source_type: 'observation',
  jurisdiction: 'SG',
  facility_type: 'Warehouse',
  COPE_dimension,
  effective_date: new Date(),
})

describe('migrating COPE categories to lists', () => {
  it('turns one category saved as a string into a list of one, leaving the rest', async () => {
    // Written raw, as observations and drafts were saved before several categories.
    const observations = ObservationModel.collection
    const { insertedIds } = await observations.insertMany([
      { severity: 'high', metadata: metadata('Protection') },
      { severity: 'high', metadata: metadata(['Construction', 'Exposure']) },
      { severity: 'high', metadata: metadata(null) },
    ])
    const evidence = (COPE_dimension: unknown) => ({
      id: String(new Types.ObjectId()),
      COPE_dimension,
    })
    await ReportSectionModel.collection.insertMany([
      { sectionId: '7', evidence: [evidence('Construction'), evidence(['Construction'])] },
      { sectionId: '9', evidence: [evidence(['Protection'])] },
    ])

    expect(await migrateCopeCategories()).toEqual({ observations: 1, drafts: 1 })

    const stored = await observations.find().sort({ _id: 1 }).toArray()
    expect(stored.map((o) => o.metadata.COPE_dimension)).toEqual([
      ['Protection'],
      ['Construction', 'Exposure'],
      null,
    ])
    expect(String(stored[0]._id)).toBe(String(insertedIds[0]))
    const drafts = await ReportSectionModel.collection.find().sort({ sectionId: 1 }).toArray()
    expect(
      drafts.map((d) => d.evidence.map((e: { COPE_dimension: unknown }) => e.COPE_dimension)),
    ).toEqual([[['Construction'], ['Construction']], [['Protection']]])
    // Each evidence entry keeps its other fields, in place.
    expect(Object.keys(drafts[0].evidence[0])).toEqual(['id', 'COPE_dimension'])

    // Running it again changes nothing.
    expect(await migrateCopeCategories()).toEqual({ observations: 0, drafts: 0 })
  })
})

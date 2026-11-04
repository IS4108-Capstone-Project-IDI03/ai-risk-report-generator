import { describe, expect, it } from 'vitest'
import { AssessmentModel } from '../models/assessment.model'
import { SiteModel } from '../models/site.model'
import { migrateVisitTypes } from '../scripts/migrate-visit-types'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

// CP-23: the assessment types saved before become the three visit types.
describe('migrating assessment types to visit types (CP-23)', () => {
  it("makes a site's first survey First survey and later ones Resurvey, and changes nothing run again", async () => {
    const site = await SiteModel.create({
      code: 'SITE-0001',
      name: 'Tuas',
      jurisdiction: 'SG',
      facilityType: 'Cold store',
    })
    const saved = (reference: string, surveyType: string, siteVisitDate?: string) =>
      AssessmentModel.create({
        reference,
        site: site._id,
        surveyType,
        siteVisitDate: siteVisitDate && new Date(siteVisitDate),
      })
    // Created out of visit order: the earliest visit is the first survey.
    await saved('RPT-2', 'Property risk survey', '2026-03-01')
    await saved('RPT-1', 'Property risk survey', '2025-03-01')
    await saved('RPT-3', 'Business interruption')
    await saved('RPT-4', 'Natural hazard review', '2026-06-01')
    await saved('RPT-5', 'Follow-up visit', '2026-07-01')

    expect(await migrateVisitTypes()).toEqual({ firstSurveys: 1, resurveys: 3 })

    const types = await AssessmentModel.find({}, 'reference surveyType')
      .sort({ reference: 1 })
      .lean()
    expect(types.map((a) => [a.reference, a.surveyType])).toEqual([
      ['RPT-1', 'First survey'],
      ['RPT-2', 'Resurvey'],
      ['RPT-3', 'Resurvey'],
      ['RPT-4', 'Resurvey'],
      ['RPT-5', 'Follow-up visit'],
    ])
    expect(await migrateVisitTypes()).toEqual({ firstSurveys: 0, resurveys: 0 })
  })
})

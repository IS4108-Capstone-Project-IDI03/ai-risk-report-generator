import 'dotenv/config'
import { existsSync, readFileSync } from 'fs'
import mongoose, { type Types } from 'mongoose'
import { resolve } from 'path'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { connectDb } from '../models/db'
import {
  copeDimensionsOf,
  ObservationModel,
  type CopeDimension,
  type Severity,
} from '../models/observation.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { ReportSectionVersionModel } from '../models/report-section-version.model'
import { SiteModel } from '../models/site.model'
import { findOrCreateClient } from '../services/client.service'
import { UserModel } from '../models/user.model'
import { locationKey } from '../services/location.service'
import type { LossInputs } from '../services/loss-estimate.service'
import { draftingEvidence, figureFacts } from '../services/section.service'

// An assessment built from one GN-01 eval case (rag-service eval/cases/*.json): the
// observations an engineer would have captured, written from a real Marsh report's
// section. Lets the case be drafted in the app and held next to the report it came
// from. Unlike the eval, the app does not keep that report out of retrieval, so a
// draft may echo it; the eval (judge_sections.py) is the fair comparison.
// Run `npm run seed` first for the accounts, then:
//   npm run seed:case -- office-5-s7-construction
// Re-running resets this assessment's observations, sessions and drafts.
//
// A case in seed-cases/ (beside this script) can also hold saved section drafts and
// accepted OFIs, e.g. office-5-full-report for testing the Executive Summary (GN-07),
// which needs Sections 3-12 complete. Those cases stay out of eval/cases, which
// judge_sections.py drafts and judges in full.
type Case = {
  name: string
  source: string
  assessment: {
    reference: string
    jurisdiction: string
    facility_type: string
  }
  observations: {
    id: string
    // One category as a string, or several as a list.
    COPE_dimension: CopeDimension | CopeDimension[]
    severity: Severity
    location: string
    note: string
  }[]
  // Sections 4 and 5's figures (GN-03), as the engineer would enter them in Review.
  figures?: {
    riskQuality: { category: string; current: number | null; potential: number | null }[]
    lossEstimates: LossInputs
  }
  // Citations name the case's observation ids, e.g. "off5-12".
  sections?: Record<
    string,
    {
      title: string
      subsections: {
        heading: string
        kind: 'narrative' | 'fields' | 'table'
        statements: { text: string; citations: string[] }[]
      }[]
    }
  >
  ofis?: {
    title: string
    category: string
    type: string
    description: string
    observation: string
    likelihood: string
    consequence: string
    effort: string
    observations: string[]
  }[]
}

const RAG = resolve(__dirname, '../../../microservices/rag-service')
// A case beside this script first, else an eval case.
function caseFile(name: string) {
  const own = resolve(__dirname, 'seed-cases', `${name}.json`)
  return existsSync(own) ? own : resolve(RAG, 'eval/cases', `${name}.json`)
}
// What a seeded draft says wrote it, so it is never taken for a model's.
const SEED_PROVENANCE = {
  provider: 'seed',
  model: 'seed-fixture',
  effort: 'none',
  generated_at: new Date(),
}

async function seed(name: string) {
  const c = JSON.parse(readFileSync(caseFile(name), 'utf8')) as Case
  await connectDb()
  const alex = await UserModel.findOne({ email: 'alex.rowe@example.com' }).lean()
  if (!alex) throw new Error('Run `npm run seed` first: the sample accounts are missing.')

  const reference = `RPT-${c.assessment.reference}`
  const site = await SiteModel.findOneAndUpdate(
    { code: `SITE-${c.assessment.reference}` },
    {
      $set: {
        name: `${c.source.split(',')[0].replace(/\.pdf$/, '')} (eval case)`,
        jurisdiction: c.assessment.jurisdiction,
        facilityType: c.assessment.facility_type,
        client: (await findOrCreateClient('Eval case client'))._id,
      },
    },
    { upsert: true, returnDocument: 'after' },
  )
  // One location per distinct place named in the case.
  const places = [...new Set(c.observations.map((o) => o.location))]
  const assessment = await AssessmentModel.findOneAndUpdate(
    { reference },
    {
      $set: {
        site: site._id,
        client: 'Eval case client',
        surveyType: 'Property risk survey',
        siteVisitDate: new Date('2026-09-28'),
        reportDueDate: new Date('2026-10-16'),
        engineer: alex._id,
        locations: places.map((p) => ({ name: p, key: locationKey(p) })),
      },
      $unset: { reportStatus: 1, archivedAt: 1, riskQuality: 1, lossEstimates: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )

  // Start this assessment afresh: its evidence, sessions, drafts and their review.
  await ObservationModel.deleteMany({ assessment: assessment._id })
  await CaptureSessionModel.deleteMany({ assessment: assessment._id })
  await ReportSectionModel.deleteMany({ assessment: assessment._id })
  // The review log is append-only through its model (RV-02); a reset sample's
  // drafts are gone, so their decisions go too, through the driver.
  await ReviewAuditModel.collection.deleteMany({ assessment: assessment._id })
  // So does what was written in the document editor (RV-08), also append-only.
  await ReportSectionVersionModel.collection.deleteMany({ assessment: assessment._id })
  await ReportOfiModel.deleteMany({ assessment: assessment._id })

  const session = await CaptureSessionModel.create({ assessment: assessment._id })
  // The case's observation id -> the saved observation's, for the drafts' citations.
  const saved = new Map<string, string>()
  for (const [i, o] of c.observations.entries()) {
    const created = await ObservationModel.create({
      assessment: assessment._id,
      session: session._id,
      engineer: alex.name,
      engineerId: alex._id,
      note: o.note,
      recordings: [],
      severity: o.severity,
      location: assessment.locations.find((l) => l.name === o.location)!._id,
      metadata: {
        source_type: 'observation',
        jurisdiction: site.jurisdiction,
        facility_type: site.facilityType,
        COPE_dimension: copeDimensionsOf(o.COPE_dimension),
        // A minute apart, in the case's order.
        effective_date: new Date(Date.UTC(2026, 8, 28, 9, i)),
      },
    })
    saved.set(o.id, String(created._id))
  }
  if (c.figures) {
    const now = new Date()
    Object.assign(assessment, {
      riskQuality: { categories: c.figures.riskQuality, updatedAt: now, updatedBy: alex._id },
      lossEstimates: { inputs: c.figures.lossEstimates, updatedAt: now, updatedBy: alex._id },
    })
    await AssessmentModel.updateOne(
      { _id: assessment._id },
      { $set: { riskQuality: assessment.riskQuality, lossEstimates: assessment.lossEstimates } },
    )
  }
  if (c.sections || c.ofis) await seedReport(c, assessment, site, saved, alex._id)
  console.log(
    `${reference} is ready with ${c.observations.length} observations from ${c.source}. ` +
      (c.sections
        ? `With saved drafts of Sections ${Object.keys(c.sections).join(', ')} and ${c.ofis?.length ?? 0} accepted OFI(s). `
        : '') +
      'Sign in as alex.rowe@example.com and open it > Generation.',
  )
}

// Saved drafts of the case's sections and its accepted OFIs, as if drafted and
// accepted in the app: each citation resolves, so none is flagged unsupported, and
// each section draft holds today's evidence, so none reads as out of date.
async function seedReport(
  c: Case,
  assessment: { _id: Types.ObjectId; reference: string } & Parameters<typeof figureFacts>[1],
  site: { jurisdiction: string; facilityType: string },
  saved: Map<string, string>,
  engineer: Types.ObjectId,
) {
  const sectionsJson = JSON.parse(
    readFileSync(resolve(RAG, 'app/generation/sections.json'), 'utf8'),
  )
  const ofiConfig = JSON.parse(readFileSync(resolve(RAG, 'app/generation/ofi.json'), 'utf8'))
  const evidence = await draftingEvidence(assessment.reference)
  const metadata = (cope: CopeDimension | 'all') => ({
    source_type: 'report_section' as const,
    jurisdiction: site.jurisdiction,
    facility_type: site.facilityType,
    COPE_dimension: cope,
    effective_date: new Date(),
  })
  const cite = (id: string) => {
    const real = saved.get(id)
    if (!real)
      throw new Error(`A seeded draft cites ${id}, which is not one of the case's observations.`)
    return real
  }

  for (const [sectionId, s] of Object.entries(c.sections ?? {})) {
    // Each section's categories, as the template has them.
    const cope: string[] = sectionsJson.sections[sectionId]?.cope_dimensions ?? []
    await ReportSectionModel.create({
      assessment: assessment._id,
      sectionId,
      title: s.title,
      subsections: s.subsections.map((sub) => ({
        ...sub,
        statements: sub.statements.map((st) => ({
          text: st.text,
          citations: st.citations.map((id) => `O:${cite(id)}`),
          supported: true,
        })),
      })),
      sources: {},
      questions: [],
      evidence,
      // Sections 4 and 5 (GN-03): the figures they were drafted from, so they read as current.
      facts: figureFacts(sectionId, assessment).facts,
      guardrail: { passed: true, unsupported_count: 0 },
      provenance: {
        ...SEED_PROVENANCE,
        prompt_version: 'seed',
        template_version: sectionsJson.version,
      },
      createdBy: engineer,
      metadata: metadata(cope.length === 1 ? (cope[0] as CopeDimension) : 'all'),
    })
  }
  for (const o of c.ofis ?? []) {
    await ReportOfiModel.create({
      ...o,
      assessment: assessment._id,
      state: 'accepted',
      acceptedAt: new Date(),
      acceptedBy: engineer,
      // From the Risk Assessment Matrix, as S4 sets it (GN-05 AC6).
      priority: ofiConfig.ram[o.likelihood][o.consequence],
      observations: o.observations.map(cite),
      standards: [],
      precedent: null,
      sources: {},
      provenance: {
        ...SEED_PROVENANCE,
        prompt_version: 'seed',
        config_version: ofiConfig.version,
      },
      createdBy: engineer,
      metadata: { ...metadata('all'), source_type: 'ofi', COPE_dimension: 'all' },
    })
  }
  await AssessmentModel.updateOne({ _id: assessment._id }, { $set: { reportStatus: 'draft' } })
}

const name = process.argv[2]
if (!name) {
  console.error('Name an eval case, e.g. npm run seed:case -- office-5-s7-construction')
  process.exitCode = 1
} else {
  seed(name)
    .catch((error) => {
      console.error('Eval case seeding failed:', error.message)
      process.exitCode = 1
    })
    .finally(async () => {
      await mongoose.disconnect()
    })
}

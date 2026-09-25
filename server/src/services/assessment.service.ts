import { z } from 'zod'
import { AssessmentModel, REPORT_STATUSES, type IAssessment } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { CounterModel } from '../models/counter.model'
import { SiteModel, type ISite } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'

const required = (label: string) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(200, `${label} must be 200 characters or fewer.`)
const optional = (label: string) =>
  z
    .string()
    .trim()
    .max(200, `${label} must be 200 characters or fewer.`)
    .optional()
    .transform((value) => value || undefined)
// Form date inputs send '' when left empty.
const optionalDate = (label: string) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.iso.date(`${label} must be a valid date (YYYY-MM-DD).`).optional(),
  )

// Request body for POST /api/assessments.
export const newAssessmentSchema = z
  .object({
    site: z.object(
      {
        name: required('Site name'),
        address: optional('Site address'),
        jurisdiction: z
          .string('Jurisdiction is required.')
          .regex(/^[A-Z]{2}$/, 'Jurisdiction must be a two-letter code, e.g. SG.'),
        facilityType: required('Facility type'),
      },
      'Site details are required.',
    ),
    client: required('Client'),
    policyReference: optional('Policy reference'),
    surveyType: required('Assessment type'),
    siteVisitDate: optionalDate('Site visit date'),
    reportDueDate: optionalDate('Report due date'),
    standards: z.array(required('Standard')).max(50).default([]),
    // The first engineer is the lead.
    engineers: z.array(required('Engineer')).max(20).default([]),
  })
  .refine((a) => !a.siteVisitDate || !a.reportDueDate || a.reportDueDate >= a.siteVisitDate, {
    message: 'The report due date must be on or after the site visit date.',
    path: ['reportDueDate'],
  })

export type NewAssessment = z.infer<typeof newAssessmentSchema>

// Where an assessment stands: the capture statuses are derived from its latest
// capture session, the report statuses are stored on the assessment.
export const ASSESSMENT_STATUSES = [
  'not_started',
  'capturing',
  'ready_to_generate',
  ...REPORT_STATUSES,
] as const
export type AssessmentStatus = (typeof ASSESSMENT_STATUSES)[number]

const CAPTURE_STATUS: Record<CaptureSessionStatus, AssessmentStatus> = {
  active: 'capturing',
  ready_for_generation: 'ready_to_generate',
}

export type AssessmentDto = {
  id: string
  reference: string
  client: string
  policyReference: string | null
  surveyType: string
  siteVisitDate: string | null
  reportDueDate: string | null
  standards: string[]
  engineers: string[]
  status: AssessmentStatus
  createdAt: Date
  site: {
    code: string
    name: string
    address: string | null
    jurisdiction: string
    facilityType: string
  }
}

// Creates the site and the assessment, allocating the site code and the
// report reference (RPT-<year>-<nnnn>) on the server.
export async function createAssessment(input: NewAssessment): Promise<AssessmentDto> {
  const year = new Date().getUTCFullYear()
  const site = await insertWithNextCode(
    'site',
    (n) => `SITE-${pad(n)}`,
    (code) => SiteModel.create({ code, ...input.site }),
  )
  try {
    const assessment = await insertWithNextCode(
      `assessment:${year}`,
      (n) => `RPT-${year}-${pad(n)}`,
      (reference) =>
        AssessmentModel.create({
          reference,
          site: site._id,
          client: input.client,
          policyReference: input.policyReference,
          surveyType: input.surveyType,
          // 'YYYY-MM-DD' parses as UTC midnight, so the calendar day is kept.
          siteVisitDate: input.siteVisitDate ? new Date(input.siteVisitDate) : undefined,
          reportDueDate: input.reportDueDate ? new Date(input.reportDueDate) : undefined,
          standards: input.standards,
          engineers: input.engineers,
        }),
    )
    return toDto(assessment, site)
  } catch (error: unknown) {
    // No transaction (dev and test MongoDB are standalone servers), so remove
    // the site by hand rather than leave it without an assessment.
    await SiteModel.deleteOne({ _id: site._id }).catch((cleanupError: unknown) => {
      console.error(`Could not remove site ${site.code} after a failed create:`, cleanupError)
    })
    throw error
  }
}

// Every assessment, most recent site visit first. Two queries regardless of
// list size: the assessments, then all their capture sessions.
// ponytail: loads the whole collection; paginate and index engineers /
// reportStatus once the list outgrows one response.
export async function listAssessments(): Promise<AssessmentDto[]> {
  const assessments = await AssessmentModel.find()
    .sort({ siteVisitDate: -1, createdAt: -1 })
    .populate<{ site: ISite }>('site')
    .lean()
  const sessions = await CaptureSessionModel.find({
    assessment: { $in: assessments.map((a) => a._id) },
  })
    .sort({ createdAt: 1 })
    .lean()
  // Later sessions overwrite earlier ones, so each assessment keeps its latest.
  const latest = new Map(sessions.map((s) => [String(s.assessment), s.status]))
  return assessments.map((a) => {
    const session = latest.get(String(a._id))
    const status = a.reportStatus ?? (session ? CAPTURE_STATUS[session] : 'not_started')
    return toDto(a, a.site, status)
  })
}

// Takes the next number in a sequence and inserts with the code built from
// it. A code already in use (e.g. a seeded record) is skipped.
async function insertWithNextCode<T>(
  sequence: string,
  format: (n: number) => string,
  insert: (code: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const code = format(await nextInSequence(sequence))
    try {
      return await insert(code)
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) throw error
    }
  }
  throw new Error(`No unused code found in sequence ${sequence}.`)
}

async function nextInSequence(sequence: string): Promise<number> {
  const counter = await CounterModel.findOneAndUpdate(
    { _id: sequence },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  ).lean()
  if (!counter) throw new Error(`Sequence ${sequence} could not be incremented.`)
  return counter.seq
}

function pad(n: number) {
  return String(n).padStart(4, '0')
}

function isoDay(date?: Date) {
  return date ? date.toISOString().slice(0, 10) : null
}

function toDto(
  assessment: Omit<IAssessment, 'site'> & { _id: unknown },
  site: ISite,
  status: AssessmentStatus = 'not_started',
): AssessmentDto {
  return {
    id: String(assessment._id),
    reference: assessment.reference,
    client: assessment.client,
    policyReference: assessment.policyReference ?? null,
    surveyType: assessment.surveyType,
    siteVisitDate: isoDay(assessment.siteVisitDate),
    reportDueDate: isoDay(assessment.reportDueDate),
    standards: [...assessment.standards],
    engineers: [...assessment.engineers],
    status,
    createdAt: assessment.createdAt,
    site: {
      code: site.code,
      name: site.name,
      address: site.address ?? null,
      jurisdiction: site.jurisdiction,
      facilityType: site.facilityType,
    },
  }
}

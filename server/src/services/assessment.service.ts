import { z } from 'zod'
import { isValidObjectId } from 'mongoose'
import { UserModel } from '../models/user.model'
import type { SessionUser } from './auth.service'
import { AssessmentModel, REPORT_STATUSES, type IAssessment } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { CounterModel } from '../models/counter.model'
import { SiteModel, type ISite } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'

export class InvalidEngineersError extends Error {
  constructor() {
    super('Choose an active risk engineer from the list.')
  }
}

// Minimal directory for assignment; account administration remains admin-only.
export async function listAssignableEngineers() {
  const users = await UserModel.find({ role: 'risk_engineer', active: true })
    .select('name staffId jobTitle')
    .sort({ name: 1 })
    .lean()
  return users.map((u) => ({
    id: String(u._id),
    name: u.name,
    staffId: u.staffId,
    jobTitle: u.jobTitle ?? null,
  }))
}

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
    engineerId: z
      .string('Choose the engineer for this assessment.')
      .refine(isValidObjectId, 'Choose the engineer for this assessment.'),
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
  'archived',
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
  engineer: { id: string; name: string } | null
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
  const engineer = await UserModel.findOne({
    _id: input.engineerId,
    role: 'risk_engineer',
    active: true,
  }).lean()
  if (!engineer) throw new InvalidEngineersError()
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
          engineer: engineer._id,
        }),
    )
    return toDto(assessment, site, engineer)
  } catch (error: unknown) {
    // No transaction (dev and test MongoDB are standalone servers), so remove
    // the site by hand rather than leave it without an assessment.
    await SiteModel.deleteOne({ _id: site._id }).catch((cleanupError: unknown) => {
      console.error(`Could not remove site ${site.code} after a failed create:`, cleanupError)
    })
    throw error
  }
}

// Assigned assessments for engineers, all assessments for knowledge admins.
// Two queries: matching assessments, then their capture sessions.
// ponytail: paginate once one engineer's work list outgrows one response.
export async function listAssessments(user: SessionUser): Promise<AssessmentDto[]> {
  const assessments = await AssessmentModel.find(
    user.role === 'knowledge_admin' ? {} : { engineer: user.id },
  )
    .sort({ siteVisitDate: -1, createdAt: -1 })
    .populate<{ site: ISite }>('site')
    .populate<{ engineer: AssignedEngineer | null }>('engineer', 'name')
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
    const status = a.archivedAt
      ? 'archived'
      : (a.reportStatus ?? (session ? CAPTURE_STATUS[session] : 'not_started'))
    return toDto(a, a.site, a.engineer, status)
  })
}

export class NotAssignedError extends Error {
  constructor() {
    super('Only the assigned engineer can archive or restore this assessment.')
  }
}

export class NotArchivedError extends Error {
  constructor(reference: string) {
    super(`Assessment ${reference} is not archived.`)
  }
}

// The assessment's ID, when the user is its assigned engineer.
async function assignedAssessment(reference: string, user: SessionUser) {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  return assessment._id
}

// Archives an assessment (RV-10 AC8), a soft delete: only its assigned
// engineer can, and only once. Matching on archivedAt makes it atomic, so a
// double click cannot archive twice.
export async function archiveAssessment(reference: string, user: SessionUser): Promise<void> {
  const archived = await AssessmentModel.updateOne(
    { _id: await assignedAssessment(reference, user), archivedAt: { $exists: false } },
    { $set: { archivedAt: new Date() } },
  )
  if (!archived.modifiedCount) throw new AssessmentArchivedError(reference)
}

// Restores an archived assessment (RV-10 AC9). Its report status was kept, so
// clearing archivedAt returns it with the status it had.
export async function restoreAssessment(reference: string, user: SessionUser): Promise<void> {
  const restored = await AssessmentModel.updateOne(
    { _id: await assignedAssessment(reference, user), archivedAt: { $exists: true } },
    { $unset: { archivedAt: 1 } },
  )
  if (!restored.modifiedCount) throw new NotArchivedError(reference)
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

type AssignedEngineer = { _id: unknown; name: string }

function toDto(
  assessment: Omit<IAssessment, 'site' | 'engineer'> & { _id: unknown },
  site: ISite,
  engineer: AssignedEngineer | null | undefined,
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
    engineer: engineer ? { id: String(engineer._id), name: engineer.name } : null,
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

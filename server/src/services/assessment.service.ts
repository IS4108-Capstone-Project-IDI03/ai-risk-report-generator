import { z } from 'zod'
import { isValidObjectId, type Types } from 'mongoose'
import type { SessionUser } from './auth.service'
import {
  AssessmentModel,
  REPORT_STATUSES,
  VISIT_TYPES,
  type IAssessment,
} from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { nextInSequence } from './sequence.service'
import type { ISite } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'
import { changeRights, clientNameOf, restoreSiteOf, type Allowed } from './client.service'

export const required = (label: string) =>
  z
    .string(`${label} is required.`)
    .trim()
    .min(1, `${label} is required.`)
    .max(200, `${label} must be 200 characters or fewer.`)
export const optional = (label: string) =>
  z
    .string()
    .trim()
    .max(200, `${label} must be 200 characters or fewer.`)
    .optional()
    .transform((value) => value || undefined)
// Form date inputs send '' when left empty.
export const optionalDate = (label: string) =>
  z.preprocess(
    (value) => (value === '' || value === null ? undefined : value),
    z.iso.date(`${label} must be a valid date (YYYY-MM-DD).`).optional(),
  )

export const objectId = (message: string) => z.string(message).refine(isValidObjectId, message)

// A site's details: what a new site is created with, and what PUT
// /api/sites/:id corrects (CP-18).
export const siteDetailsSchema = z.object(
  {
    name: required('Site name'),
    address: optional('Site address'),
    jurisdiction: z
      .string('Jurisdiction is required.')
      .regex(/^[A-Z]{2}$/, 'Jurisdiction must be a two-letter code, e.g. SG.'),
    facilityType: required('Facility type'),
  },
  'Site details are required.',
)
const VISIT_TYPE_RULE = 'Choose a visit type: First survey, Resurvey or Follow-up visit.'
// One of the three visit types (CP-23).
export const visitType = z.enum(VISIT_TYPES, VISIT_TYPE_RULE)
export const dueOnOrAfterVisit = (a: { siteVisitDate?: string; reportDueDate?: string }) =>
  !a.siteVisitDate || !a.reportDueDate || a.reportDueDate >= a.siteVisitDate
export const dueDateRule = {
  message: 'The report due date must be on or after the site visit date.',
  path: ['reportDueDate'],
  // Checked even when another field is invalid, so every problem is named at once.
  when: ({ value }: { value: unknown }) => typeof value === 'object' && value !== null,
}

// Request body for PUT /api/assessments/:reference: the visit's own details.
// The engineer, client and site stay as created (CP-17 AC8), and the site's and
// client's details change for all their assessments at once, through PUT
// /api/sites/:id and /api/clients/:id (CP-18); a `site` sent here is ignored.
// `stored` is the assessment's saved type: kept as it is, it may be a type
// from before CP-23 (not yet migrated); changed, it must be one of the three.
// Without this, editing an older assessment's dates would be refused.
export const assessmentDetailsSchema = (stored?: string) =>
  z
    .object({
      surveyType: z
        .string(VISIT_TYPE_RULE)
        .refine(
          (t) => t === stored || (VISIT_TYPES as readonly string[]).includes(t),
          VISIT_TYPE_RULE,
        ),
      siteVisitDate: optionalDate('Site visit date'),
      reportDueDate: optionalDate('Report due date'),
    })
    .refine(dueOnOrAfterVisit, dueDateRule)

export type AssessmentDetails = z.infer<ReturnType<typeof assessmentDetailsSchema>>

/** Returns the assessment's saved type, or undefined for an unknown reference. */
export async function storedSurveyType(reference: string): Promise<string | undefined> {
  return (await AssessmentModel.findOne({ reference }, 'surveyType').lean())?.surveyType
}

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
  // The client's name, read through its site (CP-17); a site not yet migrated
  // has no client id and shows the name typed on the assessment.
  client: string
  clientId: string | null
  surveyType: string
  siteVisitDate: string | null
  siteVisitEndDate: string | null
  reportDueDate: string | null
  siteContacts: { name: string; role: string | null }[]
  engineer: { id: string; name: string } | null
  status: AssessmentStatus
  // When its latest capture session started; null before capture starts. The
  // dashboard continues the engineer's most recently started capture.
  captureStartedAt: Date | null
  createdAt: Date
  site: {
    id: string
    code: string
    name: string
    address: string | null
    // Where it is and its block pins (CP-26), shared by every visit to it.
    coordinates: { lat: number; lng: number } | null
    pins: { name: string; lat: number; lng: number }[]
    jurisdiction: string
    facilityType: string
    // Removed from its client (CP-18): it takes no new visit.
    removed: boolean
    // Whether the signed-in engineer may correct it (CP-18), and how many
    // assessments a correction changes, for its confirm step.
    change: Allowed & { assessments: number }
  }
}

// A site as an assessment shows it, with its client's name.
export type ListedSite = Omit<ISite, 'client'> & {
  _id: Types.ObjectId
  client?: { _id: Types.ObjectId; name: string } | null
}
// Whether the engineer may correct an assessment's site (CP-18).
export type Rights = ReturnType<Awaited<ReturnType<typeof changeRights>>>

// Assigned assessments for engineers, all assessments for knowledge admins.
// Two queries: matching assessments, then their capture sessions.
// ponytail: paginate once one engineer's work list outgrows one response.
export async function listAssessments(user: SessionUser): Promise<AssessmentDto[]> {
  const assessments = await AssessmentModel.find(
    user.role === 'knowledge_admin' ? {} : { engineer: user.id },
  )
    .sort({ siteVisitDate: -1, createdAt: -1 })
    .populate<{ site: ListedSite }>({ path: 'site', populate: { path: 'client', select: 'name' } })
    .populate<{ engineer: AssignedEngineer | null }>('engineer', 'name')
    .lean()
  const [sessions, rights] = await Promise.all([
    CaptureSessionModel.find({ assessment: { $in: assessments.map((a) => a._id) } })
      .sort({ createdAt: 1 })
      .lean(),
    changeRights(
      assessments.map((a) => a.site),
      user.id,
    ),
  ])
  // Later sessions overwrite earlier ones, so each assessment keeps its latest.
  const latest = new Map(sessions.map((s) => [String(s.assessment), s]))
  return assessments.map((a) => {
    const session = latest.get(String(a._id))
    const status = a.archivedAt
      ? 'archived'
      : (a.reportStatus ?? (session ? CAPTURE_STATUS[session.status] : 'not_started'))
    return toDto(a, a.site, a.engineer, rights(a.site), status, session?.createdAt ?? null)
  })
}

export class NotAssignedError extends Error {
  constructor(message = 'Only the assigned engineer can change this assessment.') {
    super(message)
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

// Corrects an assessment's own details (RV-10 AC10): its type and dates. Only
// its assigned engineer can, and not once it is archived, which keeps it
// read-only. A date left empty is cleared. The engineer, report reference,
// client and site never change (CP-17 AC8); the site's details, and the
// client's name, are corrected for all their assessments at once (CP-18).
export async function updateAssessment(
  reference: string,
  input: AssessmentDetails,
  user: SessionUser,
): Promise<void> {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  // 'YYYY-MM-DD' parses as UTC midnight, so the calendar day is kept.
  const optional = {
    siteVisitDate: input.siteVisitDate && new Date(input.siteVisitDate),
    reportDueDate: input.reportDueDate && new Date(input.reportDueDate),
  }
  const cleared = Object.keys(optional).filter((key) => !optional[key as keyof typeof optional])
  await AssessmentModel.updateOne(
    { _id: assessment._id },
    {
      $set: {
        surveyType: input.surveyType,
        ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value)),
      },
      ...(cleared.length && { $unset: Object.fromEntries(cleared.map((key) => [key, 1])) }),
    },
  )
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
// clearing archivedAt returns it with the status it had. A removed site comes
// back with it (CP-18), so a restored assessment never sits on a removed site;
// when its name has since been taken, it is refused until the site is restored
// under a new name.
export async function restoreAssessment(reference: string, user: SessionUser): Promise<void> {
  const assessment = await AssessmentModel.findOne({ reference }, 'engineer archivedAt site').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (!assessment.archivedAt) throw new NotArchivedError(reference)
  await restoreSiteOf(assessment.site)
  const restored = await AssessmentModel.updateOne(
    { _id: assessment._id, archivedAt: { $exists: true } },
    { $unset: { archivedAt: 1 } },
  )
  if (!restored.modifiedCount) throw new NotArchivedError(reference)
}

// Takes the next number in a sequence and inserts with the code built from
// it. A code already in use (e.g. a seeded record) is skipped.
export async function insertWithNextCode<T>(
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

export function pad(n: number) {
  return String(n).padStart(4, '0')
}

function isoDay(date?: Date) {
  return date ? date.toISOString().slice(0, 10) : null
}

type AssignedEngineer = { _id: unknown; name: string }

// An assessment as the API returns it.
export function toDto(
  assessment: Omit<IAssessment, 'site' | 'engineer'> & { _id: unknown },
  site: ListedSite,
  engineer: AssignedEngineer | null | undefined,
  rights: Rights,
  status: AssessmentStatus = 'not_started',
  captureStartedAt: Date | null = null,
): AssessmentDto {
  return {
    id: String(assessment._id),
    reference: assessment.reference,
    client: clientNameOf(site, assessment.client),
    clientId: site.client ? String(site.client._id) : null,
    surveyType: assessment.surveyType,
    siteVisitDate: isoDay(assessment.siteVisitDate),
    siteVisitEndDate: isoDay(assessment.siteVisitEndDate),
    reportDueDate: isoDay(assessment.reportDueDate),
    siteContacts: (assessment.siteContacts ?? []).map((c) => ({
      name: c.name,
      role: c.role ?? null,
    })),
    engineer: engineer ? { id: String(engineer._id), name: engineer.name } : null,
    status,
    captureStartedAt,
    createdAt: assessment.createdAt,
    site: {
      id: String(site._id),
      code: site.code,
      name: site.name,
      address: site.address ?? null,
      coordinates: site.coordinates
        ? { lat: site.coordinates.lat, lng: site.coordinates.lng }
        : null,
      pins: (site.blockPins ?? []).map(({ name, lat, lng }) => ({ name, lat, lng })),
      jurisdiction: site.jurisdiction,
      facilityType: site.facilityType,
      removed: !!site.removed,
      change: { ...rights.change, assessments: rights.assessments },
    },
  }
}

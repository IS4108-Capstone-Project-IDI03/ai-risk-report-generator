import { z } from 'zod'
import { isValidObjectId, type Types } from 'mongoose'
import { UserModel } from '../models/user.model'
import type { SessionUser } from './auth.service'
import { AssessmentModel, REPORT_STATUSES, type IAssessment } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import { AssessmentArchivedError, AssessmentNotFoundError } from './capture-session.service'
import { nextInSequence } from './sequence.service'
import { SiteModel, type ISite } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'
import { FACILITY_TYPES } from './knowledge-document.service'
import {
  clientNameOf,
  findOrCreateClient,
  getClient,
  isSiteShared,
  latestVisit,
  liveVisitCounts,
  refuseDuplicateSite,
  SiteSharedError,
  UnknownSiteError,
} from './client.service'

// A new or changed facility type must be one the forms offer, since the
// knowledge base's labels and the checklist's hazards (CP-30) use only those.
// An older site's type, kept unchanged, is not refused, so its assessments can
// still be edited.
const FACILITY_TYPE_RULE = 'Choose a facility type from the list.'
export class UnknownFacilityTypeError extends Error {
  constructor() {
    super(FACILITY_TYPE_RULE)
    this.name = 'UnknownFacilityTypeError'
  }
}

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

const objectId = (message: string) => z.string(message).refine(isValidObjectId, message)

// A site's details: what a new site is created with, and what PUT
// /api/assessments/:reference corrects while the site is not shared (RV-10
// AC10, CP-17 AC8).
const siteDetails = z.object(
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
const assessmentFields = {
  surveyType: required('Assessment type'),
  siteVisitDate: optionalDate('Site visit date'),
  reportDueDate: optionalDate('Report due date'),
}
const dueOnOrAfterVisit = (a: { siteVisitDate?: string; reportDueDate?: string }) =>
  !a.siteVisitDate || !a.reportDueDate || a.reportDueDate >= a.siteVisitDate
const dueDateRule = {
  message: 'The report due date must be on or after the site visit date.',
  path: ['reportDueDate'],
}

// Request body for POST /api/assessments (CP-17): the client is a listed one
// (clientId) or a new name (client), and the site one of that client's
// (siteId) or a new one (site). For a listed site, copyLocations, on unless
// false, copies its latest visit's locations (AC5).
export const newAssessmentSchema = z
  .object({
    clientId: objectId('Choose one of the listed clients, or name a new one.').optional(),
    client: required('Client').optional(),
    siteId: objectId("Choose one of this client's sites, or add a new one.").optional(),
    site: siteDetails
      .extend({
        facilityType: required('Facility type').refine(
          (type) => FACILITY_TYPES.includes(type),
          FACILITY_TYPE_RULE,
        ),
      })
      .optional(),
    copyLocations: z.boolean().default(true),
    ...assessmentFields,
    engineerId: objectId('Choose the engineer for this assessment.'),
  })
  .refine((a) => !!a.clientId !== !!a.client, {
    message: 'Client is required.',
    path: ['client'],
  })
  .refine((a) => !!a.siteId !== !!a.site, {
    message: 'Site details are required.',
    path: ['site'],
  })
  .refine((a) => !a.siteId || a.clientId, {
    message: 'A new client has no sites yet. Add a new site.',
    path: ['siteId'],
  })
  .refine(dueOnOrAfterVisit, dueDateRule)

// Request body for PUT /api/assessments/:reference. The engineer, client and
// site stay as created (CP-17 AC8); only the site's details can be corrected.
export const assessmentDetailsSchema = z
  .object({ site: siteDetails, ...assessmentFields })
  .refine(dueOnOrAfterVisit, dueDateRule)

export type NewAssessment = z.infer<typeof newAssessmentSchema>
export type AssessmentDetails = z.infer<typeof assessmentDetailsSchema>

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
  reportDueDate: string | null
  engineer: { id: string; name: string } | null
  status: AssessmentStatus
  // When its latest capture session started; null before capture starts. The
  // dashboard continues the engineer's most recently started capture.
  captureStartedAt: Date | null
  createdAt: Date
  // Whether the site has another assessment that is not archived: its details
  // are then shared, and can't be changed here (CP-17 AC8).
  siteShared: boolean
  site: {
    id: string
    code: string
    name: string
    address: string | null
    jurisdiction: string
    facilityType: string
  }
}

// A site as an assessment shows it, with its client's name.
type ListedSite = Omit<ISite, 'client'> & {
  _id: Types.ObjectId
  client?: { _id: Types.ObjectId; name: string } | null
}

// Creates the assessment on a listed site of a listed client, or adds the
// client and the site first (CP-17), allocating the site code and the report
// reference (RPT-<year>-<nnnn>) on the server. On a listed site, it starts with
// a copy of the latest visit's locations unless the engineer said not to.
export async function createAssessment(input: NewAssessment): Promise<AssessmentDto> {
  const engineer = await UserModel.findOne({
    _id: input.engineerId,
    role: 'risk_engineer',
    active: true,
  }).lean()
  if (!engineer) throw new InvalidEngineersError()
  const year = new Date().getUTCFullYear()
  const client = input.clientId
    ? await getClient(input.clientId)
    : await findOrCreateClient(input.client!)
  let site: ISite & { _id: Types.ObjectId }
  if (input.siteId) {
    const listed = await SiteModel.findById(input.siteId).lean()
    // A site of another client is refused.
    if (!listed || !client._id.equals(listed.client)) throw new UnknownSiteError()
    site = listed
  } else {
    await refuseDuplicateSite(client._id, input.site!.name)
    const added = await insertWithNextCode(
      'site',
      (n) => `SITE-${pad(n)}`,
      (code) => SiteModel.create({ code, ...input.site, client: client._id }),
    )
    site = added.toObject()
  }
  // Each copied location is the new assessment's own, with a new id (AC7).
  const copied = input.siteId && input.copyLocations ? await latestVisit(site._id) : null
  const locations = (copied?.locations ?? []).map(({ building, floor, name, key }) => ({
    building,
    floor,
    name,
    key,
  }))
  try {
    const assessment = await insertWithNextCode(
      `assessment:${year}`,
      (n) => `RPT-${year}-${pad(n)}`,
      (reference) =>
        AssessmentModel.create({
          reference,
          site: site._id,
          surveyType: input.surveyType,
          // 'YYYY-MM-DD' parses as UTC midnight, so the calendar day is kept.
          siteVisitDate: input.siteVisitDate ? new Date(input.siteVisitDate) : undefined,
          reportDueDate: input.reportDueDate ? new Date(input.reportDueDate) : undefined,
          engineer: engineer._id,
          locations,
        }),
    )
    const shared = !!input.siteId && (await isSiteShared(site._id, assessment._id))
    return toDto(assessment, { ...site, client }, engineer, shared)
  } catch (error: unknown) {
    // No transaction (dev and test MongoDB are standalone servers), so remove
    // a new site by hand rather than leave it without an assessment.
    if (!input.siteId)
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
    .populate<{ site: ListedSite }>({ path: 'site', populate: { path: 'client', select: 'name' } })
    .populate<{ engineer: AssignedEngineer | null }>('engineer', 'name')
    .lean()
  const [sessions, visits] = await Promise.all([
    CaptureSessionModel.find({ assessment: { $in: assessments.map((a) => a._id) } })
      .sort({ createdAt: 1 })
      .lean(),
    liveVisitCounts(assessments.map((a) => a.site._id)),
  ])
  // Later sessions overwrite earlier ones, so each assessment keeps its latest.
  const latest = new Map(sessions.map((s) => [String(s.assessment), s]))
  return assessments.map((a) => {
    const session = latest.get(String(a._id))
    const status = a.archivedAt
      ? 'archived'
      : (a.reportStatus ?? (session ? CAPTURE_STATUS[session.status] : 'not_started'))
    // Its site's assessments not archived, less itself when it counts.
    const others = (visits.get(String(a.site._id)) ?? 0) - (a.archivedAt ? 0 : 1)
    return toDto(a, a.site, a.engineer, others > 0, status, session?.createdAt ?? null)
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

// Corrects an assessment's details and its site's (RV-10 AC10): only its
// assigned engineer can, and not once it is archived, which keeps it read-only.
// A date left empty is cleared. The engineer, report reference, client and
// site never change (CP-17 AC8). Once the site has another assessment not
// archived, its details are shared and can't be changed here (AC8); sending
// them unchanged is fine.
export async function updateAssessment(
  reference: string,
  input: AssessmentDetails,
  user: SessionUser,
): Promise<void> {
  const assessment = await AssessmentModel.findOne({ reference }, 'site engineer archivedAt').lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) throw new NotAssignedError()
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)
  const site = await SiteModel.findById(assessment.site).lean()
  const { address, ...details } = input.site
  const changed =
    site &&
    (site.name !== details.name ||
      (site.address ?? undefined) !== address ||
      site.jurisdiction !== details.jurisdiction ||
      site.facilityType !== details.facilityType)
  if (changed) {
    if (
      site.facilityType !== details.facilityType &&
      !FACILITY_TYPES.includes(details.facilityType)
    )
      throw new UnknownFacilityTypeError()
    if (await isSiteShared(site._id, assessment._id)) throw new SiteSharedError()
    if (site.client && site.name !== details.name)
      await refuseDuplicateSite(site.client, details.name, site._id)
    await SiteModel.updateOne(
      { _id: site._id },
      {
        $set: { ...details, ...(address && { address }) },
        ...(!address && { $unset: { address: 1 } }),
      },
    )
  }
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

function pad(n: number) {
  return String(n).padStart(4, '0')
}

function isoDay(date?: Date) {
  return date ? date.toISOString().slice(0, 10) : null
}

type AssignedEngineer = { _id: unknown; name: string }

function toDto(
  assessment: Omit<IAssessment, 'site' | 'engineer'> & { _id: unknown },
  site: ListedSite,
  engineer: AssignedEngineer | null | undefined,
  siteShared: boolean,
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
    reportDueDate: isoDay(assessment.reportDueDate),
    engineer: engineer ? { id: String(engineer._id), name: engineer.name } : null,
    status,
    captureStartedAt,
    createdAt: assessment.createdAt,
    siteShared,
    site: {
      id: String(site._id),
      code: site.code,
      name: site.name,
      address: site.address ?? null,
      jurisdiction: site.jurisdiction,
      facilityType: site.facilityType,
    },
  }
}

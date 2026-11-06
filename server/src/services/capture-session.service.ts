import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import type { ISite } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'
import { clientNameOf } from './client.service'
import type { SessionUser } from './auth.service'
import { NotAssignedError } from './assessment.service'

export class AssessmentNotFoundError extends Error {
  constructor(reference: string) {
    super(`Assessment ${reference} was not found.`)
    this.name = 'AssessmentNotFoundError'
  }
}

// An archived assessment is kept read-only, so it takes no new captures.
export class AssessmentArchivedError extends Error {
  constructor(reference: string) {
    super(`Assessment ${reference} is archived.`)
    this.name = 'AssessmentArchivedError'
  }
}

export type CaptureSessionResult = {
  created: boolean
  session: { id: string; status: CaptureSessionStatus; startedAt: Date }
  // Identifies the assessment on the capture screen (CP-01 AC3).
  assessment: {
    id: string
    reference: string
    client: string
    site: { code: string; name: string } | null
  }
}

// Returns the assessment's active capture session, creating one only when none
// exists (CP-01 AC1/AC2). Idempotent, so the client calls it every time the
// capture screen opens rather than tracking whether a session was started.
// Assessments are addressed by their reference, the ID the client holds. Only the
// assigned engineer can: a knowledge admin reaches this route too (RV-11), and
// without the check they could open capture on someone else's assessment.
export async function startCaptureSession(
  reference: string,
  user: SessionUser,
): Promise<CaptureSessionResult> {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: Pick<ISite, 'code' | 'name' | 'client'> | null }>({
      path: 'site',
      select: 'code name client',
      populate: { path: 'client', select: 'name' },
    })
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)
  if (String(assessment.engineer) !== user.id) {
    throw new NotAssignedError('Only the engineer assigned to this assessment can capture for it.')
  }
  if (assessment.archivedAt) throw new AssessmentArchivedError(reference)

  const active = { assessment: assessment._id, status: 'active' as const }
  let created = false
  let session = await CaptureSessionModel.findOne(active).lean()
  if (!session) {
    try {
      session = (await CaptureSessionModel.create(active)).toObject()
      created = true
    } catch (error: unknown) {
      // A concurrent request created the session between our read and write;
      // the partial unique index rejected ours, so return theirs.
      if (!isDuplicateKeyError(error)) throw error
      session = await CaptureSessionModel.findOne(active).lean()
      if (!session) throw error
    }
  }

  return {
    created,
    session: { id: String(session._id), status: session.status, startedAt: session.createdAt },
    assessment: {
      id: String(assessment._id),
      reference: assessment.reference,
      client: clientNameOf(assessment.site, assessment.client),
      site: assessment.site ? { code: assessment.site.code, name: assessment.site.name } : null,
    },
  }
}

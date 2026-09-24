import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel, type CaptureSessionStatus } from '../models/capture-session.model'
import type { ISite } from '../models/site.model'
import { isDuplicateKeyError } from './mongo-errors'

export class AssessmentNotFoundError extends Error {
  constructor(reference: string) {
    super(`Assessment ${reference} was not found.`)
    this.name = 'AssessmentNotFoundError'
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
// Assessments are addressed by their reference, the ID the client holds.
export async function startCaptureSession(reference: string): Promise<CaptureSessionResult> {
  const assessment = await AssessmentModel.findOne({ reference })
    .populate<{ site: Pick<ISite, 'code' | 'name'> | null }>('site', 'code name')
    .lean()
  if (!assessment) throw new AssessmentNotFoundError(reference)

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
      client: assessment.client,
      site: assessment.site ? { code: assessment.site.code, name: assessment.site.name } : null,
    },
  }
}

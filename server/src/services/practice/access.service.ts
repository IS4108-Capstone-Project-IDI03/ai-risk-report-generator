// F-12: who may reach a record by its own id when it belongs to a practice assessment (ADR 0003).
// /api/assessments/:reference/** is closed by practiceGate; the observation, client, site and
// client document routes name their record by id instead, so they ask here. Called by
// middleware/practice.middleware.ts (practiceRecordGate). Reads the models; writes nothing.
import { isValidObjectId, type Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { ClientDocumentModel } from '../../models/client-document.model'
import { ClientModel } from '../../models/client.model'
import { ObservationModel } from '../../models/observation.model'
import { SiteModel } from '../../models/site.model'

export type RecordKind = 'observation' | 'client' | 'site' | 'client-document'

type User = { id: string }

// A practice client or site is its owner's while their practice assessment is live: the
// assessment on that site is the one record of who owns it.
async function ownsLivePracticeAt(sites: Types.ObjectId[], user: User) {
  return !!(await AssessmentModel.exists({
    site: { $in: sites },
    practice: 'live',
    engineer: user.id,
  }))
}

async function canReachSite(id: unknown, user: User) {
  const site = await SiteModel.findById(id, 'practice').lean()
  return !site?.practice || ownsLivePracticeAt([site._id], user)
}

async function canReachClient(id: unknown, user: User) {
  const client = await ClientModel.findById(id, 'practice').lean()
  if (!client?.practice) return true
  const sites = await SiteModel.find({ client: client._id }, '_id').lean()
  return ownsLivePracticeAt(
    sites.map((s) => s._id),
    user,
  )
}

/**
 * Returns whether the user may reach this record by id: true for anything that is not a
 * practice record (and for an unknown id, which the route answers 404 itself), and for a practice
 * one only for its owner while it is live. Without this, a teammate or an admin who knew a
 * practice record's id could read or change it.
 */
export async function canReachRecord(kind: RecordKind, id: string, user: User): Promise<boolean> {
  if (!isValidObjectId(id)) return true
  switch (kind) {
    case 'site':
      return canReachSite(id, user)
    case 'client':
      return canReachClient(id, user)
    case 'client-document': {
      const doc = await ClientDocumentModel.findById(id, 'client').lean()
      return !doc || canReachClient(doc.client, user)
    }
    case 'observation': {
      const observation = await ObservationModel.findById(id, 'assessment').lean()
      const assessment =
        observation && (await AssessmentModel.findById(observation.assessment, 'site').lean())
      return !assessment || canReachSite(assessment.site, user)
    }
  }
}

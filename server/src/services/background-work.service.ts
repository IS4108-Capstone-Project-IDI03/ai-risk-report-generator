// Background work (F-11): the long-running jobs a user is waiting on, each as
// one row with its state and progress, for the header's activity popover.
// Called by routes/background-work.routes.ts, polled while work runs, so it
// reads lean batches: one query per collection, not one per assessment.
import type { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import type { ISite } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import type { SessionUser } from './auth.service'
import type { StoredWalk } from './site-walk.service'

export type BackgroundWorkRow = {
  id: string
  kind: 'walk'
  state: 'queued' | 'running' | 'failed' | 'waiting_on_you'
  title: string
  // What the job belongs to: the assessment's site, or a document's title.
  context: { label: string; reference?: string }
  progress: { type: 'count' | 'stages' | 'working'; current?: number; total?: number; unit?: string }
  href: string
}

export type BackgroundWorkDto = { rows: BackgroundWorkRow[] }

type OwnAssessment = { _id: Types.ObjectId; reference: string; site: Pick<ISite, 'name'> | null }

/** Returns the user's background work, oldest first. */
export async function backgroundWorkFor(user: SessionUser): Promise<BackgroundWorkDto> {
  const assessments = await AssessmentModel.find({ engineer: user.id }, 'reference site')
    .populate<{ site: Pick<ISite, 'name'> | null }>('site', 'name')
    .lean<OwnAssessment[]>()
  const byId = new Map(assessments.map((a) => [String(a._id), a]))
  const walks = await SiteWalkModel.find({
    assessment: { $in: assessments.map((a) => a._id) },
    status: 'transcribing',
  })
    .sort({ createdAt: 1 })
    .lean<StoredWalk[]>()
  return { rows: walks.map((w) => walkRow(w, byId.get(String(w.assessment))!)) }
}

function walkRow(walk: StoredWalk, assessment: OwnAssessment): BackgroundWorkRow {
  const { reference } = assessment
  return {
    id: `walk:${walk._id}`,
    kind: 'walk',
    state: 'running',
    title: walk.name ?? 'Site walk',
    context: { label: assessment.site?.name ?? reference, reference },
    progress: {
      type: 'stages',
      current: walk.recordings.filter((r) => r.transcription.status === 'transcribed').length,
      total: walk.recordings.length,
      unit: 'recordings',
    },
    href: `/assessment?ref=${encodeURIComponent(reference)}&tab=observations&walk=${walk._id}`,
  }
}

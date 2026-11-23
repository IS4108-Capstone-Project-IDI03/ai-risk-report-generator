// Background work (F-11): the long-running jobs a user is waiting on, each as
// one row with its state and progress, for the header's activity popover.
// Called by routes/background-work.routes.ts, polled while work runs, so it
// reads lean batches: one query per collection, not one per assessment.
import type { Types } from 'mongoose'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import type { ISite } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import type { SessionUser } from './auth.service'
import { listObservationsOf, type ObservationDto } from './observation.service'
import type { StoredWalk } from './site-walk.service'

export type BackgroundWorkRow = {
  id: string
  kind: 'walk' | 'voice-note' | 'handwriting'
  state: 'queued' | 'running' | 'failed' | 'waiting_on_you'
  title: string
  // What the job belongs to: the assessment's site, or a document's title.
  context: { label: string; reference?: string }
  progress: {
    type: 'count' | 'stages' | 'working'
    current?: number
    total?: number
    unit?: string
    stage?: string
  }
  // When the current step began, where it is known (the popover shows the time elapsed).
  startedAt?: string
  // A failed job's reason, in plain English.
  error?: string
  href: string
  // How to start a failed job again: an existing route the user may call.
  retry?: { method: 'POST'; url: string }
}

export type BackgroundWorkDto = { rows: BackgroundWorkRow[] }

type OwnAssessment = {
  _id: Types.ObjectId
  reference: string
  site: Pick<ISite, 'name'> | null
  locations?: ILocation[]
}

/** Returns the user's background work, oldest first. */
export async function backgroundWorkFor(user: SessionUser): Promise<BackgroundWorkDto> {
  const assessments = await AssessmentModel.find(
    { engineer: user.id },
    'reference site locations',
  )
    .populate<{ site: Pick<ISite, 'name'> | null }>('site', 'name')
    .lean<OwnAssessment[]>()
  const byId = new Map(assessments.map((a) => [String(a._id), a]))
  const [walks, observations] = await Promise.all([
    SiteWalkModel.find({
      assessment: { $in: assessments.map((a) => a._id) },
      status: { $in: ['transcribing', 'proposing', 'failed'] },
    })
      .sort({ createdAt: 1 })
      .lean<StoredWalk[]>(),
    // Through listObservationsOf, never the model: it leaves draft observations out (CP-24).
    listObservationsOf(assessments),
  ])
  return {
    rows: [
      ...walks.map((w) => walkRow(w, byId.get(String(w.assessment))!)),
      ...assessments.flatMap((a) =>
        (observations.get(String(a._id)) ?? []).flatMap((o) => observationRows(o, a)),
      ),
    ],
  }
}

const context = ({ reference, site }: OwnAssessment) => ({
  label: site?.name ?? reference,
  reference,
})

function walkRow(walk: StoredWalk, assessment: OwnAssessment): BackgroundWorkRow {
  const { reference } = assessment
  return {
    id: `walk:${walk._id}`,
    kind: 'walk',
    state: walk.status === 'failed' ? 'failed' : 'running',
    title: walk.name ?? 'Site walk',
    context: context(assessment),
    ...walkProgress(walk),
    href: `/assessment?ref=${encodeURIComponent(reference)}&tab=observations&walk=${walk._id}`,
    ...(walk.status === 'failed' && {
      error: walk.error ?? 'This site walk could not be finished.',
      retry: {
        method: 'POST',
        url: `/api/assessments/${encodeURIComponent(reference)}/site-walks/${walk._id}/retry`,
      },
    }),
  }
}

// Transcribing counts recordings done. Proposing is one model call with no
// progress of its own; nothing else changes the walk while it runs, so its
// last change is when proposing began.
function walkProgress(walk: StoredWalk): Pick<BackgroundWorkRow, 'progress' | 'startedAt'> {
  if (walk.status === 'proposing')
    return {
      progress: { type: 'working', stage: 'Proposing observations' },
      startedAt: walk.updatedAt.toISOString(),
    }
  return {
    progress: {
      type: 'stages',
      current: walk.recordings.filter((r) => r.transcription.status === 'transcribed').length,
      total: walk.recordings.length,
      unit: 'recordings',
    },
  }
}

const observationHref = (reference: string, o: ObservationDto) =>
  `/assessment?ref=${encodeURIComponent(reference)}&tab=observations&obs=${o.id}`

// What differs between a voice note and a handwritten page.
const TRANSCRIBED = {
  'voice-note': {
    route: 'recordings',
    stage: 'Transcribing',
    failed: 'This voice note could not be transcribed.',
  },
  handwriting: {
    route: 'pages',
    stage: 'Reading handwriting',
    failed: 'This handwritten page could not be read.',
  },
} as const

type Transcribed = {
  id: string
  name: string
  transcription: { status: string; error: string | null; startedAt: Date | null }
}

// Each recording or handwritten page being transcribed is one model call; a
// failed one stays listed until the engineer tries again or removes it.
function observationRows(o: ObservationDto, assessment: OwnAssessment): BackgroundWorkRow[] {
  const rows = (kind: keyof typeof TRANSCRIBED, items: Transcribed[]) => {
    const { route, stage, failed } = TRANSCRIBED[kind]
    return items
      .filter((item) => item.transcription.status !== 'transcribed')
      .map((item): BackgroundWorkRow => {
        const { status, error, startedAt } = item.transcription
        return {
          id: `${kind}:${o.id}:${item.id}`,
          kind,
          state: status === 'failed' ? 'failed' : 'running',
          // A recording's own name is "Recording 1", which says less than this.
          title: kind === 'voice-note' ? 'Voice note' : item.name,
          context: context(assessment),
          progress: { type: 'working', stage },
          ...(startedAt && { startedAt: startedAt.toISOString() }),
          href: observationHref(assessment.reference, o),
          ...(status === 'failed' && {
            error: error ?? failed,
            retry: {
              method: 'POST',
              url: `/api/observations/${o.id}/${route}/${item.id}/transcription/retry`,
            },
          }),
        }
      })
  }
  return [...rows('voice-note', o.recordings), ...rows('handwriting', o.pages)]
}

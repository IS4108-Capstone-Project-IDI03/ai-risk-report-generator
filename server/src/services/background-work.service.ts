// Background work (F-11): the long-running jobs a user is waiting on, each as
// one row with its state and progress, for the header's activity popover.
// Called by routes/background-work.routes.ts, polled while work runs, so it
// reads lean batches: one query per collection, not one per assessment.
import type { Types } from 'mongoose'
import { AssessmentModel, type ILocation } from '../models/assessment.model'
import { DraftingRunModel, type IDraftingRun } from '../models/drafting-run.model'
import type { ISite } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import type { SessionUser } from './auth.service'
import {
  listAwaitingDecision,
  listDocumentsByIds,
  listKnowledgeDocuments,
  type KnowledgeDocumentDto,
} from './knowledge-document.service'
import { openRequestsWithIncoming } from './knowledge-gap.service'
import { listObservationsOf, type ObservationDto } from './observation.service'
import { permissionsFor } from './permissions.service'
import type { StoredWalk } from './site-walk.service'

export type BackgroundWorkRow = {
  id: string
  kind:
    | 'walk'
    | 'voice-note'
    | 'handwriting'
    | 'reading'
    | 'drafting'
    | 'ingestion'
    | 'document-decision'
    | 'request'
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
    // Which stage of how many, for a job that runs through named stages (ingestion).
    step?: number
    steps?: number
    // One segment per part or stage, in order, where the job has them: what is
    // done, being worked on, failed or still to come.
    segments?: Segment[]
  }
  // When the current step began, where it is known (the popover shows the time elapsed).
  startedAt?: string
  // A failed job's reason, in plain English.
  error?: string
  href: string
  // How to start a failed job again: an existing route the user may call.
  retry?: { method: 'POST'; url: string }
}

export type Segment = 'done' | 'working' | 'failed' | 'empty'

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
    // Archived work is over: nothing on it runs or can be tried again.
    { engineer: user.id, archivedAt: null },
    'reference site locations',
  )
    .populate<{ site: Pick<ISite, 'name'> | null }>('site', 'name')
    .lean<OwnAssessment[]>()
  const byId = new Map(assessments.map((a) => [String(a._id), a]))
  const ids = assessments.map((a) => a._id)
  const admin = permissionsFor(user.role).includes('knowledge:manage')
  const [walks, observations, drafting, documents, decisions, requests] = await Promise.all([
    SiteWalkModel.find({
      assessment: { $in: ids },
      status: { $in: ['transcribing', 'proposing', 'failed'] },
    })
      .sort({ createdAt: 1 })
      .lean<StoredWalk[]>(),
    // Through listObservationsOf, never the model: it leaves draft observations out (CP-24).
    listObservationsOf(assessments),
    DraftingRunModel.find({ assessment: { $in: ids } }, 'assessment parts run').lean<
      Pick<IDraftingRun, 'assessment' | 'parts' | 'run'>[]
    >(),
    // Uploads are the knowledge admins' (knowledge:manage), not one person's.
    admin ? listKnowledgeDocuments() : [],
    admin ? listAwaitingDecision() : [],
    requestRows(user, admin),
  ])
  return {
    rows: [
      ...walks.map((w) => walkRow(w, byId.get(String(w.assessment))!)),
      ...assessments.flatMap((a) =>
        (observations.get(String(a._id)) ?? []).flatMap((o) => observationRows(o, a)),
      ),
      ...drafting.flatMap((d) => draftingRows(d, byId.get(String(d.assessment))!)),
      ...decisions.map(decisionRow),
      ...documents.flatMap(ingestionRows),
      ...requests,
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
  const reading = readingRow(o, assessment)
  return [
    ...rows('voice-note', o.recordings),
    ...rows('handwriting', o.pages),
    ...(reading ? [reading] : []),
  ]
}

// The reading job (CP-24): describing the photos, then suggesting the category
// and severity. One row per observation, since one Try again restarts both.
function readingRow(o: ObservationDto, assessment: OwnAssessment): BackgroundWorkRow | null {
  const photos = o.interpretation?.photos
  const failed = photos?.status === 'failed' || o.suggestion?.status === 'failed'
  const describing = photos?.status === 'interpreting'
  if (!failed && !describing && o.suggestion?.status !== 'reading') return null
  return {
    id: `reading:${o.id}`,
    kind: 'reading',
    state: failed ? 'failed' : 'running',
    title: 'Observation',
    context: context(assessment),
    progress: {
      type: 'working',
      stage: describing ? 'Describing photos' : 'Suggesting category and severity',
    },
    // The suggestion keeps no time of its own.
    ...(describing && photos.startedAt && { startedAt: photos.startedAt.toISOString() }),
    href: observationHref(assessment.reference, o),
    ...(failed && {
      error:
        (o.suggestion?.status === 'failed' && o.suggestion.error) ||
        photos?.error ||
        'This observation could not be read.',
      retry: { method: 'POST', url: `/api/observations/${o.id}/suggestion/retry` },
    }),
  }
}

// Drafting (GN-13). A run under way is one row: its parts drafted of the
// parts it drafts. Outside a run, a section still queued or being drafted again
// from Review is a row of its own, and the sections that failed fold into one
// row for the assessment ("3 sections not drafted"; one keeps its reason), so
// several assessments don't flood the popover. It stays until they are drafted
// again, which is the drafting tab's choice (a new run drafts what its
// checkpoint offers), so the rows link there and offer no Try again.
const PART_STATE = { queued: 'queued', drafting: 'running' } as const
function draftingRows(
  d: Pick<IDraftingRun, 'parts' | 'run'>,
  assessment: OwnAssessment,
): BackgroundWorkRow[] {
  const { run } = d
  const base = {
    kind: 'drafting' as const,
    context: context(assessment),
    href: `/assessment?ref=${encodeURIComponent(assessment.reference)}&tab=generate`,
  }
  if (run && !run.finishedAt)
    return [
      {
        ...base,
        id: `drafting:${assessment.reference}`,
        state: 'running',
        title: 'Drafting the report',
        progress: {
          type: 'stages',
          current: run.parts.filter((id) => d.parts?.[id]?.status === 'done').length,
          total: run.parts.length,
          unit: 'parts',
        },
        startedAt: new Date(run.startedAt).toISOString(),
      },
    ]
  const parts = Object.entries(d.parts ?? {})
  const working = parts.flatMap(([id, job]): BackgroundWorkRow[] =>
    job.status === 'queued' || job.status === 'drafting'
      ? [
          {
            ...base,
            id: `drafting:${assessment.reference}:${id}`,
            state: PART_STATE[job.status],
            title: `Section ${id}`,
            progress: { type: 'working', stage: 'Drafting' },
            ...(job.status === 'drafting' && {
              startedAt: new Date(job.requestedAt).toISOString(),
            }),
          },
        ]
      : [],
  )
  const failed = parts.filter(([, job]) => job.status === 'failed')
  if (!failed.length) return working
  const [[onlyId, only]] = failed
  return [
    ...working,
    {
      ...base,
      id: `drafting:${assessment.reference}:failed`,
      state: 'failed',
      title: 'Drafting the report',
      progress: { type: 'working', stage: 'Drafting' },
      error:
        failed.length === 1
          ? (only.error ?? `Section ${onlyId} could not be drafted.`)
          : `${failed.length} sections not drafted`,
    },
  ]
}

// Chunking's OCR pass reads regions out of page order, so it is counted by
// region, as the uploads list counts it; every other stage counts pages.
function counted(p: NonNullable<KnowledgeDocumentDto['progress']>) {
  if (p.currentStage === 'chunking' && p.ocrTotal !== null)
    return { current: p.ocrCurrent ?? 0, total: p.ocrTotal, unit: 'regions' }
  return {
    ...(p.pageCurrent !== null && { current: p.pageCurrent }),
    ...(p.pageTotal !== null && { total: p.pageTotal }),
    unit: 'pages',
  }
}

const STAGE_NAMES: Record<string, string> = {
  anonymising: 'Anonymising',
  parsing: 'Parsing',
  chunking: 'Chunking',
  indexing: 'Indexing',
}

// Ingestion's stages: three, or four when the report is anonymised first (PV-05).
function ingestionStages(current: string, done: string[]): string[] {
  const stages = ['parsing', 'chunking', 'indexing']
  if (current === 'anonymising' || done.includes('anonymising')) stages.unshift('anonymising')
  return stages
}

// Which stage of how many, and a segment for each: those before it done, it
// itself `state`, the rest still to come.
function stagesOf(current: string, done: string[], state: Segment) {
  const stages = ingestionStages(current, done)
  const step = stages.indexOf(current) + 1
  return {
    stage: STAGE_NAMES[current] ?? current,
    step,
    steps: stages.length,
    segments: stages.map((_, i): Segment =>
      i < step - 1 ? 'done' : i === step - 1 ? state : 'empty',
    ),
  }
}

// A document being ingested (E2): its stage, of three, or four when the report
// is anonymised first (PV-05), and the pages that stage has reached. Before
// the worker reports (queued, or just taken), it waits, timed from its upload.
// A failed one can be tried again.
function ingestionRows(d: KnowledgeDocumentDto): BackgroundWorkRow[] {
  if (!['queued', 'processing', 'failed'].includes(d.status)) return []
  const row = {
    id: `ingestion:${d.id}`,
    kind: 'ingestion' as const,
    title: d.title,
    context: { label: 'Knowledge base' },
    href: '/admin/knowledge-base',
  }
  // Listed for 7 days, as on the uploads list: a failure needs someone to act.
  if (d.status === 'failed')
    return [
      {
        ...row,
        state: 'failed',
        progress: d.failedIn
          ? { type: 'working', ...stagesOf(d.failedIn.stage, d.failedIn.done, 'failed') }
          : { type: 'working', stage: 'Ingestion' },
        error: d.error ?? 'This document could not be ingested.',
        // Every viewer here holds knowledge:manage, which the retry route checks.
        retry: { method: 'POST', url: `/api/knowledge-documents/${d.id}/retry` },
      },
    ]
  const p = d.progress
  if (!p)
    return [
      {
        ...row,
        state: 'queued',
        progress: { type: 'working', stage: 'Queued' },
        startedAt: queuedSince(d),
      },
    ]
  const stages = ingestionStages(
    p.currentStage,
    p.stageLog.map((e) => e.stage),
  )
  return [
    {
      ...row,
      state: 'running',
      progress: {
        type: 'count',
        ...counted(p),
        stage: STAGE_NAMES[p.currentStage] ?? p.currentStage,
        step: stages.indexOf(p.currentStage) + 1,
        steps: stages.length,
      },
      startedAt: p.currentStageStartedAt,
    },
  ]
}

// A document only an admin can move on (IN-07, IN-19): its source type to
// choose on the uploads list, or its details or match to settle on its Review page.
function decisionRow(d: KnowledgeDocumentDto): BackgroundWorkRow {
  const stage =
    d.status === 'awaiting_type'
      ? 'Choose its source type'
      : d.unconfirmed.length
        ? 'Confirm its details'
        : 'Decide on the match'
  return {
    id: `document-decision:${d.id}`,
    kind: 'document-decision',
    state: 'waiting_on_you',
    title: d.title,
    context: { label: 'Knowledge base' },
    progress: { type: 'working', stage },
    href:
      d.status === 'awaiting_type'
        ? '/admin/knowledge-base'
        : `/admin/knowledge-base/review/${d.id}`,
  }
}

// The user's own open knowledge requests (CB-07) with documents an admin
// uploaded for them (F-11): each such document's ingestion, under the request.
// Trying a failed one again stays the admins' (knowledge:manage).
async function requestRows(user: SessionUser, admin: boolean): Promise<BackgroundWorkRow[]> {
  const requests = await openRequestsWithIncoming(user.id)
  if (!requests.length) return []
  const documents = new Map(
    (await listDocumentsByIds(requests.flatMap((r) => r.incomingDocumentIds))).map((d) => [
      d.id,
      d,
    ]),
  )
  return requests.flatMap((r) =>
    r.incomingDocumentIds.flatMap((id) => {
      const document = documents.get(id)
      return (document ? ingestionRows(document) : []).map(({ retry, ...row }) => ({
        ...row,
        id: `request:${r.id}:${id}`,
        kind: 'request' as const,
        context: { label: `Your request: ${r.question}` },
        ...(admin && retry && { retry }),
      }))
    }),
  )
}

// When a document joined the queue: its upload, or later, the admin's Try again
// or source type choice, which put it back (both stamp `handled`).
function queuedSince(d: KnowledgeDocumentDto): string {
  const uploaded = new Date(d.uploadedAt).getTime()
  const handled = d.handled ? new Date(d.handled.at).getTime() : 0
  return new Date(Math.max(uploaded, handled)).toISOString()
}

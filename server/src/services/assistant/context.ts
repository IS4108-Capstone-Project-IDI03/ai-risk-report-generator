// Everything MarshBot's checks read about one assessment (AS-06), loaded once
// per re-check, and the stage it is in once the data is read. Called by
// recheck.service.ts. Reads the existing services; changes nothing but the stage.
import type { Types } from 'mongoose'
import { AssessmentModel, type IAssessment } from '../../models/assessment.model'
import { AssistantActivityModel } from '../../models/assistant-activity.model'
import { AssistantBriefModel, type CoverageState } from '../../models/assistant-brief.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { CaptureSessionModel } from '../../models/capture-session.model'
import { ClientDocumentModel } from '../../models/client-document.model'
import {
  ReportCommentThreadModel,
  type IReportCommentThread,
} from '../../models/report-comment.model'
import { ReportOfiModel } from '../../models/report-ofi.model'
import { ReportSectionModel } from '../../models/report-section.model'
import { ReportSectionVersionModel } from '../../models/report-section-version.model'
import { ReviewAuditModel } from '../../models/review-audit.model'
import { SiteWalkModel } from '../../models/site-walk.model'
import type { ISite } from '../../models/site.model'
import { getChecklist, type ChecklistDto, type StandardDto } from '../checklist.service'
import { blockersFrom, type ExportBlocker } from '../export.service'
import { listObservations, type ObservationDto } from '../observation.service'
import { listOfis } from '../ofi.service'
import { RagServiceError } from '../rag.service'
import { getReviewWorkspace, type ReviewWorkspaceDto } from '../review.service'
import { loadSections, type LoadedSection } from '../section.service'
import { listWalks, type SiteWalkDto } from '../site-walk.service'
import { getSummary, type SummaryDto } from '../summary.service'
import { dayOf } from './dates'
import { fingerprintOf } from './item'
import { decodeKey } from './activity'
import { areaHealth, PARTS } from './progress'
import { advanceStage, deriveStage, laterStage, stageIndex } from './stage'
import type { AreaHealth, Stage } from './types'

export type Thread = IReportCommentThread & { _id: Types.ObjectId }
export type Activity = { engagedMs: number; seen: Record<string, number> }
type Site = Pick<ISite, 'name' | 'jurisdiction' | 'facilityType'> & {
  _id: Types.ObjectId
  client?: { _id: Types.ObjectId; name: string } | null
}
export type LoadedAssessment = Omit<IAssessment, 'site' | 'engineer'> & {
  _id: Types.ObjectId
  site: Site | null
  engineer: { _id: Types.ObjectId; name: string } | null
}

export const NO_COVERAGE: CoverageState = {
  status: 'idle',
  startedAt: null,
  checkedAt: null,
  fingerprint: null,
  uncovered: [],
  thin: [],
}

export type CheckContext = {
  now: Date
  today: string // YYYY-MM-DD where the team works
  reference: string
  assessment: LoadedAssessment
  stage: Stage
  observations: ObservationDto[]
  walks: SiteWalkDto[]
  // Observations each reviewed site walk created, by walk id (its Done row, round 5).
  walkObservations: Record<string, number>
  checklist: ChecklistDto | null
  standards: StandardDto[]
  areas: AreaHealth[]
  captureStarted: boolean
  // Sections 4-12 as Generation sees them; null when rag-service didn't answer.
  sections: LoadedSection[] | null
  // Loaded once anything is drafted; null before, or when rag-service didn't answer.
  workspace: ReviewWorkspaceDto | null
  summary: SummaryDto | null
  ofis: Awaited<ReturnType<typeof listOfis>> | null
  // The report parts (2-12) with a draft or written text.
  draftedParts: string[]
  allDrafted: boolean
  threads: Thread[]
  documents: number
  // Null before Review, or when unavailable; empty = ready to export.
  blockers: ExportBlocker[] | null
  // Report sections changed (drafted, decided or edited) since the latest export.
  changedSinceExport: string[]
  coverage: CoverageState
  // The checklist and observations as the coverage check saw them (AC 7).
  evidenceFingerprint: string
  // The assigned engineer's activity by place, when it was first recorded, and when they last opened Review.
  activity: Map<string, Activity>
  firstActivityAt: Date | null
  reviewOpenedAt: Date | null
  dismissed: { itemId: string; fingerprint: string }[]
  // The rag-service reads that failed this time ('sections', 'workspace', 'blockers'):
  // unavailable, not empty (recheck.service.ts keeps the items they feed).
  unavailable: string[]
}

/** Returns the assessment's check context with its stage moved forward, or null for an unknown reference. */
export async function loadContext(
  reference: string,
  now = new Date(),
): Promise<CheckContext | null> {
  // a. The assessment, with its site, client and engineer.
  const assessment = await AssessmentModel.findOne({ reference })
    .populate({
      path: 'site',
      select: 'name jurisdiction facilityType client',
      populate: { path: 'client', select: 'name' },
    })
    .populate('engineer', 'name')
    .lean<LoadedAssessment>()
  if (!assessment) return null
  const id = assessment._id
  const engineerId = assessment.engineer?._id

  // b. What each tab holds, read in parallel.
  const [observations, walks, checklist, sessions, drafts, ofiCount, decided, threads, documents] =
    await Promise.all([
      listObservations(reference),
      listWalks(reference),
      getChecklist(reference),
      CaptureSessionModel.find({ assessment: id }, 'status').lean(),
      ReportSectionModel.find({ assessment: id }, 'sectionId createdAt').lean(),
      ReportOfiModel.countDocuments({ assessment: id }),
      ReviewAuditModel.exists({ assessment: id }),
      ReportCommentThreadModel.find({ assessment: id }).lean<Thread[]>(),
      countDocuments(assessment),
    ])
  const [brief, viewer, activity, created] = await Promise.all([
    AssistantBriefModel.findOne({ assessment: id }, 'coverage').lean(),
    engineerId ? AssistantViewerModel.findOne({ assessment: id, user: engineerId }).lean() : null,
    engineerId ? AssistantActivityModel.find({ assessment: id, user: engineerId }).lean() : [],
    SiteWalkModel.find({ assessment: id, status: 'created' }, 'created').lean(),
  ])

  // c. Generation and review: each rag-service read made once, and remembered when it failed.
  const unavailable: string[] = []
  const unlessRagDown = async <T>(source: string, work: () => Promise<T>): Promise<T | null> => {
    try {
      return await work()
    } catch (error) {
      // Rag-service down must not stop the brief: the parts it feeds are kept as they were.
      if (!(error instanceof RagServiceError)) throw error
      unavailable.push(source)
      return null
    }
  }
  const stored = assessment.stage ?? 'setup'
  const generationWork =
    drafts.length > 0 ||
    ofiCount > 0 ||
    !!assessment.riskQuality?.updatedAt ||
    !!assessment.lossEstimates?.updatedAt ||
    !!assessment.riskQuality?.proposal ||
    !!assessment.lossEstimates?.proposal
  const readyToGenerate =
    !!assessment.readyToGenerateAt ||
    (!assessment.anotherVisit && sessions.some((s) => s.status === 'ready_for_generation'))
  // Only the generation checks read the template's sections, so earlier stages never call rag-service.
  const sections =
    generationWork ||
    readyToGenerate ||
    !!assessment.exportedAt ||
    stageIndex(stored) >= stageIndex('ready_for_generation')
      ? await unlessRagDown('sections', () => loadSections(reference))
      : null
  const [workspace, summary, ofis] = generationWork
    ? await Promise.all([
        sections
          ? unlessRagDown('workspace', () => getReviewWorkspace(reference, sections))
          : (unavailable.push('workspace'), null),
        getSummary(reference),
        listOfis(reference),
      ])
    : [null, null, null]
  const written = new Set(
    workspace?.sections.filter((s) => s.completion.state !== 'not_started').map((s) => s.id),
  )
  const draftedParts = PARTS.filter(
    (p) => written.has(p) || (p === '3' ? ofiCount > 0 : drafts.some((d) => d.sectionId === p)),
  )

  // d. The stage the data proves; Ready to export also needs the export check, from Review on.
  const signals = {
    setupConfirmed: !!assessment.setupConfirmedAt,
    checklist: !!checklist?.checklist,
    // Another visit asked for counts as capture started (AC 5), even with nothing captured yet.
    captureStarted:
      sessions.length > 0 ||
      observations.length > 0 ||
      walks.length > 0 ||
      !!assessment.anotherVisit,
    readyToGenerate,
    generationWork,
    reviewStarted: !!decided || draftedParts.length === PARTS.length,
    exportClear: false,
    exported: !!assessment.exportedAt,
  }
  const inReview =
    stageIndex(laterStage(stored, deriveStage(signals, stored))) >= stageIndex('review')
  // Read after an export too, so a regenerated or reopened section is offered again only once clear.
  const blockers =
    inReview && workspace && summary && ofis
      ? blockersFrom({ workspace, summary, ofis, assessment })
      : null
  if (inReview && !blockers) unavailable.push('blockers')
  signals.exportClear = !!blockers && blockers.length === 0
  const stage = await advanceStage(assessment, deriveStage(signals, stored), now)

  const coverage = brief?.coverage ?? NO_COVERAGE
  return {
    now,
    today: dayOf(now),
    reference,
    assessment,
    stage,
    observations,
    walks,
    walkObservations: Object.fromEntries(
      created.map((w) => [String(w._id), Object.keys(w.created?.observationIds ?? {}).length]),
    ),
    checklist: checklist?.checklist ?? null,
    standards: checklist?.standards ?? [],
    areas: areaHealth(checklist?.checklist ?? null),
    captureStarted: signals.captureStarted,
    sections,
    workspace,
    summary,
    ofis,
    draftedParts,
    allDrafted: draftedParts.length === PARTS.length,
    threads,
    documents,
    blockers,
    changedSinceExport: assessment.exportedAt
      ? await changedSince(id, assessment.exportedAt, drafts)
      : [],
    coverage,
    evidenceFingerprint: evidenceFingerprint(checklist?.checklist ?? null, observations),
    activity: new Map(
      activity.map((a) => [
        a.place,
        {
          engagedMs: a.engagedMs,
          seen: Object.fromEntries(Object.entries(a.seen ?? {}).map(([k, v]) => [decodeKey(k), v])),
        },
      ]),
    ),
    firstActivityAt: activity.reduce<Date | null>(
      (first, a) => (!first || a.createdAt < first ? a.createdAt : first),
      null,
    ),
    reviewOpenedAt: viewer?.reviewOpenedAt ?? null,
    dismissed: viewer?.dismissed ?? [],
    unavailable,
  }
}

// Client documents kept under the assessment, its site or its whole client.
async function countDocuments(assessment: LoadedAssessment): Promise<number> {
  const site = assessment.site
  const places: Record<string, unknown>[] = [
    { 'placement.assessment': assessment._id },
    ...(site ? [{ 'placement.kind': 'site', 'placement.site': site._id }] : []),
    ...(site?.client ? [{ 'placement.kind': 'client', client: site.client._id }] : []),
  ]
  return ClientDocumentModel.countDocuments({ $or: places })
}

// The report sections drafted, decided on or edited after the export, in report order.
async function changedSince(
  assessment: Types.ObjectId,
  exportedAt: Date,
  drafts: { sectionId: string; createdAt: Date }[],
): Promise<string[]> {
  const [decided, edited] = await Promise.all([
    ReviewAuditModel.distinct('sectionId', { assessment, at: { $gt: exportedAt } }),
    ReportSectionVersionModel.distinct('sectionId', { assessment, at: { $gt: exportedAt } }),
  ])
  const changed = new Set<string>([
    ...decided,
    ...edited,
    ...drafts.filter((d) => d.createdAt > exportedAt).map((d) => d.sectionId),
  ])
  return PARTS.filter((p) => changed.has(p))
}

/** Returns a fingerprint of the checklist and the observations, which the coverage check is keyed on. */
export function evidenceFingerprint(
  checklist: ChecklistDto | null,
  observations: ObservationDto[],
) {
  return fingerprintOf([
    checklist?.id ?? null,
    checklist?.items.filter((i) => i.status === 'active').map((i) => [i.id, i.text]) ?? [],
    observations.map((o) => [
      o.id,
      String(o.edited?.at ?? o.recordedAt),
      o.copeDimensions,
      [...o.recordings, ...o.pages].map((m) => m.transcription.status),
    ]),
  ])
}

// MarshBot's re-check (AS-06 Architecture 1-2): reads the assessment, moves its
// stage forward, runs every check, keeps what was seen before, and saves one
// brief per assessment; then pushes the change to open Overviews. Called by
// check-queue.service.ts, brief.service.ts and coverage.service.ts. Calls
// context.ts, checks/, brief-view.ts, wording.service.ts and bus.ts.
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import { AssessmentNotFoundError } from '../capture-session.service'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { inBackground } from './background'
import { viewBrief, visibleItems, type StoredBrief } from './brief-view'
import { publishBriefChanged } from './bus'
import { runChecks } from './checks'
import { loadContext, type CheckContext } from './context'
import { dayOf, isoDay } from './dates'
import { fingerprintOf, type RaisedItem } from './item'
import { firstName, type BriefFacts } from './phrases'
import { sectionStates } from './progress'
import { ASSISTANT } from './settings'
import { STAGES, type BriefItem } from './types'
import { requestWording } from './wording.service'

/**
 * Returns the items with what was known before: an item still raised keeps
 * when it was first seen; one no longer raised is resolved now; the last
 * resolved ones are kept. An item raised again after it was resolved is open again.
 */
export function mergeItems(stored: BriefItem[], raised: RaisedItem[], now: Date): BriefItem[] {
  const at = now.toISOString()
  const before = new Map(stored.filter((i) => !i.resolvedAt).map((i) => [i.id, i]))
  const raisedIds = new Set(raised.map((i) => i.id))
  const open = raised.map((i) => ({
    ...i,
    firstSeenAt: before.get(i.id)?.firstSeenAt ?? at,
    resolvedAt: null,
  }))
  const resolved = [
    ...[...before.values()]
      .filter((i) => !raisedIds.has(i.id))
      .map((i) => ({ ...i, resolvedAt: at })),
    ...stored.filter((i) => i.resolvedAt && !raisedIds.has(i.id)),
  ]
    .sort((a, b) => b.resolvedAt!.localeCompare(a.resolvedAt!))
    .slice(0, ASSISTANT.keepResolved)
  return [...open, ...resolved]
}

// The plain facts the messages are written from.
function factsOf(ctx: CheckContext): BriefFacts {
  const a = ctx.assessment
  const client = a.site?.client
  return {
    site: a.site?.name ?? a.reference,
    client: {
      id: client ? String(client._id) : null,
      name: client?.name ?? a.client ?? '',
      reference: a.reference,
    },
    engineerName: a.engineer?.name ?? null,
    observations: ctx.observations.length,
    categorisedObservations: ctx.observations.filter((o) => o.copeDimensions).length,
    surveyStart: isoDay(a.siteVisitDate),
    surveyEnd: isoDay(a.siteVisitEndDate ?? a.siteVisitDate),
    reportDue: isoDay(a.reportDueDate),
    anotherVisit: !!a.anotherVisit,
    allDrafted: ctx.allDrafted,
    draftedParts: ctx.draftedParts.length,
    // Re-read below: advanceStage may have just dated new stages.
    stageDates: Object.fromEntries(STAGES.map((s) => [s, null])) as BriefFacts['stageDates'],
    exportedAt: a.exportedAt?.toISOString() ?? null,
    exportDay: a.exportedAt ? dayOf(a.exportedAt) : null,
    exportFile: a.exportFile?.fileName
      ? { fileName: a.exportFile.fileName, pages: a.exportFile.pages ?? null }
      : null,
    hasChecklist: !!ctx.checklist,
    evidenceFingerprint: ctx.evidenceFingerprint,
    captureStarted: ctx.captureStarted,
  }
}

// The item kinds each rag-service read feeds (context.ts `unavailable`).
const FED_BY: Record<string, string[]> = {
  workspace: ['review-items', 'quick-decision'],
  sections: ['thin-sections', 'out-of-date', 'draft-questions', 'unseen-questions'],
  blockers: ['stale-export'],
}

/**
 * Returns the checks' items, with the open items of every check whose data
 * didn't load kept as they were. Without this, a rag-service outage would
 * tick off review and drafting gaps that are still there.
 */
export function raisedItems(
  stored: BriefItem[],
  raised: RaisedItem[],
  unavailable: string[],
): RaisedItem[] {
  const held = new Set(unavailable.flatMap((source) => FED_BY[source] ?? []))
  return [
    ...raised.filter((i) => !held.has(i.kind)),
    ...stored.filter((i) => !i.resolvedAt && held.has(i.kind)),
  ]
}

// shortcut: an in-process lock, right while one gateway process saves briefs; a Redis lock if it runs as several.
const chains = new Map<string, Promise<unknown>>()

/**
 * Returns `work`'s result, run only after every earlier call for the same
 * assessment has finished. Without this, two re-checks could save out of
 * order and an older brief would overwrite a newer one.
 */
export function oneAtATime<T>(reference: string, work: () => Promise<T>): Promise<T> {
  const run = (chains.get(reference) ?? Promise.resolve()).catch(() => {}).then(work)
  chains.set(reference, run)
  // Forgotten once the last one finishes, so the map doesn't grow per assessment.
  void run.catch(() => {}).finally(() => chains.get(reference) === run && chains.delete(reference))
  return run
}

/**
 * Re-checks the assessment and saves its brief when anything changed, pushing
 * the change to open Overviews; returns the brief, or null for an unknown
 * reference. `wording: true` (an open Overview) also asks the wording AI for
 * a new message set; background re-checks don't, so nothing is paid for an
 * assessment nobody is looking at.
 */
export function refreshBrief(
  reference: string,
  { wording = false } = {},
): Promise<StoredBrief | null> {
  return oneAtATime(reference, () => refresh(reference, wording))
}

async function refresh(reference: string, wording: boolean): Promise<StoredBrief | null> {
  // a. Read everything once, and move the stage forward.
  const now = new Date()
  const ctx = await loadContext(reference, now)
  if (!ctx) return null
  const id = ctx.assessment._id
  const [stored, dated, viewer] = await Promise.all([
    AssistantBriefModel.findOne({ assessment: id }).lean<StoredBrief>(),
    AssessmentModel.findById(id, 'stageDates').lean(),
    ctx.assessment.engineer
      ? AssistantViewerModel.findOne({ assessment: id, user: ctx.assessment.engineer._id }).lean()
      : null,
  ])

  // b. Run the checks and merge with what was known.
  const facts = factsOf(ctx)
  facts.stageDates = Object.fromEntries(
    STAGES.map((s) => [s, dated?.stageDates?.[s]?.toISOString() ?? null]),
  ) as BriefFacts['stageDates']
  const fields = {
    reference,
    stage: ctx.stage,
    items: mergeItems(
      stored?.items ?? [],
      raisedItems(stored?.items ?? [], runChecks(ctx), ctx.unavailable),
      now,
    ),
    areas: ctx.areas,
    // The outline is drawn from the review workspace: kept as it was while that can't be read.
    sections:
      ctx.unavailable.includes('workspace') && stored ? stored.sections : sectionStates(ctx),
    facts,
  }
  const contentHash = fingerprintOf([
    fields.stage,
    fields.items.filter((i) => !i.resolvedAt),
    fields.areas,
    fields.sections,
    facts,
    ctx.coverage,
    ctx.dismissed,
  ])

  // c. The engineer's messages: a new set needs new wording (templates show first).
  const engineer = ctx.assessment.engineer
  const draft = {
    ...(stored ?? { coverage: ctx.coverage, thread: [], wording: { key: null, programs: {} } }),
    ...fields,
    updatedAt: now,
  } as StoredBrief
  const view = engineer
    ? {
        role: 'engineer' as const,
        name: engineer.name,
        lastOpenedAt: viewer?.lastOpenedAt ?? null,
        dismissed: viewer?.dismissed ?? [],
        exportAgain: viewer?.exportAgain ?? null,
      }
    : null
  const messages = view ? viewBrief(draft, view, now).messages : []
  const key = fingerprintOf(messages.map((m) => m.id))
  const reword = wording && !!view && messages.length > 0 && key !== stored?.wording.key
  if (stored && stored.contentHash === contentHash && !reword) return stored

  // d. Save, keeping the programs of messages still said; the coverage field is coverage.service's.
  const programs = Object.fromEntries(
    Object.entries(stored?.wording.programs ?? {}).filter(([m]) =>
      messages.some((x) => x.id === m),
    ),
  )
  const updated = await AssistantBriefModel.findOneAndUpdate(
    { assessment: id },
    { $set: { ...fields, contentHash } },
    { upsert: true, returnDocument: 'after' },
  ).lean<StoredBrief>()
  // Claimed on the key, so two opens at once ask for (and pay for) the wording once.
  const claimed =
    reword &&
    (await AssistantBriefModel.findOneAndUpdate(
      { assessment: id, 'wording.key': { $ne: key } },
      { $set: { wording: { key, programs } } },
      { returnDocument: 'after' },
    ).lean<StoredBrief>())
  const saved = claimed || updated
  if (claimed && view)
    inBackground(
      'wording',
      requestWording(reference, key, messages, visibleItems(saved!, view), firstName(view.name), [
        ...saved!.areas.map((a) => a.area),
        ...saved!.sections.map((s) => s.title),
      ]),
    )
  if (stored?.contentHash !== contentHash)
    publishBriefChanged(reference, saved!.updatedAt.toISOString())
  return saved
}

/**
 * Re-checks one assessment and saves its brief; returns nothing. An unknown or
 * archived assessment is skipped quietly; any other failure is thrown, so the
 * check queue retries it (check-queue.service.ts).
 */
export async function recheckAssessment(reference: string): Promise<void> {
  try {
    const assessment = await AssessmentModel.findOne({ reference }, 'archivedAt').lean()
    if (!assessment || assessment.archivedAt) return
    await refreshBrief(reference)
  } catch (error) {
    // Deleted while it was being read (e.g. a test emptying the database): nothing to check.
    if (error instanceof AssessmentNotFoundError) return
    throw error
  }
}

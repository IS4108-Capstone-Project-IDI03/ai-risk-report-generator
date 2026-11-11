// MarshBot's coverage check (AS-06 AC 7): asks rag-service which checklist
// items no observation covers and which observations are too thin for their
// section. Runs in the background when the Overview opens, from the first
// checklist and observation until Review, at most every 5 minutes while the
// evidence keeps changing; a check held back by that interval, or one that
// failed, runs again once it ends while the Overview is open. Called by
// brief.service.ts and its own delayed job. Calls rag.service.ts, then
// recheck.service.ts to turn the result into items.
import { AssessmentModel } from '../../models/assessment.model'
import { AssistantBriefModel } from '../../models/assistant-brief.model'
import { AssistantViewerModel } from '../../models/assistant-viewer.model'
import { recordAiCalls } from '../ai-usage.service'
import { getChecklist } from '../checklist.service'
import { privacyFor } from '../privacy.service'
import { listTemplateSections, requestAssistantCoverage } from '../rag.service'
import { defineQueue } from '../job-queue.service'
import { draftingEvidence, TranscriptionInProgressError } from '../section.service'
import { inBackground } from './background'
import type { StoredBrief } from './brief-view'
import type { BriefFacts } from './phrases'
import { refreshBrief } from './recheck.service'
import { ASSISTANT } from './settings'
import { stageIndex } from './stage'

/** Returns whether the coverage check should run now for this brief. */
export function coverageDue(brief: StoredBrief, now: Date): boolean {
  const f = brief.facts as BriefFacts
  const c = brief.coverage
  const i = stageIndex(brief.stage)
  const since = (at: Date | null) =>
    !at || now.getTime() - at.getTime() >= ASSISTANT.coverageMinIntervalMs
  return (
    i >= stageIndex('prepare') &&
    i < stageIndex('review') &&
    f.hasChecklist &&
    f.categorisedObservations > 0 &&
    f.evidenceFingerprint !== c.fingerprint &&
    // A check that started but never finished (a restart) counts as not running after the interval.
    (c.status !== 'running' || since(c.startedAt)) &&
    since(c.checkedAt)
  )
}

// Marks the check running, matching on the state read, so two Overviews opening at once start one check.
async function claim(brief: StoredBrief, now: Date): Promise<boolean> {
  if (!coverageDue(brief, now)) return false
  const claimed = await AssistantBriefModel.updateOne(
    {
      _id: brief._id,
      'coverage.status': brief.coverage.status,
      'coverage.startedAt': brief.coverage.startedAt,
    },
    { $set: { 'coverage.status': 'running', 'coverage.startedAt': now } },
  )
  return claimed.modifiedCount > 0
}

/**
 * Starts the coverage check in the background if it is due; returns whether it
 * started. When only the interval holds it back, queues one run for when it ends.
 */
export async function startCoverageIfDue(brief: StoredBrief, now = new Date()): Promise<boolean> {
  if (!(await claim(brief, now))) {
    // Not awaited: a Redis outage must not hold up or fail the Overview.
    inBackground('coverage schedule', scheduleCoverage(brief, now))
    return false
  }
  inBackground(
    'coverage',
    runCoverage(brief.reference, (brief.facts as BriefFacts).evidenceFingerprint),
  )
  return true
}

/** Runs the coverage check now if it is due (the delayed job); returns whether it ran. */
export async function coverageWhenDue(reference: string, now = new Date()): Promise<boolean> {
  const brief = await AssistantBriefModel.findOne({ reference }).lean<StoredBrief>()
  if (!brief || !(await claim(brief, now))) return false
  await runCoverage(reference, (brief.facts as BriefFacts).evidenceFingerprint)
  return true
}

// One delayed run per interval; under tests it runs at once, finds the interval not over, and does nothing.
const coverageQueue = defineQueue<{ reference: string }>(
  'assistant-coverage',
  { concurrency: 2, attempts: 1, backoffMs: 5000 },
  async ({ reference }) => void (await coverageWhenDue(reference)),
)

// Queues one run for when the interval ends, if that is all that holds the check
// back (changed evidence, or a failed check) and the engineer opened the Overview
// in the last 30 minutes, so an assessment nobody is looking at costs nothing.
async function scheduleCoverage(brief: StoredBrief, now: Date): Promise<void> {
  const checked = brief.coverage.checkedAt
  if (!checked || brief.coverage.status === 'running') return
  const at = new Date(checked.getTime() + ASSISTANT.coverageMinIntervalMs)
  if (at <= now || !coverageDue(brief, at)) return
  const assessment = await AssessmentModel.findById(brief.assessment, 'engineer').lean()
  const open = await AssistantViewerModel.exists({
    assessment: brief.assessment,
    user: assessment?.engineer,
    openedAt: { $gte: new Date(now.getTime() - ASSISTANT.sameVisitMs) },
  })
  if (!assessment?.engineer || !open) return
  await coverageQueue.add(
    `coverage-${brief.reference}-${at.getTime()}`,
    { reference: brief.reference },
    at.getTime() - now.getTime(),
  )
}

// One coverage check: its result, or failed (said once, retried after the
// interval), or idle again while a transcription is still running.
async function runCoverage(reference: string, fingerprint: string): Promise<void> {
  const set = (coverage: Record<string, unknown>) =>
    AssistantBriefModel.updateOne(
      { reference },
      { $set: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [`coverage.${k}`, v])) },
    )
  try {
    // a. The checklist, the categorised observations and the template's sections.
    const [{ scope, checklist }, observations, sections] = await Promise.all([
      getChecklist(reference),
      draftingEvidence(reference),
      listTemplateSections(),
    ])
    const items = (checklist?.items ?? []).filter((i) => i.status === 'active')
    const titles = new Map((checklist?.areas ?? []).map((a) => [a.id, a.title]))
    // b. The check, masked in rag-service when protection is on.
    const result = await requestAssistantCoverage({
      assessment: {
        reference,
        jurisdiction: scope.jurisdiction,
        facility_type: scope.facilityType,
      },
      checklist: items.map((i) => ({ id: i.id, area: titles.get(i.area) ?? i.area, text: i.text })),
      observations,
      sections: sections.map((s) => ({
        section_id: s.id,
        title: s.title,
        cope_dimensions: s.cope_dimensions,
      })),
      privacy: await privacyFor(reference),
    })
    await recordAiCalls(result.usage, { reportId: reference })
    // c. Only ids it was given: without this, an invented id would raise an item for nothing.
    const itemIds = new Set(items.map((i) => i.id))
    const observationIds = new Set(observations.map((o) => o.id))
    await set({
      status: 'done',
      checkedAt: new Date(),
      fingerprint,
      uncovered: result.uncovered.filter((id) => itemIds.has(id)),
      thin: result.thin
        .filter((t) => observationIds.has(t.observation_id))
        .map((t) => ({
          observationId: t.observation_id,
          sectionId: t.section_id,
          reason: t.reason,
        })),
    })
  } catch (error) {
    if (error instanceof TranscriptionInProgressError) await set({ status: 'idle' })
    else {
      console.warn(
        `MarshBot coverage check failed for ${reference}:`,
        error instanceof Error ? error.message : error,
      )
      await set({ status: 'failed', checkedAt: new Date() })
    }
  }
  const brief = await refreshBrief(reference)
  // Evidence changed while it ran, or it failed: once more when the interval ends.
  if (brief) await scheduleCoverage(brief, new Date())
}

// Every MarshBot check (AS-06 "Items per stage"), run in this order. Each is
// one file, `(ctx) => items`, deciding for itself which stages it runs in.
// Called by recheck.service.ts.
import type { CheckContext } from '../context'
import type { RaisedItem } from '../item'
import { areaGaps } from './area-gaps'
import { blankPages } from './blank-pages'
import { checklistMissing } from './checklist-missing'
import { checklistRead } from './checklist-read'
import { coverageGaps } from './coverage-gaps'
import { draftQuestions } from './draft-questions'
import { failedTranscription } from './failed-transcription'
import { figuresMissing } from './figures-missing'
import { newComments } from './new-comments'
import { newStandard } from './new-standard'
import { noAcceptedOfi } from './no-accepted-ofi'
import { notDrafted } from './not-drafted'
import { outOfDate } from './out-of-date'
import { quickDecision } from './quick-decision'
import { reportDue } from './report-due'
import { reviewItems } from './review-items'
import { setupDetails } from './setup-details'
import { siteWalks } from './site-walks'
import { staleExport } from './stale-export'
import { summaryWaiting } from './summary-waiting'
import { surveyPassedEmpty } from './survey-passed-empty'
import { thinSections } from './thin-sections'
import { transcribing } from './transcribing'
import { uncategorised } from './uncategorised'
import { uncitedItems } from './uncited-items'
import { unseenQuestions } from './unseen-questions'
import { unsureWords } from './unsure-words'
import { walkFields } from './walk-fields'

const CHECKS = [
  reportDue,
  siteWalks,
  failedTranscription,
  setupDetails,
  checklistMissing,
  checklistRead,
  newStandard,
  uncitedItems,
  surveyPassedEmpty,
  areaGaps,
  walkFields,
  blankPages,
  unsureWords,
  uncategorised,
  transcribing,
  thinSections,
  notDrafted,
  outOfDate,
  draftQuestions,
  figuresMissing,
  summaryWaiting,
  noAcceptedOfi,
  reviewItems,
  unseenQuestions,
  quickDecision,
  newComments,
  staleExport,
  // Last: the coverage check's findings show after the rest (AC 7).
  coverageGaps,
]

/**
 * Returns every item the checks raise. While another site visit is set and
 * the assessment is in Capture, capture gaps stay quiet (AC 5); Fix now stays.
 */
export function runChecks(ctx: CheckContext): RaisedItem[] {
  const quiet = ctx.stage === 'capture' && !!ctx.assessment.anotherVisit
  return CHECKS.flatMap((check) => check(ctx)).filter(
    (item) => !(quiet && item.stage === 'capture' && item.weight === 'gap'),
  )
}

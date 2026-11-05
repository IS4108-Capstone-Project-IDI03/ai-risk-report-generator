// Opens an assessment's Overview from outside the workspace (F-10): an Inbox row for an
// assigned assessment. Same idea as site-walk/openReview.ts. Read by AssessmentApp.tsx,
// which opens it through the leave guard.
export const assessmentOpen = { event: 'open-assessment' }

/** Asks the app to open `reference`'s Overview. */
export function openAssessmentOverview(reference: string) {
  window.dispatchEvent(new CustomEvent(assessmentOpen.event, { detail: { reference } }))
}

// Said when `reference` can't be opened even after reading the list again. The Inbox listens,
// so the row just pressed doesn't stay Done (inbox/useInboxActions.ts).
export const assessmentMissing = { event: 'assessment-missing' }

/** Tells whoever asked that `reference` could not be opened. */
export function reportAssessmentMissing(reference: string) {
  window.dispatchEvent(new CustomEvent(assessmentMissing.event, { detail: { reference } }))
}

// Said when the Assessments list is known to be out of date, e.g. a "moved" bell row pressed
// while already on the list. Read by AssessmentApp.tsx.
export const assessmentsStale = { event: 'assessments-stale' }

/** Asks the app to read the Assessments list again. */
export function reloadAssessments() {
  window.dispatchEvent(new CustomEvent(assessmentsStale.event))
}

// Where a notification takes you (F-10 criterion 6, spec "What goes where"): one function
// for the bell and the Inbox, so a row opens the same place from both. Called when a row
// is pressed. Calls the openers that each screen already listens to.
import type { Notification } from './api'
import { KNOWLEDGE_REVIEW_PATH, SCREEN_PATHS } from '../auth/access'
import { openAssessmentOverview, reloadAssessments } from '../assessments/openAssessment'
import { openKnowledgeTab } from '../knowledge-base/openTab'
import { openSiteWalkReview } from '../site-walk/openReview'

// Moves to a path the way the browser's Back does: the URL changes and popstate tells the
// app to follow. Skipped when already there, since a second entry would make Back land on
// the same page.
function goTo(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Opens what a notification is about, where it has a page; does nothing otherwise. */
export function openSubject(notification: Notification) {
  const { purpose, context } = notification
  const { reference, walkId, documentId, status, requestId } = context ?? {}
  switch (purpose) {
    // An assigned assessment (RV-11): its Overview.
    case 'assessment_assigned':
      return reference ? openAssessmentOverview(reference) : undefined
    // A site walk is ready or failed (CP-22): its assessment's Observations, on the review.
    case 'site_walk_ready':
    case 'site_walk_failed':
      return reference && walkId ? openSiteWalkReview(reference, walkId) : undefined
    // A request (CB-07): a new one (no status) opens Requests on it; the asker's outcome
    // (filled or dismissed) carries a status and opens the chat.
    case 'knowledge_gap_request':
      return status ? goTo(SCREEN_PATHS.chat) : openKnowledgeTab('requests', requestId)
    // A document (IN-07): needs review opens its Review page; a failed one opens Add
    // documents, where Retry is; a finished one opens the Documents list.
    case 'ingestion_status':
      if (!documentId) return
      if (status === 'needs_review')
        return goTo(KNOWLEDGE_REVIEW_PATH + encodeURIComponent(documentId))
      return openKnowledgeTab(status === 'failed' ? 'add' : 'documents', undefined, documentId)
    // Moved away from you: the list, where it no longer is. Already there, goTo does nothing,
    // so the list is asked to read itself again or the moved row would stay on it.
    case 'assessment_moved':
      goTo(SCREEN_PATHS.dashboard)
      return reloadAssessments()
  }
}

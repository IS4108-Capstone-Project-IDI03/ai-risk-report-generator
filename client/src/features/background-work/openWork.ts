// Where an activity row takes you (F-11), from the place the gateway names
// (`href`), through the openers each screen already listens to, as the bell's
// rows do (notifications/openSubject.ts). Called when a row is pressed.
import { KNOWLEDGE_REVIEW_PATH } from '../auth/access'
import { openAssessmentAt } from '../assessments/openAssessment'
import { openKnowledgeTab } from '../knowledge-base/openTab'
import { openSiteWalkReview } from '../site-walk/openReview'
import type { BackgroundWorkRow } from './api'

// Moves to a path the way the browser's Back does, as openSubject does.
function goTo(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Opens what a row is about: a walk, an observation, drafting, a document or the uploads. */
export function openWork(row: BackgroundWorkRow) {
  const url = new URL(row.href, window.location.origin)
  if (url.pathname === '/assessment') {
    const reference = url.searchParams.get('ref')
    const walk = url.searchParams.get('walk')
    const obs = url.searchParams.get('obs')
    if (!reference) return
    if (walk) return openSiteWalkReview(reference, walk)
    return openAssessmentAt(reference, {
      tab: url.searchParams.get('tab') === 'generate' ? 'generate' : 'observations',
      ...(obs && { obs }),
    })
  }
  if (url.pathname.startsWith(KNOWLEDGE_REVIEW_PATH)) return goTo(url.pathname)
  // The uploads list for an admin's own documents; an engineer's request opens the
  // documents, since adding them is the admins'.
  return openKnowledgeTab(row.kind === 'request' ? 'documents' : 'add')
}

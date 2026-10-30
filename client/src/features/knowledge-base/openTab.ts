// Which Knowledge base tab to show, and a way to open one from elsewhere (CB-07): the chat's
// "Add documents" button and the Requests notification. Read by KnowledgeBase.tsx.
import { SCREEN_PATHS } from '../auth/access'

// Kept outside React so coming back to the screen reopens the tab you left,
// e.g. to see how an upload went (a module variable outlives the screen).
// `request` is the request a notification's Go to request opened, shown highlighted once.
export const knowledgeTab = { current: 'documents', request: null as string | null }

/** Opens the Knowledge base on `tab`: the URL changes and popstate tells the app, as Back does. */
export function openKnowledgeTab(tab: 'documents' | 'add' | 'requests', request?: string) {
  knowledgeTab.current = tab
  knowledgeTab.request = request ?? null
  const path = SCREEN_PATHS.knowledge
  if (window.location.pathname !== path) window.history.pushState(null, '', path)
  // Sent even when already there, so a mounted Knowledge base switches tab.
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// Where a MarshBot link on the Overview goes (AS-06). Called by screens/Overview.tsx. The place
// inside a tab (a checklist area or item, a report section, an observation's recording) rides
// in AssessmentApp's goTo, which hands it to the tab's screen; see AssessmentApp.tsx.
import type { ItemLink } from '../marshbot/types'
import { openSiteWalkReview } from '../site-walk/openReview'

// Set while a link opens another tab. The URL sync in useAssessmentWorkflow.tsx then adds a
// history entry instead of rewriting the Overview's, so Back returns to the Overview. The tab strip
// never sets it, so it keeps rewriting. Kept outside React like site-walk/openReview.ts.
export const overviewNav = { push: false }

// Marks the navigation that follows as one that starts from an Overview link. The timer clears it
// when the link changed nothing (already on that tab), so a later tab click isn't taken for one.
function markFromOverview() {
  overviewNav.push = true
  setTimeout(() => (overviewNav.push = false), 0)
}

/** What a link needs from the workflow and the app; `goTo` keeps the link's params for its tab. */
export type LinkTargets = {
  reference: string
  setTab: (tab: ItemLink['tab']) => void
  showObservation: (id: string) => void
  openDetails: () => void
  goTo: (link: ItemLink) => void
}

/** Opens what `link` points at: Details, a site walk's review, an observation, or a tab at its place. */
export function openOverviewLink(link: ItemLink, t: LinkTargets) {
  const { walk, obs, details } = link.params ?? {}
  if (details) return t.openDetails()
  if (walk) {
    markFromOverview()
    return openSiteWalkReview(t.reference, walk)
  }
  markFromOverview()
  if (obs) {
    // `media` (a recording or page) is scrolled to once the observation is open.
    t.goTo(link)
    return t.showObservation(obs)
  }
  t.setTab(link.tab)
  t.goTo(link)
}

import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { MarshBotOverview } from '../../marshbot/screens/MarshBotOverview'
import type { ItemLink } from '../../marshbot/types'
import { openOverviewLink } from '../openOverviewLink'

// The assessment's Overview: a conversation with MarshBot (AS-06) about its stage, next step and
// gaps. AssessmentApp shows it only once the assessment is on the work list.
export function Overview({
  v,
  reference,
  openDetails,
  goTo,
}: {
  v: AssessmentWorkflow
  reference: string
  openDetails: () => void
  // Hands a link's checklist area or report section to the tab it opens (AssessmentApp).
  goTo: (link: ItemLink) => void
}) {
  return (
    <MarshBotOverview
      reference={reference}
      openLink={(link) =>
        openOverviewLink(link, {
          reference,
          setTab: v.setTab,
          showObservation: v.showObservation,
          openDetails,
          goTo,
        })
      }
      openDetails={openDetails}
      archived={v.archivedOpen}
    />
  )
}

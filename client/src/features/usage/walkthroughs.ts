// The "Check usage and costs" walkthrough (F-12): a tour of the Report generation overview, with one
// step for the admin's Ingestion tab. Read by features/walkthrough/registry.ts. Tags are in features/usage.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time Usage and Costs opens (offered).
    id: 'usage',
    name: 'Check usage and costs',
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'usage',
    place: { path: '/usage-costs' },
    offer:
      "Hi, I see it's your first time in the Usage and Costs tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // At: The Totals card.
        target: 'usage.totals',
        say: 'This is where you can see what the AI has **cost** on your assessments, how often it was used and how fast it ran. Please note that the costs are estimates.',
        sayAdmin:
          'This is where you can see what the AI has **cost** across every assessment and engineer, how often it was used and how fast it ran.',
      },
      {
        // At: The filters: Period, (admin: Group by) and Split each bar by.
        target: 'usage.filters',
        say: 'You can change the period here. You can also split the bars by **feature**, which shows you where the cost went.',
        sayAdmin:
          'You can change the period here, group the costs by **assessment or engineer**, and split the bars by feature or billed service.',
      },
      {
        // At: The assessments table's headings and its first assessment.
        target: ['usage.table.head', 'usage.table.row-1'],
        say: "If you press an assessment, you'll see its costs in more detail, right down to each report section.",
      },
      {
        // At: The Ingestion tab (admin only).
        target: 'usage.tab.ingestion',
        only: 'knowledge_admin',
        say: 'The **Ingestion** tab shows what it cost to add each document to the knowledge base.',
      },
    ],
  },
]

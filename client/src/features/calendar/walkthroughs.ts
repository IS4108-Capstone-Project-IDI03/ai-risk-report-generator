// The "Read the Calendar" walkthrough (F-12): the month grid, the view and date filters, and the
// two side lists. Tags: calendar.* (screens/Calendar.tsx, components/CalendarGrid.tsx and DayList.tsx).
// Read by features/walkthrough/registry.ts. Plays on the Calendar.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the Calendar opens (offered).
    id: 'calendar',
    name: 'Read the Calendar',
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'calendar',
    place: { path: '/calendar' },
    offer:
      "Hi, I see it's your first time in the Calendar tab.\n\nWould you like me to show you around?",
    steps: [
      {
        // The month grid (a phone lists the month's days instead; the same tag).
        target: 'calendar.grid',
        say: 'This is where you can see all your **surveys** and **report due dates** in one place. If you press an entry, you can open the assessment or change its dates.',
        sayAdmin:
          "This is where you can see surveys and report due dates **for the whole team**. If you'd like to see one person's workload, you can filter by engineer.",
      },
      {
        // The Month | Week switch and the "All dates" filter (a phone has the filter only).
        target: ['calendar.view', 'calendar.dates'],
        say: 'You can switch between a month and a week here, or choose to see only survey dates or only report due dates.',
      },
      {
        target: 'calendar.side',
        say: 'These 2 lists help you catch anything that might slip: reports that are **late**, and assessments that have **no survey date** yet.',
      },
    ],
  },
]

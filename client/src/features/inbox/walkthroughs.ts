// The "Use your Inbox" walkthrough (F-12): the To do | Done switch, the first row and the bell.
// Tags: inbox.tabs, inbox.row-1 (inbox screens) and shell.bell (notifications/NotificationBell).
// Read by features/walkthrough/registry.ts. Plays on the Inbox.
import type { WalkthroughDef } from '../walkthrough/types'

export const WALKTHROUGHS: WalkthroughDef[] = [
  {
    // Starts when: First time the Inbox opens (offered).
    id: 'inbox',
    name: 'Use your Inbox',
    group: 'Day to day',
    roles: ['risk_engineer', 'knowledge_admin'],
    kind: 'tell',
    screen: 'inbox',
    place: { path: '/inbox' },
    offer:
      "Hi, I see it's your first time in the Inbox tab.\n\nWould you like me to show you around?",
    steps: [
      {
        target: 'inbox.tabs',
        say: "**To do** is where you'll find anything that needs you, like a new assessment or a site walk that's ready for you to review.",
        sayAdmin:
          "**To do** is where you'll find anything that needs you, like a question from an engineer or a document that needs reviewing.",
      },
      {
        // Skipped when the open tab has no row (a new account's empty Inbox).
        target: 'inbox.row-1',
        optional: true,
        say: 'When you open an item, it moves to **Done** on its own. You can also tick an item off without opening it.',
      },
      {
        target: 'shell.bell',
        say: "The **bell** is a little different. It's for updates that don't need you to do anything, and you can press any update to go straight to what it's about.",
      },
    ],
  },
]
